var __INK_TO_CARD_CONFIG__ = (function () {
  var colors = [
    { id: "red", label: "红色", hex: "#e64b53" },
    { id: "orange", label: "橙色", hex: "#e99533" },
    { id: "yellow", label: "黄色", hex: "#dab72f" },
    { id: "green", label: "绿色", hex: "#47aa71" },
    { id: "cyan", label: "青色", hex: "#2baeb3" },
    { id: "blue", label: "蓝色", hex: "#4b80dc" },
    { id: "purple", label: "紫色", hex: "#a669cd" }
  ];
  function bounded(value, fallback, min, max) {
    return typeof value === "number" && isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  }
  function normalize(value) {
    var input = value || {};
    var mapping = {};
    colors.forEach(function (color) {
      var index = input.mapping && input.mapping[color.id];
      mapping[color.id] = typeof index === "number" && index % 1 === 0 && index >= 0 && index <= 15 ? index : -1;
    });
    return {
      schema: 1,
      auto: input.auto === true,
      mapping: mapping,
      minPixels: Math.round(bounded(input.minPixels, 30, 5, 10000)),
      minRatio: bounded(input.minRatio, 0.00005, 0, 0.1),
      saturation: bounded(input.saturation, 0.32, 0.1, 0.9),
      dominance: bounded(input.dominance, 0.6, 0.51, 1),
      policy: input.policy === "red" ? "red" : input.policy === "priority" ? "priority" : "dominant"
    };
  }
  return { colors: colors, normalize: normalize };
})();
