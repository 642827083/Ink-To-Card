function createInkToCardAddon(mainPath) {
  return JSB.defineClass("InkToCardAddon : JSExtension", {
    sceneWillConnect: function () {
      var addon = self;
      addon.inkClassicTracking = true;
      addon.inkSceneEpoch = 1;
      addon.inkTargetId = null;
      addon.inkTargetTopic = null;
      addon.inkPanel = __INK_TO_CARD_PANEL__.create(addon, mainPath);
      addon.inkTimer = NSTimer.scheduledTimerWithTimeInterval(0.3, true, function () {
        if (!addon.inkPanel || !addon.inkPanel.ready || !addon.inkNotebookOpen || addon.inkInactive) return;
        __INK_TO_CARD_PANEL__.evaluate(addon.inkPanel, "window.InkToCardApp&&window.InkToCardApp.tick()");
      });
      console.log("[Ink To Card] 已初始化 MN4 经典插件");
    },
    sceneWillResignActive: function () { self.inkInactive = true; self.inkBatch = null; self.inkSceneEpoch += 1; },
    sceneDidBecomeActive: function () { self.inkInactive = false; },
    sceneDidDisconnect: function () {
      if (self.inkTimer) self.inkTimer.invalidate();
      self.inkTimer = null;
      if (self.inkPanel) {
        self.inkPanel.webView.stopLoading();
        self.inkPanel.webView.delegate = null;
        self.inkPanel.view.removeFromSuperview();
      }
      self.inkPanel = null;
      self.inkNotebookOpen = false;
      self.inkBatch = null;
      self.inkTargetId = null;
      self.inkTargetTopic = null;
      self.inkSceneEpoch += 1;
    },
    notebookWillOpen: function () {
      self.inkTargetId = null;
      self.inkTargetTopic = null;
      self.inkSceneEpoch += 1;
      self.inkNotebookOpen = true;
      if (self.inkPanel) __INK_TO_CARD_PANEL__.attach(self.inkPanel);
    },
    notebookWillClose: function () {
      self.inkTargetId = null;
      self.inkTargetTopic = null;
      self.inkSceneEpoch += 1;
      self.inkNotebookOpen = false;
      self.inkBatch = null;
      if (self.inkPanel) self.inkPanel.view.hidden = true;
    },
    controllerWillLayoutSubviews: function (controller) {
      if (self.inkPanel && controller === Application.sharedInstance().studyController(self.window)) __INK_TO_CARD_PANEL__.layout(self.inkPanel);
    },
    queryAddonCommandStatus: function () {
      return { image: "icon.png", object: self, selector: "toggleInkToCard:", checked: !!(self.inkPanel && !self.inkPanel.view.hidden) };
    },
    toggleInkToCard: function () {
      if (!self.inkPanel || !__INK_TO_CARD_PANEL__.attach(self.inkPanel)) {
        Application.sharedInstance().showHUD("请先打开一个学习集", self.window, 2);
        return;
      }
      self.inkPanel.view.hidden = !self.inkPanel.view.hidden;
      if (!self.inkPanel.view.hidden) {
        self.inkPanel.view.superview.bringSubviewToFront(self.inkPanel.view);
        __INK_TO_CARD_PANEL__.evaluate(self.inkPanel, "window.InkToCardApp&&window.InkToCardApp.refresh()");
      }
      Application.sharedInstance().studyController(self.window).refreshAddonCommands();
    }
  });
}
