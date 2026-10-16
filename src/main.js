JSB.require("InkToCardConfig");
JSB.require("InkToCardCore");
JSB.require("InkToCardDrawing");
JSB.require("InkToCardNative");
JSB.require("InkToCardBatch");
JSB.require("WebBridgeCommands");
JSB.require("InkToCardPanel");
JSB.require("InkToCardToolbar");
JSB.require("InkToCardAddon");

JSB.newAddon = function (mainPath) {
  return createInkToCardAddon(mainPath);
};
