var __INK_TO_CARD_PANEL__ = (function () {
  function evaluate(controller, script) {
    if (controller && controller.webView) controller.webView.evaluateJavaScript(script, function () {});
  }
  function reply(controller, requestId, payload, error) {
    var response = JSON.stringify({ requestId: requestId, payload: payload === undefined ? null : payload,
      error: error ? String(error.message || error) : null });
    evaluate(controller, "window.InkToCardReceive&&window.InkToCardReceive(" + response.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029") + ")");
  }
  function layout(controller) {
    var frame = controller.view.bounds;
    controller.titleBar.frame = { x: 0, y: 0, width: frame.width, height: 38 };
    controller.titleLabel.frame = { x: 14, y: 0, width: frame.width - 62, height: 38 };
    controller.closeButton.frame = { x: frame.width - 40, y: 0, width: 36, height: 38 };
    controller.webView.frame = { x: 0, y: 38, width: frame.width, height: Math.max(1, frame.height - 38) };
  }
  function clamp(controller) {
    var study = Application.sharedInstance().studyController(controller.addon.window);
    if (!study || !study.view) return;
    var bounds = study.view.bounds, old = controller.view.frame;
    var width = Math.min(430, Math.max(240, bounds.width - 16));
    var height = Math.min(650, Math.max(180, bounds.height - 16));
    controller.view.frame = { x: Math.max(8, Math.min(old.x || 16, bounds.width - width - 8)),
      y: Math.max(8, Math.min(old.y || 16, bounds.height - height - 8)), width: width, height: height };
    layout(controller);
  }
  var PanelClass = JSB.defineClass("InkToCardPanelController : UIViewController <UIWebViewDelegate>", {
    viewDidLoad: function () {
      self.view.backgroundColor = UIColor.whiteColor();
      self.view.layer.cornerRadius = 14;
      self.view.layer.masksToBounds = true;
      self.titleBar = new UIView({ x: 0, y: 0, width: 430, height: 38 });
      self.titleBar.backgroundColor = UIColor.colorWithWhiteAlpha(0.95, 1);
      self.view.addSubview(self.titleBar);
      self.titleLabel = new UILabel({ x: 14, y: 0, width: 300, height: 38 });
      self.titleLabel.text = "Ink To Card";
      self.titleLabel.font = UIFont.boldSystemFontOfSize(15);
      self.titleLabel.textColor = UIColor.blackColor();
      self.titleBar.addSubview(self.titleLabel);
      self.titleBar.addGestureRecognizer(new UIPanGestureRecognizer(self, "movePanel:"));
      self.closeButton = new UIButton({ x: 390, y: 0, width: 36, height: 38 });
      self.closeButton.setTitleForState("×", 0);
      self.closeButton.setTitleColorForState(UIColor.grayColor(), 0);
      self.closeButton.titleLabel.font = UIFont.systemFontOfSize(25);
      self.closeButton.addTargetActionForControlEvents(self, "closePanel:", 1 << 6);
      self.titleBar.addSubview(self.closeButton);
      self.webView = new UIWebView({ x: 0, y: 38, width: 430, height: 612 });
      self.webView.delegate = self;
      self.webView.scalesPageToFit = false;
      self.view.addSubview(self.webView);
      layout(self);
    },
    viewDidLayoutSubviews: function () { if (self.webView) layout(self); },
    closePanel: function () {
      self.view.hidden = true;
      var study = Application.sharedInstance().studyController(self.addon.window);
      if (study) study.refreshAddonCommands();
    },
    movePanel: function (gesture) {
      if (!self.view.superview) return;
      var delta = gesture.translationInView(self.view.superview), frame = self.view.frame;
      self.view.frame = { x: frame.x + delta.x, y: frame.y + delta.y, width: frame.width, height: frame.height };
      gesture.setTranslationInView({ x: 0, y: 0 }, self.view.superview);
      if (gesture.state === 3) clamp(self);
    },
    webViewDidFinishLoad: function () { self.ready = true; evaluate(self, "window.InkToCardApp&&window.InkToCardApp.tick()"); },
    webViewShouldStartLoadWithRequestNavigationType: function (webView, request) {
      var address = String(__INK_TO_CARD_NATIVE__.value(__INK_TO_CARD_NATIVE__.value(request, "URL"), "absoluteString") || "");
      if (address.indexOf("inktocard://bridge?payload=") !== 0) return address.indexOf("file:") === 0 || address === "about:blank";
      var controller = self, message;
      try {
        message = JSON.parse(decodeURIComponent(address.slice("inktocard://bridge?payload=".length)));
        if (!message || typeof message.requestId !== "string" || typeof message.command !== "string") throw new Error("桥接消息无效");
        if (!Object.prototype.hasOwnProperty.call(__INK_TO_CARD_COMMANDS__, message.command)) throw new Error("不支持的插件命令");
        var result = __INK_TO_CARD_COMMANDS__[message.command](controller.addon, message.payload || {});
        reply(controller, message.requestId, result, null);
      } catch (error) {
        console.log("[Ink To Card] " + String(error.message || error));
        reply(controller, message && message.requestId || "", null, error);
      }
      return false;
    }
  });
  function create(addon, mainPath) {
    var controller = PanelClass.new();
    controller.addon = addon;
    controller.view.frame = { x: 16, y: 16, width: 430, height: 650 };
    controller.view.hidden = true;
    var url = NSURL.fileURLWithPath(mainPath + "/web/index.html");
    controller.webView.loadRequest(NSURLRequest.requestWithURL(url));
    return controller;
  }
  function attach(controller) {
    var study = Application.sharedInstance().studyController(controller.addon.window);
    if (!study || !study.view) return false;
    if (!controller.view.superview) study.view.addSubview(controller.view);
    clamp(controller);
    return true;
  }
  return { create: create, attach: attach, layout: clamp, evaluate: evaluate };
})();
