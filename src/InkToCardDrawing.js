var __INK_TO_CARD_DRAWING__ = (function () {
  // 只解析真机已验证的 wrd 笔画格式；不依赖未导出的 PencilKit 原生类。
  // 字段结构交叉核对：https://github.com/can1357/libfreeform/blob/main/src/pkdrawing.rs
  var MAX_BYTES = 12 * 1024 * 1024, MAX_POINTS = 40000, MAX_STROKES = 3000;
  function fail(reason) { throw new Error("绘图格式暂不支持：" + reason); }
  function decodeBase64(encoded, length) {
    if (!Number.isInteger(length) || length < 3 || length > MAX_BYTES || typeof encoded !== "string"
      || encoded.length !== Math.ceil(length / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail("原始数据编码或长度无效");
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", bytes = new Uint8Array(length), cursor = 0;
    for (var i = 0; i < encoded.length; i += 4) {
      var a = alphabet.indexOf(encoded[i]), b = alphabet.indexOf(encoded[i + 1]);
      var c = alphabet.indexOf(encoded[i + 2]), d = alphabet.indexOf(encoded[i + 3]);
      if (a < 0 || b < 0 || (c < 0 && encoded[i + 2] !== "=") || (d < 0 && encoded[i + 3] !== "=")) fail("Base64 字符无效");
      bytes[cursor++] = (a << 2) | (b >> 4);
      if (c >= 0) bytes[cursor++] = ((b & 15) << 4) | (c >> 2);
      if (d >= 0) bytes[cursor++] = ((c & 3) << 6) | d;
      if ((c < 0 || d < 0) && i + 4 !== encoded.length) fail("Base64 填充位置无效");
      if (c < 0 && (d >= 0 || (b & 15))) fail("Base64 填充无效");
      if (d < 0 && c >= 0 && (c & 3)) fail("Base64 填充无效");
    }
    if (cursor !== length) fail("Base64 字节数不一致");
    return bytes;
  }
  function fields(bytes) {
    var offset = 0, result = [], view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    function need(count) { if (offset + count > bytes.length) fail("数据被截断"); }
    function varint() {
      var value = 0, multiplier = 1;
      for (var i = 0; i < 8; i += 1) {
        need(1); var byte = bytes[offset++]; value += (byte & 127) * multiplier;
        if (!Number.isSafeInteger(value)) fail("整数溢出");
        if (!(byte & 128)) return value;
        multiplier *= 128;
      }
      fail("整数过长");
    }
    while (offset < bytes.length) {
      if (result.length >= 20000) fail("字段数量过多");
      var tag = varint(), number = Math.floor(tag / 8), wire = tag % 8, value;
      if (number < 1 || number > 536870911) fail("字段编号无效");
      if (wire === 0) value = varint();
      else if (wire === 2) { var size = varint(); need(size); value = bytes.subarray(offset, offset + size); offset += size; }
      else if (wire === 5) { need(4); value = view.getFloat32(offset, true); offset += 4; }
      else if (wire === 1) { need(8); value = bytes.subarray(offset, offset + 8); offset += 8; }
      else fail("未知二进制字段类型");
      result.push({ number: number, wire: wire, value: value });
    }
    return result;
  }
  function one(records, number, wire, optional) {
    var found = records.filter(function (record) { return record.number === number; });
    if (!found.length && optional) return null;
    if (found.length !== 1 || found[0].wire !== wire) fail("字段 " + number + " 缺失、重复或类型变化");
    return found[0].value;
  }
  function known(records, types) {
    records.forEach(function (record) {
      if (types[record.number] !== record.wire) fail("发现未验证字段 " + record.number);
    });
  }
  function floats(bytes, count) {
    var records = fields(bytes), values = [];
    records.forEach(function (record) { if (record.number > count || record.wire !== 5) fail("浮点结构变化"); });
    for (var i = 1; i <= count; i += 1) {
      var value = one(records, i, 5);
      if (!isFinite(value)) fail("浮点数无效");
      values.push(value);
    }
    return values;
  }
  function ink(bytes) {
    var records = fields(bytes); known(records, { 1: 2, 2: 2, 3: 0, 8: 1 });
    var color = floats(one(records, 1, 2), 4), nameBytes = one(records, 2, 2), identifier = "";
    for (var i = 0; i < nameBytes.length; i += 1) identifier += String.fromCharCode(nameBytes[i]);
    if (identifier !== "com.apple.ink.pen") fail("当前仅支持普通笔，笔刷为 " + identifier.slice(0, 80));
    if (one(records, 3, 0, true) !== 3) fail("笔色模型变化");
    color.forEach(function (channel) { if (channel < 0 || channel > 1) fail("笔色范围无效"); });
    var hex = "#";
    color.slice(0, 3).forEach(function (channel) { hex += ("0" + Math.round(channel * 255).toString(16)).slice(-2); });
    return { color: hex, alpha: color[3] };
  }
  function points(bytes, transform, budget) {
    var records = fields(bytes); known(records, { 1: 2, 2: 1, 3: 0, 4: 0, 5: 0, 6: 2, 7: 2, 9: 0 });
    var marker = one(records, 9, 0, true);
    var count = one(records, 3, 0), flags = one(records, 4, 0), raw = one(records, 7, 2), common = one(records, 6, 2);
    budget.count += count;
    if (count < 1 || budget.count > MAX_POINTS || raw.length % count) fail("笔画点数或长度无效");
    var stride = raw.length / count;
    // 不同通道会压缩进公共头；只接受样本中逐项核对的组合。
    var layouts = { 3: [12, 22], 67: [14, 20], 39: [18, 16], 103: [20, 14], 167: [20, 14], 231: [22, 12] };
    var layout = layouts[flags];
    if (!layout || stride !== layout[0] || common.length !== layout[1]) fail("笔画通道布局变化");
    if (marker > 0) {
      // MN4.5/62 的 94 笔样本已由用户对照原图确认；仅放行这些布局和样本覆盖的数值范围。
      // 字段完整语义仍未知，只保留标记，不据此删减、裁剪或重排控制点。
      var compatible = [39, 103, 167, 231].indexOf(flags) >= 0 && marker < count;
      if (!compatible) {
        if (!budget.previewOnly) fail("笔画路径含未验证标记；请点击预览核对，暂不支持改色");
        budget.unverifiedPathMarkers = true;
      }
      budget.pathMarkers.push({ strokeIndex: budget.strokeIndex, value: marker });
    }
    var view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    var commonWidth = stride < 16 ? new DataView(common.buffer, common.byteOffset, common.byteLength).getFloat32(0, true) : 0;
    var scale = Math.sqrt(Math.abs(transform[0] * transform[3] - transform[1] * transform[2])), result = [];
    for (var i = 0; i < count; i += 1) {
      var start = i * stride, x = view.getFloat32(start, true), y = view.getFloat32(start + 4, true);
      var width = (stride >= 16 ? view.getFloat32(start + 12, true) : commonWidth) * scale;
      var px = transform[0] * x + transform[2] * y + transform[4], py = transform[1] * x + transform[3] * y + transform[5];
      if (!isFinite(px) || !isFinite(py) || Math.abs(px) > 10000000 || Math.abs(py) > 10000000
        || !isFinite(width) || width <= 0 || width > 1000) fail("笔画坐标或宽度无效");
      result.push({ x: px, y: py, width: width });
    }
    return result;
  }
  function decode(bytes, previewOnly) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 3 || bytes.length > MAX_BYTES
      || bytes[0] !== 119 || bytes[1] !== 114 || bytes[2] !== 100) fail("缺少 wrd 标记");
    var records = fields(bytes.subarray(3)); known(records, { 1: 0, 2: 2, 3: 2, 4: 2, 5: 2, 7: 2, 8: 2, 30: 0 });
    if (one(records, 1, 0, true) > 0 || one(records, 30, 0, true) > 0) fail("绘图版本变化");
    var inks = records.filter(function (record) { return record.number === 4; });
    var strokes = records.filter(function (record) { return record.number === 5; });
    var budget = { count: 0, previewOnly: previewOnly === true, pathMarkers: [], unverifiedPathMarkers: false, strokeIndex: 0 };
    if (!inks.length || inks.length > 64 || !strokes.length || strokes.length > MAX_STROKES) fail("笔色或笔画数量超出范围");
    inks = inks.map(function (record) { return ink(record.value); });
    strokes = strokes.map(function (record, strokeIndex) {
      budget.strokeIndex = strokeIndex;
      var stroke = fields(record.value); known(stroke, { 1: 2, 2: 2, 3: 2, 4: 0, 5: 2, 6: 2, 7: 2, 8: 0, 13: 2, 14: 0 });
      var index = one(stroke, 4, 0), transform = floats(one(stroke, 7, 2), 6);
      if (!inks[index]) fail("笔画引用的笔色不存在");
      var first = transform[0] * transform[0] + transform[1] * transform[1], second = transform[2] * transform[2] + transform[3] * transform[3];
      if (first <= 0 || Math.abs(first - second) > first * 0.0001
        || Math.abs(transform[0] * transform[2] + transform[1] * transform[3]) > first * 0.0001) fail("未验证的笔画拉伸变换");
      var path = points(one(stroke, 5, 2), transform, budget);
      verifiedLine(stroke, path);
      // 额外的遮罩、擦除和其他新字段会在 known 中拒绝，不能默默算入旧笔迹。
      return { color: inks[index].color, alpha: inks[index].alpha, points: path };
    });
    return { strokes: strokes, pointCount: budget.count, pathMarkers: budget.pathMarkers, previewOnly: budget.unverifiedPathMarkers };
  }
  function verifiedLine(records, path) {
    var identifier = one(records, 13, 2, true), kind = one(records, 14, 0, true);
    if (identifier === null && kind === null) return;
    // MN4.5.0 样本的两条直线带有这组字段；只放行相同标记与等宽直线路径，不推断其他值的语义。
    if (!identifier || identifier.length !== 16 || kind !== 6) fail("笔画含未验证的直线标记");
    var first = path[0], last = path[path.length - 1], dx = last.x - first.x, dy = last.y - first.y;
    var length = Math.sqrt(dx * dx + dy * dy), tolerance = Math.max(0.0001, length * 0.000001);
    if (path.length < 2 || length === 0) fail("附加标记的直线路径变化");
    path.forEach(function (point) {
      var distance = Math.abs(dx * (point.y - first.y) - dy * (point.x - first.x)) / length;
      if (distance > tolerance || Math.abs(point.width - first.width) > first.width * 0.0001) fail("附加标记的直线路径变化");
    });
  }
  function render(drawing) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, paths = [], colors = [];
    function number(value) { return String(Math.round(value * 1000) / 1000); }
    drawing.strokes.forEach(function (stroke) {
      if (!stroke.alpha) return;
      if (colors.indexOf(stroke.color) < 0) colors.push(stroke.color);
      var total = 0, coordinates = [];
      stroke.points.forEach(function (point) {
        var radius = point.width / 2 + 1;
        minX = Math.min(minX, point.x - radius); minY = Math.min(minY, point.y - radius);
        maxX = Math.max(maxX, point.x + radius); maxY = Math.max(maxY, point.y + radius);
        total += point.width; coordinates.push(number(point.x) + "," + number(point.y));
      });
      // 控制点折线与平均笔宽用于笔色识别预览，不宣称与 PencilKit 纹理逐像素一致。
      var width = total / stroke.points.length;
      if (coordinates.length === 1) paths.push('<circle cx="' + number(stroke.points[0].x) + '" cy="' + number(stroke.points[0].y)
        + '" r="' + number(width / 2) + '" fill="' + stroke.color + '" opacity="' + number(stroke.alpha) + '"/>');
      else paths.push('<polyline points="' + coordinates.join(" ") + '" fill="none" stroke="' + stroke.color
        + '" stroke-width="' + number(width) + '" stroke-opacity="' + number(stroke.alpha) + '" stroke-linecap="round" stroke-linejoin="round"/>');
    });
    if (!paths.length) fail("绘图没有可见笔画");
    var width = maxX - minX, height = maxY - minY, scale = Math.min(1, 1024 / Math.max(width, height));
    if (!isFinite(width) || !isFinite(height) || width <= 0 || height <= 0) fail("绘图边界无效");
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.max(1, Math.round(width * scale)) + '" height="'
      + Math.max(1, Math.round(height * scale)) + '" viewBox="' + [minX, minY, width, height].map(number).join(" ") + '">' + paths.join("") + '</svg>';
    if (svg.length > 1500000) fail("预览内容过大");
    var metadata = { format: "PencilKit wrd", strokeCount: drawing.strokes.length, pointCount: drawing.pointCount, colors: colors, approximate: true };
    if (drawing.pathMarkers && drawing.pathMarkers.length) {
      metadata.pathMarkers = drawing.pathMarkers;
    }
    if (drawing.previewOnly === true) metadata.previewOnly = true;
    return { dataURL: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg), drawing: metadata };
  }
  function media(encoded, length) { return render(decode(decodeBase64(encoded, length))); }
  function preview(encoded, length) { return render(decode(decodeBase64(encoded, length), true)); }
  return { decodeBase64: decodeBase64, decode: decode, render: render, media: media, preview: preview };
})();
