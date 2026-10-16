var __INK_TO_CARD_TOOLBAR__ = (function () {
  var DOUBLE_CLICK_SECONDS = 0.3;
  function message(addon, text) {
    var app = Application.sharedInstance();
    if (typeof app.showHUD === "function") app.showHUD(text, addon.window, 2);
  }
  function cancelClick(addon) {
    addon.inkClickToken = Number(addon.inkClickToken || 0) + 1;
    addon.inkClickPending = false;
    var timer = addon.inkClickTimer; addon.inkClickTimer = null;
    if (timer && typeof timer.invalidate === "function") timer.invalidate();
  }
  function valid(addon, scope) {
    return !addon.inkInactive && addon.inkNotebookOpen !== false && __INK_TO_CARD_NATIVE__.scopeToken(addon) === scope;
  }
  function singleClick(addon) {
    try { __INK_TO_CARD_PANEL__.toggle(addon); }
    catch (error) { message(addon, "暂时无法打开插件面板"); console.log("[Ink To Card] " + error.message); }
  }
  function doubleClick(addon, scope) {
    try {
      var settings = __INK_TO_CARD_NATIVE__.toggleFollow(addon, scope);
      // 与 Focus Switch 一致，双击切换功能并收起设置面板，不触发单击开合。
      if (addon.inkPanel) {
        addon.inkPanel.view.hidden = true;
        if (addon.inkPanel.ready) __INK_TO_CARD_PANEL__.evaluate(addon.inkPanel, "window.InkToCardApp&&window.InkToCardApp.refresh()");
      }
      message(addon, settings.auto ? "自动跟随已开启" : "自动跟随已关闭");
    } catch (error) { message(addon, String(error.message || error)); }
  }
  function click(addon) {
    if (addon.inkInactive || addon.inkNotebookOpen === false) { cancelClick(addon); message(addon, "请先打开一个学习集"); return; }
    var now = Date.now(), scope = __INK_TO_CARD_NATIVE__.scopeToken(addon);
    if (addon.inkClickPending) {
      var elapsed = now - Number(addon.inkClickAt), previousScope = addon.inkClickScope;
      cancelClick(addon);
      if (scope === previousScope && elapsed >= 0 && elapsed <= DOUBLE_CLICK_SECONDS * 1000) {
        doubleClick(addon, scope); return;
      }
      // 定时器回调延迟时补执行已到期的单击；切集后的旧动作直接丢弃。
      if (elapsed > DOUBLE_CLICK_SECONDS * 1000 && valid(addon, previousScope)) singleClick(addon);
    }
    if (typeof NSTimer === "undefined" || typeof NSTimer.scheduledTimerWithTimeInterval !== "function") { singleClick(addon); return; }
    addon.inkClickPending = true; addon.inkClickAt = now; addon.inkClickScope = scope;
    var token = Number(addon.inkClickToken || 0) + 1; addon.inkClickToken = token;
    addon.inkClickTimer = NSTimer.scheduledTimerWithTimeInterval(DOUBLE_CLICK_SECONDS, false, function () {
      if (addon.inkClickToken !== token || !addon.inkClickPending) return;
      addon.inkClickPending = false; addon.inkClickTimer = null;
      if (valid(addon, scope)) singleClick(addon);
    });
  }
  return { click: click, cancelClick: cancelClick };
})();
