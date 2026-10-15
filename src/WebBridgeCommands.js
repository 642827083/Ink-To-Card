var __INK_TO_CARD_COMMANDS__ = (function () {
  var native = __INK_TO_CARD_NATIVE__;
  return {
    readCurrent: function (addon) { return native.snapshot(addon); },
    inspectSources: function (addon, payload) { return native.inspectSources(addon, payload); },
    exportDrawingSample: function (addon, payload) { return native.exportDrawingSample(addon, payload); },
    saveSettings: function (addon, payload) { return native.saveSettings(addon, payload); },
    readMedia: function (addon, payload) { return native.readDrawing(addon, payload); },
    beginBatch: function (addon, payload) { return __INK_TO_CARD_BATCH__.begin(addon, payload); },
    prepareBatchCard: function (addon, payload) { return __INK_TO_CARD_BATCH__.prepare(addon, payload); },
    applyBatchResult: function (addon, payload) { return __INK_TO_CARD_BATCH__.apply(addon, payload); },
    endBatch: function (addon, payload) { return __INK_TO_CARD_BATCH__.end(addon, payload); },
    applyResult: function (addon, payload) { return native.apply(addon, payload); }
  };
})();
