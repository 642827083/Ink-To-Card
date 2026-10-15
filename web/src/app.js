var InkToCardApp = (function () {
  var config = __INK_TO_CARD_CONFIG__, state = null, rendered = "", busy = false, saving = false, polling = false;
  var observation = "", attempted = new Map(), lastAuto = false, diagnosing = false, batch = null;
  function element(id) { return document.getElementById(id); }
  function configurationEnabled(enabled) {
    ["auto", "policy", "min-pixels", "dominance"].forEach(function (id) { element(id).disabled = !enabled; });
    document.querySelectorAll(".mapping-row select, .mapping-row button").forEach(function (control) { control.disabled = !enabled; });
  }
  function controls() {
    var available = !!(state && state.available), idle = !busy && !saving;
    configurationEnabled(available && idle);
    element("dominance").disabled = !available || !idle || state.settings.policy !== "dominant";
    element("preview").disabled = !available || !state.source || !idle;
    element("recognize").disabled = !available || !state.source || !idle;
    element("inspect-sources").disabled = !available || !idle || diagnosing;
    element("export-sample").disabled = !available || !state.source || !idle;
    element("batch-selected").disabled = !(state && state.topicId) || !idle;
    element("batch-notebook").disabled = !(state && state.topicId) || !idle;
    element("batch-cancel").hidden = !batch;
    element("batch-cancel").disabled = !!(batch && batch.cancelled);
  }
  function status(message, error) { element("status").textContent = message; element("status").className = error ? "error" : ""; }
  function showCounts(counts) {
    var box = element("counts"); box.replaceChildren(); box.hidden = !counts;
    if (!counts) return;
    config.colors.forEach(function (color) {
      var count = Math.round(counts[color.id] || 0);
      if (!count) return;
      var item = document.createElement("span"), dot = document.createElement("i");
      dot.className = "dot"; dot.style.backgroundColor = color.hex;
      item.append(dot, document.createTextNode(color.label + " " + count)); box.appendChild(item);
    });
  }
  function render(snapshot) {
    if (InkToCardStartup.failed()) return;
    InkToCardStartup.settled();
    state = snapshot;
    var signature = JSON.stringify(snapshot);
    if (signature === rendered) { controls(); return; }
    var previous = rendered ? JSON.parse(rendered) : null;
    rendered = signature;
    var available = snapshot.available;
    element("note-title").textContent = available ? snapshot.title : snapshot.reason;
    element("note-color").textContent = available ? "当前色号 " + (snapshot.colorIndex + 1) : "";
    ["preview", "auto", "policy", "min-pixels", "dominance"].forEach(function (id) { element(id).disabled = !available; });
    controls();
    element("inspect-sources").disabled = !available || diagnosing;
    element("export-sample").disabled = !available || busy || !(snapshot.sources || []).some(function (source) { return source.kind === "drawing"; });
    if (!previous || previous.noteId !== snapshot.noteId) element("source-diagnostic").hidden = true;
    element("source").textContent = snapshot.source ? "绘图批注 " + (snapshot.source.index + 1) + " · 最后一条" : "未找到手写绘图";
    if (!previous || previous.noteId !== snapshot.noteId || JSON.stringify(previous.sources) !== JSON.stringify(snapshot.sources)) {
      element("preview-wrap").hidden = true; element("preview-image").removeAttribute("src");
      showCounts(null);
    }
    var badge = element("source-badge");
    badge.textContent = snapshot.source ? "自动选择" : "无绘图";
    badge.className = "badge" + (snapshot.source ? " bound" : "");
    element("recognize").disabled = !snapshot.source || busy;
    if (!snapshot.source) status("没有可读取的手写绘图，普通图片不参与自动识别。");
    if (!available) { controls(); return; }
    var settings = snapshot.settings;
    element("auto").checked = settings.auto;
    element("policy").value = settings.policy;
    element("min-pixels").value = settings.minPixels;
    element("dominance").value = String(settings.dominance);
    config.colors.forEach(function (color) { element("map-" + color.id).value = settings.mapping[color.id]; });
    element("settings-status").textContent = "设置已保存到此学习集";
    if (previous && previous.noteId !== snapshot.noteId && snapshot.source) status("已自动选择最后一条手写绘图，可以识别。");
    controls();
  }
  async function refresh() {
    if (saving || InkToCardStartup.failed()) return;
    try { render(await MNBridge.send("readCurrent")); }
    catch (error) {
      InkToCardStartup.settled();
      if (!state) element("note-title").textContent = "读取失败，点击刷新";
      status(error.message, true);
    }
  }
  async function save() {
    if (!state || !state.available || saving || busy) return;
    saving = true;
    configurationEnabled(false);
    var snapshot = state, settings = config.normalize(snapshot.settings);
    settings.auto = element("auto").checked; settings.policy = element("policy").value;
    settings.minPixels = Number(element("min-pixels").value); settings.dominance = Number(element("dominance").value);
    config.colors.forEach(function (color) { settings.mapping[color.id] = Number(element("map-" + color.id).value); });
    try {
      await MNBridge.send("saveSettings", { noteId: snapshot.noteId, settings: settings });
      observation = ""; element("settings-status").textContent = "设置已保存";
    } catch (error) { status(error.message, true); }
    finally { saving = false; await refresh(); controls(); }
  }
  function selected() {
    if (!state || !state.available) throw new Error("请在脑图中选中一张卡片，再点击刷新");
    var source = state.source;
    if (!source) throw new Error("没有可预览的手写绘图");
    return { noteId: state.noteId, index: source.index, hash: source.hash };
  }
  async function preview() {
    if (busy) return;
    busy = true; controls();
    try {
      var source = selected(), media = await MNBridge.send("readMedia", source);
      element("preview-image").src = media.dataURL; element("preview-wrap").hidden = false;
      status("已自动读取最后一条绘图，" + (media.drawing ? media.drawing.strokeCount + " 条笔画，预览为近似渲染。" : ""));
    } catch (error) { status(error.message, true); }
    finally { busy = false; controls(); }
  }
  async function inspectSources() {
    if (!state || !state.available || busy || diagnosing || InkToCardStartup.failed()) return;
    diagnosing = true; element("inspect-sources").disabled = true;
    var noteId = state.noteId;
    function number(probe) { return probe.error ? "读取失败：" + probe.error : probe.supported ? String(probe.value) : "接口不可用"; }
    function line(label, data) {
      return label + "：批注 " + data.commentCount + "，PaintNote " + (data.paintTypeCount || 0)
        + "，图片 " + data.paintCommentCount + "，绘图 " + (data.drawingCommentCount || 0)
        + "，笔画 " + number(data.strokes) + "，绘图字节 " + number(data.drawingBytes);
    }
    try {
      var report = await MNBridge.send("inspectSources", { noteId: noteId, inspectMedia: true });
      if (!state || state.noteId !== noteId) return;
      var mediaInfo = (report.drawingMedia || []).map(function (media) {
        return "绘图批注 " + (media.index + 1) + "：" + (media.error || media.bytes + " 字节，" + media.format
          + (media.drawingDecoded ? "，笔画解码成功（" + media.strokeCount + " 条）" : "，图片解码" + (media.imageDecoded ? "成功" : "失败")));
      });
      element("source-summary").textContent = report.summary + "\nMN " + (report.appVersion || "未知") + " / " + (report.build || "未知")
        + "\n" + line("当前卡片对象", report.focus) + "\n" + line("数据库对象", report.database)
        + (mediaInfo.length ? "\n" + mediaInfo.join("\n") : "");
      element("source-details").textContent = JSON.stringify(report, null, 2);
      element("source-diagnostic").hidden = false;
    } catch (error) { status(error.message, true); }
    finally { diagnosing = false; element("inspect-sources").disabled = !(state && state.available); }
  }
  async function exportDrawingSample() {
    if (busy || saving || InkToCardStartup.failed()) return;
    busy = true; element("export-sample").disabled = true;
    try {
      var source = selected();
      var result = await MNBridge.send("exportDrawingSample", source);
      status("已请求打开保存窗口，请将 " + result.filename + " 保存到“文件”，再把文件发来排查格式。");
    } catch (error) { status(error.message, true); }
    finally {
      busy = false;
      controls();
    }
  }
  function pixels(dataURL) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onerror = function () { reject(new Error("这条批注无法解码成图片")); };
      image.onload = function () {
        try {
          var scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          var context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve({ data: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height });
        } catch (error) { reject(error); }
      };
      image.src = dataURL;
    });
  }
  async function recognize(snapshot, automatic) {
    if (busy || saving || !snapshot || !snapshot.source) return;
    busy = true; controls();
    try {
      status(automatic ? "正在自动识别…" : "正在识别笔迹颜色…");
      var source = snapshot.source, settingsToken = JSON.stringify(snapshot.settings);
      var media = await MNBridge.send("readMedia", { noteId: snapshot.noteId, index: source.index, hash: source.hash });
      var image = await pixels(media.dataURL);
      var histogram = InkToCardCore.histogram(image.data, image.width, image.height, snapshot.settings);
      var result = await MNBridge.send("applyResult", { noteId: snapshot.noteId, index: source.index, hash: source.hash,
        settingsToken: settingsToken, expectedColorIndex: snapshot.colorIndex, automatic: automatic, histogram: histogram });
      showCounts(result.counts);
      var color = config.colors.find(function (item) { return item.id === result.color; });
      status((color ? color.label + "笔迹 · " : "") + result.reason);
      if (automatic) lastAuto = true;
    } catch (error) { status(error.message, true); }
    finally { busy = false; await refresh(); controls(); }
  }
  async function runBatch(scope) {
    if (busy || saving || diagnosing || InkToCardStartup.failed()) return;
    busy = true; batch = { id: null, cancelled: false }; controls();
    var active = batch, done = 0, changed = 0, unchanged = 0, skipped = 0, reasons = [];
    element("batch-details").textContent = "";
    function progress(message) { element("batch-status").textContent = message; }
    try {
      progress("正在读取批量范围…");
      var job = await MNBridge.send("beginBatch", { scope: scope });
      active.id = job.batchId;
      for (var position = 0; position < job.total && !active.cancelled; position += 1) {
        progress("正在处理 " + (position + 1) + " / " + job.total);
        var item = await MNBridge.send("prepareBatchCard", { batchId: job.batchId, position: position }), result, histogram = null;
        if (active.cancelled) break;
        if (item.skipped) result = { status: "skipped", reason: item.reason };
        else {
          try {
            var image = await pixels(item.media.dataURL);
            if (active.cancelled) break;
            histogram = InkToCardCore.histogram(image.data, image.width, image.height, job.settings);
            result = await MNBridge.send("applyBatchResult", { batchId: job.batchId, noteId: item.noteId, histogram: histogram });
          } catch (error) {
            if (active.cancelled) break;
            // 图像分析失败可以跳过；原生任务失效须停止整批，不能继续提交。
            if (histogram) throw error;
            result = { status: "skipped", reason: error.message };
          }
        }
        done += 1;
        if (result.status === "applied") changed += 1;
        else if (result.status === "unchanged") unchanged += 1;
        else {
          skipped += 1;
          if (reasons.length < 50) reasons.push(item.title + "：" + result.reason);
        }
        element("batch-details").textContent = reasons.join("\n");
        // 每张完成后交还事件循环，取消按钮可在下一张提交前生效。
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
      }
      progress((active.cancelled ? "已取消" : "已完成") + " · 处理 " + done + " / " + job.total + " · 改色 " + changed + " · 原色已匹配 " + unchanged + " · 跳过 " + skipped);
    } catch (error) {
      progress((active.cancelled ? "已取消" : "已停止：" + error.message) + " · 已处理 " + done + " · 改色 " + changed + " · 跳过 " + skipped);
    } finally {
      if (active.id) {
        try { await MNBridge.send("endBatch", { batchId: active.id }); } catch (error) { progress(element("batch-status").textContent + " · 结束任务失败：" + error.message); }
      }
      batch = null; busy = false; await refresh(); controls();
    }
  }
  async function cancelBatch() {
    if (!batch) return;
    batch.cancelled = true; controls();
    if (batch.id) {
      try { await MNBridge.send("endBatch", { batchId: batch.id }); } catch (error) { element("batch-status").textContent = "取消请求失败：" + error.message; }
    }
  }
  async function tick() {
    if (polling || busy || saving || document.readyState === "loading" || InkToCardStartup.failed()) return;
    polling = true;
    try {
      var snapshot = await MNBridge.send("readCurrent"); render(snapshot);
      if (!snapshot.available || !snapshot.settings.auto || !snapshot.source) { observation = ""; return; }
      var key = snapshot.noteId + ":" + snapshot.source.hash + ":" + JSON.stringify(snapshot.settings);
      // 连续两次看到相同媒体后才识别；撤销和手动改卡色不会重触发同一媒体。
      if (key !== observation) { observation = key; return; }
      if (attempted.has(key)) return;
      attempted.set(key, true);
      if (attempted.size > 100) attempted.delete(attempted.keys().next().value);
      await recognize(snapshot, true);
    } catch (error) { status(error.message, true); }
    finally { polling = false; }
  }
  function init() {
    if (InkToCardStartup.failed()) return;
    var mapping = element("mapping");
    config.colors.forEach(function (color) {
      var row = document.createElement("div"); row.className = "mapping-row";
      var name = document.createElement("label"); name.className = "color-name"; name.htmlFor = "map-" + color.id;
      var dot = document.createElement("i"); dot.className = "dot"; dot.style.backgroundColor = color.hex;
      name.append(dot, document.createTextNode(color.label));
      var select = document.createElement("select"); select.id = "map-" + color.id;
      for (var index = -1; index < 16; index += 1) {
        // 显示与 MN 色板一致的 1–16，保存值继续使用 0–15，保持已有映射对应的颜色。
        var option = document.createElement("option"); option.value = index; option.textContent = index === -1 ? "不触发" : "色号 " + (index + 1); select.appendChild(option);
      }
      select.addEventListener("change", save);
      var capture = document.createElement("button"); capture.type = "button"; capture.className = "text-button"; capture.textContent = "取当前卡色";
      capture.addEventListener("click", async function () {
        if (saving || busy) return;
        await refresh();
        if (!state || !state.available || state.colorIndex < 0 || state.colorIndex > 15) { status("请在脑图中选中已设为目标颜色的卡片", true); return; }
        select.value = state.colorIndex; await save();
      });
      row.append(name, select, capture); mapping.appendChild(row);
    });
    ["auto", "policy", "min-pixels", "dominance"].forEach(function (id) { element(id).addEventListener("change", save); });
    element("refresh").addEventListener("click", refresh);
    element("preview").addEventListener("click", preview);
    element("inspect-sources").addEventListener("click", inspectSources);
    element("export-sample").addEventListener("click", exportDrawingSample);
    element("batch-selected").addEventListener("click", function () { runBatch("selected"); });
    element("batch-notebook").addEventListener("click", function () { runBatch("notebook"); });
    element("batch-cancel").addEventListener("click", cancelBatch);
    element("recognize").addEventListener("click", async function () { await refresh(); await recognize(state, false); });
    InkToCardStartup.initialized();
    refresh();
    if (window.InkToCardDemoBridge) setInterval(tick, 1200);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  return { tick: tick, refresh: refresh, runBatch: runBatch, cancelBatch: cancelBatch, inspectSources: inspectSources, exportDrawingSample: exportDrawingSample, lastAuto: function () { return lastAuto; } };
})();
