function createInkToCardSceneAddon() {
  // 官方融合模式：场景面板接收 MN5 事件，原生层保管配置并读取独立绘图。
  function invalidate(addon) {
    addon.inkSceneEpoch = (addon.inkSceneEpoch || 0) + 1;
    addon.inkBatch = null;
  }
  function post(addon, active) {
    if (addon.inkScenePanel) addon.inkScenePanel.post("inkSession", { active: active });
  }
  function close(addon) {
    invalidate(addon);
    var panel = addon.inkScenePanel;
    addon.inkScenePanel = null;
    addon.inkSceneVisible = false;
    if (panel) { panel.onMessage = null; panel.hideFloating(); }
  }
  function create(addon) {
    var panel = AddonWebPanel.panel();
    panel.maxContentHeight = 650;
    panel.onMessage = function (name, payload) {
      if (addon.inkScenePanel !== panel) throw new Error("面板已关闭，请重新打开");
      if (!Object.prototype.hasOwnProperty.call(__INK_TO_CARD_COMMANDS__, name)) throw new Error("不支持的插件命令");
      return __INK_TO_CARD_COMMANDS__[name](addon, payload || {});
    };
    addon.inkScenePanel = panel;
    if (panel.loadPanel() === false) {
      addon.inkScenePanel = null; panel.onMessage = null; panel.teardown();
      throw new Error("MN5 场景面板加载失败，请重新安装测试包");
    }
    return panel;
  }
  return JSB.defineClass("InkToCardSceneAddon : JSExtension", {
    sceneWillConnect: function () {
      self.inkSceneMode = true;
      self.inkSceneEpoch = 1;
      self.inkInactive = false;
      var study = Application.sharedInstance().studyController(self.window);
      self.inkNotebookOpen = !!(study && study.notebookController && study.notebookController.notebookId);
    },
    sceneWillResignActive: function () { self.inkInactive = true; invalidate(self); post(self, false); },
    sceneDidBecomeActive: function () { self.inkInactive = false; post(self, !!self.inkNotebookOpen); },
    sceneDidDisconnect: function () { self.inkInactive = true; self.inkNotebookOpen = false; close(self); },
    notebookWillOpen: function () { invalidate(self); self.inkTargetId = null; self.inkNotebookOpen = true; post(self, !self.inkInactive); },
    notebookWillClose: function () { self.inkNotebookOpen = false; self.inkTargetId = null; close(self); },
    queryAddonCommandStatus: function () {
      return { image: "icon.png", object: self, selector: "toggleInkToCard:", checked: !!(self.inkSceneVisible && self.inkScenePanel && self.inkScenePanel.onMessage) };
    },
    toggleInkToCard: function () {
      if (typeof AddonWebPanel === "undefined" || typeof AddonWebPanel.panel !== "function") {
        Application.sharedInstance().showHUD("此测试包需要 MN5 场景插件接口，请使用 MN5 并在场景中启用插件", self.window, 3); return;
      }
      if (self.inkSceneVisible && self.inkScenePanel && self.inkScenePanel.onMessage) { close(self); return; }
      if (self.inkScenePanel) close(self);
      var study = Application.sharedInstance().studyController(self.window);
      if (!study || !study.notebookController || !study.notebookController.notebookId) {
        Application.sharedInstance().showHUD("请先打开一个学习集", self.window, 2); return;
      }
      self.inkNotebookOpen = true;
      var panel = self.inkScenePanel || create(self);
      panel.showFloatingIn(study);
      self.inkSceneVisible = true;
    }
  });
}
