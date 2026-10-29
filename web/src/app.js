var InkToCardApp = (function () {
  var config = __INK_TO_CARD_CONFIG__, state = null, rendered = "", busy = false, saving = false, polling = false;
  var observation = "", observedAt = 0, attempted = new Map(), lastAuto = false, diagnosing = false, batch = null;
  var waitingForInk = false, trackingError = false, resultTarget = null;
  var previewCache = null, previewLoading = false;
  function element(id) { return document.getElementById(id); }
  function controlState(control, available, pending) {
    control.disabled = !available || !!pending;
    control.setAttribute("aria-busy", String(!!available && !!pending));
  }
  function configurationEnabled(available, pending) {
    ["auto", "policy", "min-pixels", "dominance"].forEach(function (id) { controlState(element(id), available, pending); });
    document.querySelectorAll(".mapping-row select, .mapping-row button").forEach(function (control) { controlState(control, available, pending); });
  }
  function controls() {
    var available = !!(state && state.available), idle = !busy && !saving;
    var configurable = !!(state && (available || state.tracking && state.topicId));
    configurationEnabled(configurable, !idle);
    controlState(element("dominance"), configurable && state.settings.policy === "dominant", !idle);
    controlState(element("preview"), available && state.source, !idle);
    controlState(element("recognize"), available && state.source, !idle);
    controlState(element("inspect-sources"), available, !idle || diagnosing);
    controlState(element("export-sample"), available && state.source, !idle);
    controlState(element("batch-selected"), state && state.topicId, !idle);
    controlState(element("batch-notebook"), state && state.topicId, !idle);
    element("batch-cancel").hidden = !batch;
    element("batch-cancel").disabled = !!(batch && batch.cancelled);
    previewButton();
    trackingStatus();
  }
  function status(message, error, success) { element("status").textContent = message; element("status").className = error ? "error" : success ? "success" : ""; }
  function hasMapping(settings) {
    return config.mappingEntries.some(function (color) { return settings.mapping[color.id] >= 0; });
  }
  function trackingStatus() {
    var badge = element("tracking-status"), label = "正在连接", tone = "";
    if (state) {
      if (!state.available) label = state.topicId ? "等待选卡" : "等待学习集";
      else if (saving) label = "保存设置中";
      else if (busy) label = batch ? "批量处理中" : "处理中";
      else if (!state.settings.auto) label = "自动已关闭";
      else if (!state.source) label = "等待手写";
      else if (!hasMapping(state.settings)) label = "待配置映射";
      else if (trackingError) { label = "识别受阻"; tone = " blocked"; }
      else if (waitingForInk) { label = "等待笔迹稳定"; tone = " waiting"; }
      else { label = "跟踪中"; tone = " active"; }
    }
    badge.textContent = label; badge.className = "tracking-status" + tone;
  }
  function readyStatus(snapshot) {
    if (!snapshot.available) { status(snapshot.reason || "请先在脑图中选一张卡片。"); return; }
    if (!snapshot.source) { status("没有可读取的手写绘图，普通图片不参与自动识别。"); return; }
    if (!hasMapping(snapshot.settings)) { status("请展开“颜色映射”，设置笔迹对应的卡片色号。"); return; }
    status(snapshot.settings.auto ? "等待笔迹变化，保存后自动识别。" : "已就绪，点击“立即识别并改色”。");
  }
  function settingsSummary(settings) {
    var mappings = config.mappingEntries.filter(function (color) { return settings.mapping[color.id] >= 0; });
    element("mapping-summary").textContent = mappings.length ? mappings.map(function (color) {
      return color.label + " → " + (settings.mapping[color.id] + 1);
    }).join("；") : "尚未启用颜色映射";
    element("rules-summary").textContent = settings.policy === "red" ? "有红色就设为红色" : settings.policy === "priority" ? "按颜色优先级" : "主要颜色 · 占比 " + Math.round(settings.dominance * 100) + "%";
  }
  function closePreview(restoreFocus) {
    var opened = !element("preview-dialog").hidden;
    element("preview-dialog").hidden = true;
    element("preview-large-image").removeAttribute("src");
    element("panel-content").removeAttribute("aria-hidden");
    document.body.className = "";
    if (opened && restoreFocus && typeof element("preview-zoom").focus === "function") element("preview-zoom").focus();
  }
  function zoomPreview() {
    if (element("preview-wrap").hidden) return;
    element("preview-large-image").src = element("preview-image").src;
    element("preview-large-note").textContent = element("preview-note").textContent;
    element("preview-dialog").hidden = false;
    element("panel-content").setAttribute("aria-hidden", "true");
    document.body.className = "preview-open";
    element("preview-close").focus();
  }
  function previewButton() {
    var opened = !element("preview-wrap").hidden;
    element("preview").textContent = previewLoading ? "生成中…" : opened ? "收起" : "预览";
    element("preview").setAttribute("aria-expanded", String(opened));
  }
  function previewOpen(opened) {
    if (!opened) closePreview(false);
    element("preview-wrap").hidden = !opened;
    previewButton();
  }
  function previewKey(source, scopeToken) {
    return JSON.stringify([scopeToken, source.noteId, source.index, source.hash]);
  }
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
    var changedCard = !previous || previous.noteId !== snapshot.noteId || previous.topicId !== snapshot.topicId || previous.scopeToken !== snapshot.scopeToken;
    var changedSource = changedCard || JSON.stringify(previous.source) !== JSON.stringify(snapshot.source);
    var changedSettings = !previous || JSON.stringify(previous.settings) !== JSON.stringify(snapshot.settings);
    if (changedSource || changedSettings) { waitingForInk = false; trackingError = false; resultTarget = null; }
    var available = snapshot.available;
    element("note-title").textContent = available ? snapshot.title : snapshot.reason;
    element("note-color").textContent = available ? "当前色号 " + (snapshot.colorIndex + 1) : "";
    controls();
    if (changedSource) element("source-diagnostic").hidden = true;
    element("source").textContent = snapshot.source ? "最后一条手写绘图 · 批注 " + (snapshot.source.index + 1) : "未找到手写绘图";
    if (changedSource) {
      previewCache = null; previewOpen(false);
      element("preview-image").removeAttribute("src"); element("preview-note").textContent = "";
      showCounts(null);
    }
    if (changedSettings) showCounts(null);
    var badge = element("source-badge");
    badge.textContent = snapshot.source ? "自动选择" : "无绘图";
    badge.className = "badge" + (snapshot.source ? " bound" : "");
    if (changedSource || changedSettings || resultTarget !== null && snapshot.colorIndex !== resultTarget) {
      resultTarget = null; readyStatus(snapshot);
    }
    settingsSummary(config.normalize(snapshot.settings));
    element("auto").checked = !!(snapshot.settings && snapshot.settings.auto);
    if (!available && !(snapshot.tracking && snapshot.topicId)) { controls(); return; }
    var settings = snapshot.settings;
    element("auto").checked = settings.auto;
    element("policy").value = settings.policy;
    element("min-pixels").value = settings.minPixels;
    element("dominance").value = String(settings.dominance);
    config.mappingEntries.forEach(function (color) { element("map-" + color.id).value = settings.mapping[color.id]; });
    element("settings-status").textContent = "设置已保存到此学习集";
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
    if (!state || !(state.available || state.tracking && state.topicId) || saving || busy) return;
    saving = true;
    controls();
    var snapshot = state, settings = config.normalize(snapshot.settings);
    settings.auto = element("auto").checked; settings.policy = element("policy").value;
    settings.minPixels = Number(element("min-pixels").value); settings.dominance = Number(element("dominance").value);
    config.mappingEntries.forEach(function (color) { settings.mapping[color.id] = Number(element("map-" + color.id).value); });
    try {
      await MNBridge.send("saveSettings", { noteId: snapshot.noteId, topicId: snapshot.topicId, scopeToken: snapshot.scopeToken, settings: settings });
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
    if (busy || saving) return;
    if (!element("preview-wrap").hidden) { previewOpen(false); status("预览已收起。"); return; }
    busy = true; previewLoading = true; controls();
    try {
      // 重开前核对当前媒体引用，复用未变化的图片；不重新读取或解码媒体。
      render(await MNBridge.send("readCurrent"));
      var source = selected(), scope = state.scopeToken, key = previewKey(source, scope);
      if (previewCache === key) { previewOpen(true); status("预览已展开，点击图片可放大。"); return; }
      previewCache = null; element("preview-image").removeAttribute("src");
      element("preview-note").textContent = "";
      status("正在生成预览…");
      var media = await MNBridge.send("readPreview", source);
      await loadImage(media.dataURL);
      var latest = await MNBridge.send("readCurrent"); render(latest);
      if (!latest.available || latest.scopeToken !== scope || latest.noteId !== source.noteId || !latest.source || latest.source.hash !== source.hash || latest.source.index !== source.index) {
        throw new Error("卡片或绘图已变化，请重新预览");
      }
      previewCache = key; element("preview-image").src = media.dataURL; previewOpen(true);
      var note = media.drawing && media.drawing.previewOnly
        ? "试验预览：请与 MN 中的笔迹核对是否缺笔、连线或保留了已擦除部分。这类绘图暂不参与单卡、自动及批量改色。"
        : "预览为近似渲染。";
      element("preview-note").textContent = note;
      status("预览已生成" + (media.drawing ? "，" + media.drawing.strokeCount + " 条笔画" : "") + "。点击图片可放大。");
    } catch (error) { status("预览失败：" + error.message, true); }
    finally { busy = false; previewLoading = false; controls(); }
  }
  async function inspectSources() {
    if (!state || !state.available || busy || diagnosing || InkToCardStartup.failed()) return;
    diagnosing = true; controls();
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
    finally { diagnosing = false; controls(); }
  }
  async function exportDrawingSample() {
    if (busy || saving || InkToCardStartup.failed()) return;
    busy = true; controls();
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
  function loadImage(dataURL) {
    return new Promise(function (resolve, reject) {
      var image = new Image(), finished = false;
      function finish(error) {
        if (finished) return;
        finished = true; clearTimeout(timer);
        image.onload = null; image.onerror = null;
        if (error) reject(error); else resolve();
      }
      var timer = setTimeout(function () { finish(new Error("预览图片加载超时，请重试")); }, 15000);
      image.onload = function () { finish(); };
      image.onerror = function () { finish(new Error("预览图片无法显示")); };
      image.src = dataURL;
    });
  }
  async function recognize(snapshot, automatic, valid) {
    if (busy || saving || !snapshot || !snapshot.source) return false;
    busy = true; waitingForInk = false; trackingError = false; controls();
    try {
      status(automatic ? "正在自动识别…" : "正在识别笔迹颜色…");
      var source = snapshot.source, settingsToken = JSON.stringify(snapshot.settings);
      var media = await MNBridge.send("readMedia", { noteId: snapshot.noteId, index: source.index, hash: source.hash });
      var image = await pixels(media.dataURL);
      var histogram = InkToCardCore.histogram(image.data, image.width, image.height, snapshot.settings);
      if (valid && !valid()) return true;
      var result = await MNBridge.send("applyResult", { noteId: snapshot.noteId, index: source.index, hash: source.hash,
        settingsToken: settingsToken, expectedColorIndex: snapshot.colorIndex, automatic: automatic, histogram: histogram, scopeToken: snapshot.scopeToken });
      showCounts(result.counts);
      var color = config.mappingEntries.find(function (item) { return item.id === result.color; });
      var label = color ? color.label + (result.color === "uncolored" ? "" : "笔迹") : "";
      var success = result.status === "applied" || result.status === "unchanged";
      resultTarget = success ? result.colorIndex : null;
      status(success ? label + " → " + (result.status === "applied" ? "已设置卡片色号 " : "已是卡片色号 ") + (result.colorIndex + 1)
        : (label ? label + " · " : "") + result.reason, false, success);
      if (automatic) lastAuto = true;
    } catch (error) { trackingError = true; status(error.message, true); }
    finally { busy = false; await refresh(); controls(); }
    return true;
  }
  async function runBatch(scope) {
    if (busy || saving || diagnosing || InkToCardStartup.failed()) return;
    busy = true; batch = { id: null, cancelled: false }; controls();
    element("batch-section").open = true;
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
      if (!snapshot.available || !snapshot.settings.auto || !snapshot.source) { observation = ""; waitingForInk = false; trackingStatus(); return; }
      var key = snapshot.scopeToken + ":" + snapshot.noteId + ":" + snapshot.source.index + ":" + snapshot.source.hash + ":" + JSON.stringify(snapshot.settings);
      // 至少间隔 300 毫秒确认同一媒体，避免积压的定时回调跳过稳定等待。
      if (key !== observation) { observation = key; observedAt = Date.now(); waitingForInk = true; trackingStatus(); return; }
      if (Date.now() - observedAt < 300) return;
      waitingForInk = false; trackingStatus();
      var attemptKey = snapshot.topicId + ":" + snapshot.noteId + ":" + snapshot.source.index + ":" + snapshot.source.hash + ":" + JSON.stringify(snapshot.settings);
      if (attempted.has(attemptKey)) return;
      attempted.set(attemptKey, true);
      if (attempted.size > 100) attempted.delete(attempted.keys().next().value);
      await recognize(snapshot, true);
    } catch (error) { status(error.message, true); }
    finally { polling = false; }
  }
  function init() {
    if (InkToCardStartup.failed()) return;
    var mapping = element("mapping");
    config.mappingEntries.forEach(function (color) {
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
    element("preview-zoom").addEventListener("click", zoomPreview);
    element("preview-close").addEventListener("click", function () { closePreview(true); });
    element("preview-dialog").addEventListener("click", function (event) { if (event.target === element("preview-dialog")) closePreview(true); });
    document.addEventListener("keydown", function (event) {
      if (element("preview-dialog").hidden) return;
      if (event.key === "Escape") { event.preventDefault(); closePreview(true); }
      // 放大预览只有一个按钮，键盘焦点保持在关闭按钮，避免进入被遮住的面板。
      if (event.key === "Tab") { event.preventDefault(); element("preview-close").focus(); }
    });
    element("inspect-sources").addEventListener("click", inspectSources);
    element("export-sample").addEventListener("click", exportDrawingSample);
    element("open-community").addEventListener("click", async function () {
      try { await MNBridge.send("openCommunity"); }
      catch (error) { status(error.message, true); }
    });
    element("batch-selected").addEventListener("click", function () { runBatch("selected"); });
    element("batch-notebook").addEventListener("click", function () { runBatch("notebook"); });
    element("batch-cancel").addEventListener("click", cancelBatch);
    element("recognize").addEventListener("click", async function () { await refresh(); await recognize(state, false); });
    InkToCardStartup.initialized();
    refresh();
    if (window.InkToCardDemoBridge) setInterval(tick, 300);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  return { tick: tick, refresh: refresh, runBatch: runBatch, cancelBatch: cancelBatch, inspectSources: inspectSources, exportDrawingSample: exportDrawingSample, lastAuto: function () { return lastAuto; } };
})();
