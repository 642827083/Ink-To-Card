(function () {
  // 演示模式只在显式加上 ?demo=1 时启用，不写入 MN 或浏览器持久存储。
  if (!/(?:\?|&)demo=1(?:&|$)/.test(window.location.search)) return;
  var settings = __INK_TO_CARD_CONFIG__.normalize({ mapping: { red: 3, yellow: 0, green: 1, blue: 2 } });
  var canvas = document.createElement("canvas"); canvas.width = 520; canvas.height = 180;
  var context = canvas.getContext("2d");
  context.fillStyle = "#fff"; context.fillRect(0, 0, 520, 180);
  context.fillStyle = "#df4149"; context.font = "32px cursive";
  context.fillText("Review this idea", 26, 68);
  context.strokeStyle = "#df4149"; context.lineWidth = 4;
  context.beginPath(); context.moveTo(26, 92); context.quadraticCurveTo(180, 108, 322, 92); context.stroke();
  var source = { index: 1, hash: "drawing:demo-red", kind: "drawing" }, colorIndex = 0, batchId = null;
  window.InkToCardDemoBridge = {
    send: async function (command, payload) {
      if (command === "readCurrent") return { available: true, noteId: "demo", topicId: "demo-topic", title: "示例卡片 · 红色笔迹", colorIndex: colorIndex,
        settings: settings, sources: [source], source: source, bindingInvalid: false };
      if (command === "readMedia" || command === "readPreview") return { dataURL: canvas.toDataURL("image/png"), index: source.index, hash: source.hash, drawing: {strokeCount: 2} };
      if (command === "saveSettings") { settings = __INK_TO_CARD_CONFIG__.normalize(payload.settings); return settings; }
      if (command === "beginBatch") { batchId = "demo-batch"; return {batchId: batchId, total: 3, settings: settings}; }
      if (command === "prepareBatchCard") {
        if (!batchId) throw new Error("演示任务已取消");
        if (payload.position === 2) return {noteId: "demo-2", title: "示例 · 普通图片", skipped: true, reason: "没有可读取的手写绘图"};
        return {noteId: "demo-" + payload.position, title: "示例手写卡片", media: {dataURL: canvas.toDataURL("image/png")}};
      }
      if (command === "applyBatchResult") {
        if (!batchId) throw new Error("演示任务已取消");
        var batchResult = InkToCardCore.choose(payload.histogram, settings);
        if (batchResult.status === "matched") { batchResult.status = "applied"; batchResult.reason = "演示：已设置卡片色号 " + (batchResult.colorIndex + 1); }
        return batchResult;
      }
      if (command === "endBatch") { batchId = null; return {ended: true}; }
      if (command === "applyResult") {
        var result = InkToCardCore.choose(payload.histogram, settings);
        if (result.status === "matched") { colorIndex = result.colorIndex; result.status = "applied"; result.reason = "演示：已设置卡片色号 " + (colorIndex + 1); }
        return result;
      }
      throw new Error("演示命令不可用");
    }
  };
})();
