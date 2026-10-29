var __INK_TO_CARD_DRAWING__ = (function () {
  // 统一解开绘图归档，再按通道定义解析 wrd；不依赖未导出的 PencilKit 原生类。
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
  function ink(bytes, compatibility) {
    var records = fields(bytes); known(records, { 1: 2, 2: 2, 3: 0, 8: 1 });
    var color = floats(one(records, 1, 2), 4), nameBytes = one(records, 2, 2), identifier = "";
    for (var i = 0; i < nameBytes.length; i += 1) identifier += String.fromCharCode(nameBytes[i]);
    // 归档钢笔只用于与同档普通笔兼容版本逐笔核对，不作为独立的钢笔渲染器。
    if (identifier !== "com.apple.ink.pen" && !(compatibility && identifier === "com.apple.ink.fountainpen"))
      fail("当前仅支持普通笔，笔刷为 " + identifier.slice(0, 80));
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
    var layout = channelLayout(flags, raw.length / count, common.length);
    if (marker > 0) {
      // 路径标记与通道组合无关；保留范围内的标记，不删减、裁剪或重排控制点。
      var compatible = marker < count;
      if (!compatible) {
        if (!budget.previewOnly) fail("笔画路径含未验证标记；请点击预览核对，暂不支持改色");
        budget.unverifiedPathMarkers = true;
      }
      budget.pathMarkers.push({ strokeIndex: budget.strokeIndex, value: marker });
    }
    var view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    var widthInCommon = layout.commonWidth !== null;
    var commonWidth = widthInCommon ? new DataView(common.buffer, common.byteOffset, common.byteLength).getFloat32(layout.commonWidth, true) : 0;
    var scale = Math.sqrt(Math.abs(transform[0] * transform[3] - transform[1] * transform[2])), result = [];
    for (var i = 0; i < count; i += 1) {
      var start = i * layout.stride, x = view.getFloat32(start, true), y = view.getFloat32(start + 4, true);
      var width = (widthInCommon ? commonWidth : view.getFloat32(start + layout.pointWidth, true)) * scale;
      var px = transform[0] * x + transform[2] * y + transform[4], py = transform[1] * x + transform[3] * y + transform[5];
      if (!isFinite(px) || !isFinite(py) || Math.abs(px) > 10000000 || Math.abs(py) > 10000000
        || !isFinite(width) || width <= 0 || width > 1000) fail("笔画坐标或宽度无效");
      result.push({ x: px, y: py, width: width });
    }
    return result;
  }
  function channelLayout(flags, stride, commonLength) {
    // 已核对的通道按位组合：XY 为 8 字节，随后两项各 4 字节，最后三项各 2 字节。
    // 标志决定数据在逐点区还是公共头，不能用逐点区的总长度猜笔宽偏移。
    if (flags > 255 || !(flags & 1) || (flags & ~231)) fail("笔画通道布局变化：含未知通道或缺少坐标");
    var channels = [[1, 8], [2, 4], [4, 4], [32, 2], [64, 2], [128, 2]];
    var pointOffset = 0, commonOffset = 0, layout = { pointWidth: null, commonWidth: null };
    channels.forEach(function (channel) {
      var perPoint = !!(flags & channel[0]);
      if (channel[0] === 4) layout[perPoint ? "pointWidth" : "commonWidth"] = perPoint ? pointOffset : commonOffset;
      if (perPoint) pointOffset += channel[1]; else commonOffset += channel[1];
    });
    // 新旧公共头的固定尾部分别为 12、10 字节；旧头仅对已确认的逐点笔宽规则启用。
    var expected = commonOffset + 12, legacy = layout.pointWidth !== null && commonLength === commonOffset + 10;
    // MN5.0/build5 实样的布局39公共头为20字节；坐标和笔宽均来自逐点区，不读取该扩展头中的附加字节。
    // 仅接受已核对的这一组合，不能推定其他通道的公共笔宽偏移或头长度也相同。
    var extended = flags === 39 && commonLength === 20;
    if (stride !== pointOffset || (commonLength !== expected && !legacy && !extended)) fail("笔画通道布局变化：通道与数据长度不一致");
    layout.stride = pointOffset;
    return layout;
  }
  function wrd(bytes, previewOnly, compatibility) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 3 || bytes.length > MAX_BYTES
      || bytes[0] !== 119 || bytes[1] !== 114 || bytes[2] !== 100) fail("缺少 wrd 标记");
    var records = fields(bytes.subarray(3)), rootTypes = { 1: 0, 2: 2, 3: 2, 4: 2, 5: 2, 7: 2, 8: 2, 30: 0 };
    if (compatibility) rootTypes[46] = 0;
    known(records, rootTypes);
    if (one(records, 1, 0, true) > 0 || one(records, 30, 0, true) > 0
      || (compatibility && one(records, 46, 0, true) > 0)) fail("绘图版本变化");
    var inks = records.filter(function (record) { return record.number === 4; });
    var strokes = records.filter(function (record) { return record.number === 5; });
    var budget = { count: 0, previewOnly: previewOnly === true, pathMarkers: [], unverifiedPathMarkers: false, strokeIndex: 0 };
    if (!inks.length || inks.length > 64 || !strokes.length || strokes.length > MAX_STROKES) fail("笔色或笔画数量超出范围");
    inks = inks.map(function (record) { return ink(record.value, compatibility); });
    strokes = strokes.map(function (record, strokeIndex) {
      budget.strokeIndex = strokeIndex;
      var stroke = fields(record.value), strokeTypes = { 1: 2, 2: 2, 3: 2, 4: 0, 5: 2, 6: 2, 7: 2, 8: 0, 13: 2, 14: 0 };
      if (compatibility) strokeTypes[15] = 2;
      known(stroke, strokeTypes);
      if (compatibility) {
        var extraTransform = one(stroke, 15, 2, true);
        if (extraTransform) {
          // 此附加记录尚无公开语义；仅在兼容表示中接受真实归档出现的值，不能把任意新记录当作无关元数据。
          var values = floats(extraTransform, 6);
          if (values.join(",") !== "1,0,0,0.25,0,0") fail("归档兼容版本含未验证的附加记录");
        }
      }
      var index = one(stroke, 4, 0), transform = floats(one(stroke, 7, 2), 6);
      if (!inks[index]) fail("笔画引用的笔色不存在");
      var first = transform[0] * transform[0] + transform[1] * transform[1], second = transform[2] * transform[2] + transform[3] * transform[3];
      if (first <= 0 || Math.abs(first - second) > first * 0.0001
        || Math.abs(transform[0] * transform[2] + transform[1] * transform[3]) > first * 0.0001) fail("未验证的笔画拉伸变换");
      var path = points(one(stroke, 5, 2), transform, budget);
      verifiedMarkedPath(stroke);
      // 额外的遮罩、擦除和其他新字段会在 known 中拒绝，不能默默算入旧笔迹。
      return { color: inks[index].color, alpha: inks[index].alpha, points: path };
    });
    return { strokes: strokes, pointCount: budget.count, pathMarkers: budget.pathMarkers, previewOnly: budget.unverifiedPathMarkers };
  }
  function verifiedMarkedPath(records) {
    var identifier = one(records, 13, 2, true), kind = one(records, 14, 0, true);
    if (identifier === null && kind === null) return;
    // 图形标记不规定几何形状：曲线、闭合路径、变宽或不同点数均保留原数据。
    if (!identifier || identifier.length !== 16 || kind !== 6) fail("笔画含未验证的图形标记");
  }
  function hasHeader(bytes, header) {
    if (bytes.length < header.length) return false;
    for (var i = 0; i < header.length; i += 1) if (bytes[i] !== header.charCodeAt(i)) return false;
    return true;
  }
  function propertyList(bytes) {
    // 只读二进制 plist 的标量和容器，不调用原生反归档或实例化归档中的类。
    function invalid(reason) { fail("归档无效：" + reason); }
    if (bytes.length < 40) invalid("数据被截断");
    function uint(offset, size, end) {
      if (size < 1 || size > 8 || offset < 0 || offset + size > end) invalid("整数或引用越界");
      var value = 0;
      for (var i = 0; i < size; i += 1) value = value * 256 + bytes[offset + i];
      if (!Number.isSafeInteger(value)) invalid("整数过大");
      return value;
    }
    var trailer = bytes.length - 32, offsetSize = bytes[trailer + 6], refSize = bytes[trailer + 7];
    var count = uint(trailer + 8, 8, bytes.length), top = uint(trailer + 16, 8, bytes.length), table = uint(trailer + 24, 8, bytes.length);
    if (count < 1 || count > 32768 || top >= count || table < 8 || table >= trailer
      || offsetSize < 1 || offsetSize > 8 || refSize < 1 || refSize > 8 || table + count * offsetSize !== trailer) invalid("偏移表或对象数量无效");
    var offsets = [], ends = {}, cache = [], active = [], expanded = 0;
    for (var i = 0; i < count; i += 1) {
      var offset = uint(table + i * offsetSize, offsetSize, trailer);
      if (offset < 8 || offset >= table) invalid("对象偏移越界");
      offsets.push(offset);
    }
    offsets.slice().sort(function (a, b) { return a - b; }).forEach(function (offset, index, sorted) {
      if (index && offset === sorted[index - 1]) invalid("对象偏移重复");
      ends[offset] = sorted[index + 1] || table;
    });
    function object(index, depth) {
      if (index >= count || depth > 64 || active[index]) invalid("引用越界或循环");
      if (cache[index] !== undefined) return cache[index];
      active[index] = true;
      var cursor = offsets[index], end = ends[cursor], marker = bytes[cursor++], type = marker >> 4, size = marker & 15, value;
      function length() {
        if (size < 15) return size;
        if (cursor >= end || (bytes[cursor] >> 4) !== 1) invalid("对象长度编码无效");
        var width = Math.pow(2, bytes[cursor++] & 15), result = uint(cursor, width, end);
        cursor += width; return result;
      }
      if (type === 1) value = uint(cursor, Math.pow(2, size), end);
      else if (type === 8) value = { uid: uint(cursor, size + 1, end) };
      else if (type === 4 || type === 5 || type === 6) {
        var len = length(), width = type === 6 ? 2 : 1;
        if (len > MAX_BYTES || cursor + len * width > end) invalid("数据或字符串被截断");
        if (type === 4) value = bytes.subarray(cursor, cursor + len);
        else {
          if (len > 4096) invalid("字符串过长");
          value = "";
          for (var j = 0; j < len; j += 1) value += String.fromCharCode(uint(cursor + j * width, width, end));
        }
      } else if (type === 10 || type === 13) {
        var len = length(), references = len * (type === 13 ? 2 : 1);
        expanded += references;
        if (references > 65536 || expanded > 131072 || cursor + references * refSize > end) invalid("容器过大或被截断");
        value = type === 10 ? [] : Object.create(null);
        for (var j = 0; j < len; j += 1) {
          var item = object(uint(cursor + j * refSize, refSize, end), depth + 1);
          if (type === 10) value.push(item);
          else {
            if (typeof item !== "string" || Object.prototype.hasOwnProperty.call(value, item)) invalid("字典键无效或重复");
            value[item] = object(uint(cursor + (len + j) * refSize, refSize, end), depth + 1);
          }
        }
      } else invalid("对象类型不支持");
      active[index] = false; cache[index] = value; return value;
    }
    return object(top, 0);
  }
  function archiveVariants(bytes) {
    var root = propertyList(bytes);
    function keys(value, allowed) {
      if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Uint8Array
        || Object.keys(value).some(function (key) { return allowed.indexOf(key) < 0; })) fail("归档字典结构不支持");
    }
    if (root && root.$archiver !== undefined) {
      keys(root, ["$archiver", "$version", "$objects", "$top"]);
      if (root.$archiver !== "NSKeyedArchiver" || root.$version !== 100000 || !Array.isArray(root.$objects)
        || root.$objects[0] !== "$null") fail("归档类型或版本不支持");
      keys(root.$top, ["root"]);
      var objects = root.$objects;
      function resolve(reference) {
        if (!reference || Object.keys(reference).length !== 1 || !Number.isInteger(reference.uid)
          || reference.uid < 1 || reference.uid >= objects.length) fail("归档引用无效");
        return objects[reference.uid];
      }
      var dictionary = resolve(root.$top.root); keys(dictionary, ["NS.keys", "NS.objects", "$class"]);
      var definition = resolve(dictionary.$class); keys(definition, ["$classname", "$classes"]);
      if (definition.$classname !== "NSDictionary" || !Array.isArray(definition.$classes)
        || definition.$classes.some(function (name) { return typeof name !== "string"; })
        || definition.$classes.join(",") !== "NSDictionary,NSObject") fail("归档根对象不是已支持的绘图字典");
      var names = dictionary["NS.keys"], values = dictionary["NS.objects"];
      if (!Array.isArray(names) || !Array.isArray(values) || names.length !== values.length || names.length < 1 || names.length > 2) fail("归档绘图版本列表无效");
      root = Object.create(null);
      names.forEach(function (name, index) {
        var key = resolve(name);
        if (typeof key !== "string" || Object.prototype.hasOwnProperty.call(root, key)) fail("归档绘图键重复或无效");
        root[key] = resolve(values[index]);
      });
    }
    keys(root, ["drawing1", "drawing2"]);
    if (!Object.keys(root).length) fail("归档没有绘图数据");
    Object.keys(root).forEach(function (key) {
      if (!(root[key] instanceof Uint8Array) || !hasHeader(root[key], "wrd")) fail("归档 " + key + " 不是 wrd 绘图");
    });
    return root;
  }
  function decode(bytes, previewOnly) {
    if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES) fail("原始数据类型或长度无效");
    if (!hasHeader(bytes, "bplist")) return wrd(bytes, previewOnly, false);
    if (!hasHeader(bytes, "bplist00")) fail("归档版本不支持");
    var variants = archiveVariants(bytes), selected = variants.drawing1 ? "drawing1" : "drawing2";
    var drawing = wrd(variants[selected], previewOnly, false);
    drawing.archive = { selected: selected };
    if (variants.drawing1 && variants.drawing2) {
      var alternative;
      try { alternative = wrd(variants.drawing2, previewOnly, true); }
      catch (error) { fail("归档的另一个绘图版本无法核对：" + error.message); }
      // 同档的两个名字是兼容表示，不能相加或挑一个能读的就跳过另一个。
      // 忽略身份和边界等元数据差别；颜色、透明度、全部路径与变换后的笔宽必须一致。
      if (JSON.stringify(drawing.strokes) !== JSON.stringify(alternative.strokes)
        || JSON.stringify(drawing.pathMarkers) !== JSON.stringify(alternative.pathMarkers)
        || drawing.previewOnly !== alternative.previewOnly) fail("归档的两个绘图版本内容不一致");
      drawing.archive.verifiedAlternative = "drawing2";
    }
    return drawing;
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
    if (drawing.archive) metadata.archive = drawing.archive;
    if (drawing.pathMarkers && drawing.pathMarkers.length) {
      metadata.pathMarkers = drawing.pathMarkers;
    }
    if (drawing.previewOnly === true) metadata.previewOnly = true;
    return { dataURL: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg), drawing: metadata };
  }
  function media(encoded, length) { return render(decode(decodeBase64(encoded, length))); }
  function preview(encoded, length) { return render(decode(decodeBase64(encoded, length), true)); }
  function supports(encoded) {
    return typeof encoded === "string" && (encoded.indexOf("d3Jk") === 0 || encoded.indexOf("YnBsaXN0MD") === 0);
  }
  return { supports: supports, decodeBase64: decodeBase64, decode: decode, render: render, media: media, preview: preview };
})();
