var InkToCardCore = (function () {
  var config = __INK_TO_CARD_CONFIG__;
  function hue(r, g, b) {
    var max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    if (!delta) return { h: 0, s: 0, v: max / 255 };
    var h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return { h: (h * 60 + 360) % 360, s: delta / max, v: max / 255 };
  }
  function family(h) {
    if (h < 18 || h >= 345) return "red";
    if (h < 43) return "orange";
    if (h < 75) return "yellow";
    if (h < 165) return "green";
    if (h < 200) return "cyan";
    if (h < 265) return "blue";
    return "purple";
  }
  function empty() {
    var counts = {};
    config.colors.forEach(function (color) { counts[color.id] = 0; });
    return { counts: counts, pixels: 0, colored: 0, visible: 0 };
  }
  function histogram(data, width, height, settings) {
    if (!data || data.length !== width * height * 4 || !width || !height) throw new Error("图片像素无效");
    var options = config.normalize(settings), result = empty();
    result.pixels = width * height;
    // 透明像素、黑灰白与抗锯齿浅色边缘不参与颜色投票。
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 64) continue;
      result.visible += data[i + 3] / 255;
      var hsv = hue(data[i], data[i + 1], data[i + 2]);
      if (hsv.s < options.saturation || hsv.v < 0.15) continue;
      result.counts[family(hsv.h)] += data[i + 3] / 255;
      result.colored += data[i + 3] / 255;
    }
    return result;
  }
  function choose(histogram, settings) {
    var options = config.normalize(settings);
    var entries = config.colors.map(function (color) { return { id: color.id, count: histogram.counts[color.id] || 0 }; });
    var threshold = Math.max(options.minPixels, histogram.pixels * options.minRatio);
    // 无彩色必须严格为零，不能把少量彩色、未映射或多色冲突当作无彩色。
    if (options.mapping.uncolored >= 0 && histogram.colored === 0) {
      if (typeof histogram.visible !== "number" || !isFinite(histogram.visible) || histogram.visible < threshold) {
        return { status: "insufficient", reason: "未确认足量可见手写，保持原色", counts: histogram.counts };
      }
      return { status: "matched", color: "uncolored", colorIndex: options.mapping.uncolored,
        reason: "已确认无彩色书写", counts: histogram.counts, confidence: 1, pixels: histogram.visible };
    }
    if (options.policy === "red") {
      var red = histogram.counts.red || 0, target = options.mapping.red;
      if (red < threshold) return { status: "insufficient", reason: "红色笔迹未达到最低量，保持原色", counts: histogram.counts };
      return { status: target >= 0 ? "matched" : "unmapped", color: "red", colorIndex: target,
        reason: target >= 0 ? "已识别红色" : "请先设置红色对应的卡片色号", counts: histogram.counts,
        confidence: red / Math.max(histogram.colored, 1), pixels: red };
    }
    var eligible = entries.filter(function (entry) { return entry.count >= threshold; });
    if (!eligible.length) return { status: "insufficient", reason: "彩色笔迹太少，保持原色", counts: histogram.counts };
    var winner;
    if (options.policy === "priority") {
      winner = eligible.find(function (entry) { return options.mapping[entry.id] >= 0; });
      if (!winner) return { status: "unmapped", reason: "检测到的颜色尚未设置目标色号", counts: histogram.counts };
    } else {
      eligible.sort(function (a, b) { return b.count - a.count; });
      winner = eligible[0];
      if (winner.count / Math.max(histogram.colored, 1) < options.dominance) {
        return { status: "ambiguous", reason: "多种颜色接近，保持原色", counts: histogram.counts };
      }
    }
    var target = options.mapping[winner.id];
    return { status: target >= 0 ? "matched" : "unmapped", color: winner.id, colorIndex: target,
      reason: target >= 0 ? "已识别" : "该笔迹颜色尚未设置目标色号", counts: histogram.counts,
      confidence: winner.count / Math.max(histogram.colored, 1), pixels: winner.count };
  }
  function drawingHasColor(drawing, settings) {
    var options = config.normalize(settings);
    return drawing.colors.some(function (hex) {
      var color = hue(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
      // 原始笔色仍有彩色时不作无彩色判断，避免缩放、遮挡或深色使预览漏掉少量彩色。
      return color.s >= options.saturation;
    });
  }
  return { hue: hue, family: family, histogram: histogram, choose: choose, drawingHasColor: drawingHasColor };
})();
