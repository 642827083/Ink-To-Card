var __INK_TO_CARD_NATIVE__ = (function () {
  var PREFIX = "cn.marginnote.ink-to-card.";
  var config = __INK_TO_CARD_CONFIG__;
  var sampleSerial = 0;
  function value(object, key) {
    if (!object) return undefined;
    var result = object[key];
    if (result === undefined && typeof object.objectForKey === "function") result = object.objectForKey(key);
    return typeof result === "function" ? result.call(object) : result;
  }
  function list(array) {
    if (!array) return [];
    if (Array.isArray(array)) return array.slice();
    var count = Number(value(array, "count")) || 0, result = [];
    for (var i = 0; i < count; i += 1) result.push(array.objectAtIndex(i));
    return result;
  }
  function read(key) {
    var raw = NSUserDefaults.standardUserDefaults().objectForKey(PREFIX + key);
    if (!raw) return null;
    try { return JSON.parse(String(raw)); } catch (error) { return null; }
  }
  function write(key, data) {
    NSUserDefaults.standardUserDefaults().setObjectForKey(JSON.stringify(data), PREFIX + key);
  }
  function database() {
    if (typeof Database === "undefined" || typeof Database.sharedInstance !== "function") throw new Error("当前 MN 没有开放数据库接口");
    return Database.sharedInstance();
  }
  function current(addon) {
    var study = Application.sharedInstance().studyController(addon.window);
    var notebook = study && study.notebookController;
    if (addon.inkClassicTracking) return classicTarget(addon, notebook);
    if (addon.inkSceneMode && addon.inkTargetId && notebook) {
      var tracked = database().getNoteById(addon.inkTargetId);
      if (tracked && String(tracked.notebookId) === String(notebook.notebookId)) return tracked;
      addon.inkTargetId = null;
    }
    var note = notebook && (notebook.focusNote || notebook.visibleFocusNote);
    if (addon.inkSceneMode && note && String(note.notebookId) !== String(notebook.notebookId)) return null;
    if (!note || !String(note.noteId || "")) return null;
    return note;
  }
  function classicTarget(addon, notebook) {
    if (!notebook || addon.inkNotebookOpen === false || addon.inkInactive) return null;
    var topic = String(notebook.notebookId || "");
    function fresh(candidate) {
      for (var depth = 0; candidate && depth < 3 && !value(candidate, "noteId"); depth += 1) candidate = value(candidate, "note");
      var id = String(value(candidate, "noteId") || ""), note = id && database().getNoteById(id);
      return note && String(note.notebookId) === topic ? note : null;
    }
    if (addon.inkTargetTopic !== topic) { addon.inkTargetId = null; addon.inkTargetTopic = topic; }
    var selection = value(value(notebook, "mindmapView"), "selViewLst");
    var selected = list(selection), candidate = selected.length === 1 ? fresh(selected[0]) : null;
    // 优先实际单选；取消选中或进入编辑时继续读取已记住的卡片，不跳回旧焦点。
    if (!candidate && addon.inkTargetId) candidate = fresh({ noteId: addon.inkTargetId });
    if (!candidate || selection === undefined || selection === null) {
      var focus = fresh(notebook.focusNote || notebook.visibleFocusNote);
      candidate = focus || candidate;
    }
    var id = candidate ? String(candidate.noteId) : null;
    if (id !== addon.inkTargetId) { addon.inkTargetId = id; addon.inkSceneEpoch = (addon.inkSceneEpoch || 0) + 1; }
    return candidate;
  }
  function comments(note) {
    return list(note.comments).map(function (comment, index) {
      var paint = value(comment, "paint"), drawing = value(comment, "drawing");
      var kind = drawing !== undefined && drawing !== null && drawing !== "" ? "drawing" : "paint";
      var reference = kind === "paint" ? paint : drawing;
      // drawing 字段由真机返回；只把非空短字符串当作媒体引用，不猜测内嵌对象结构。
      var mediaHash = typeof reference === "string" && reference && reference.length <= 1024 ? reference : "";
      return { index: index, type: String(value(comment, "type") || ""), kind: kind, mediaHash: mediaHash,
        hash: mediaHash ? (kind === "drawing" ? "drawing:" + mediaHash : mediaHash) : "",
        text: String(value(comment, "text") || "") };
    });
  }
  function sources(note) {
    return comments(note).filter(function (comment) { return comment.type === "PaintNote" && comment.hash; });
  }
  function latestDrawing(note) {
    var drawings = comments(note).filter(function (item) { return item.type === "PaintNote" && item.kind === "drawing"; });
    return drawings.length ? drawings[drawings.length - 1] : null;
  }
  function settings(topic) { return config.normalize(read("settings." + topic)); }
  function toolbarState(addon) {
    var study = Application.sharedInstance().studyController(addon.window);
    var notebook = study && study.notebookController, topic = String(value(notebook, "notebookId") || "");
    return { study: study, topic: topic, enabled: addon.inkNotebookOpen !== false && !!topic && settings(topic).auto };
  }
  function followEnabled(addon) { return toolbarState(addon).enabled; }
  function syncToolbar(addon) {
    var state = toolbarState(addon), key = JSON.stringify([state.topic, state.enabled]);
    if (addon.inkToolbarState === key || !state.study || typeof state.study.refreshAddonCommands !== "function") return;
    // 仅切集或开关状态变化时刷新；普通笔迹轮询不反复刷新工具栏。
    addon.inkToolbarState = key;
    state.study.refreshAddonCommands();
  }
  function describeNote(note) {
    var id = String(note.noteId), topic = String(note.notebookId);
    var source = latestDrawing(note);
    return { available: true, noteId: id, topicId: topic, title: String(note.noteTitle || note.excerptText || "未命名卡片").slice(0, 80),
      colorIndex: Number(note.colorIndex), settings: settings(topic), sources: sources(note).map(function (item) {
        return { index: item.index, hash: item.hash, kind: item.kind };
      }), source: source ? { index: source.index, hash: source.hash, kind: source.kind } : null,
      bindingInvalid: false };
  }
  function snapshot(addon) {
    var note = current(addon), study = Application.sharedInstance().studyController(addon.window);
    var notebook = study && study.notebookController, topic = notebook && String(notebook.notebookId || "");
    var result = !note ? { available: false, topicId: topic, reason: addon.inkSceneMode ? "等待手写批注变化；也可先在脑图中选一张卡片" : "请在脑图中选中一张卡片，再点击刷新" }
      : describeNote(database().getNoteById(String(note.noteId)) || note);
    if (addon.inkSceneMode || addon.inkClassicTracking) {
      result.scene = !!addon.inkSceneMode; result.tracking = !!addon.inkClassicTracking;
      result.scopeToken = scopeToken(addon); result.settings = settings(topic);
    }
    syncToolbar(addon);
    return result;
  }
  function scopeToken(addon) {
    var study = Application.sharedInstance().studyController(addon.window), notebook = study && study.notebookController;
    return String(addon.inkSceneEpoch || 0) + ":" + String(notebook && notebook.notebookId || "");
  }
  function requireSceneScope(addon, payload) {
    if ((addon.inkSceneMode || addon.inkClassicTracking) && payload.scopeToken !== scopeToken(addon)) throw new Error("学习窗口或学习集已变化，已取消旧识别结果");
  }
  function requireNote(addon, id) {
    if (addon.inkNotebookOpen === false || addon.inkInactive === true) throw new Error("学习集已关闭或 MN 已进入后台，已取消识别");
    if (addon.inkSceneMode) {
      var study = Application.sharedInstance().studyController(addon.window), notebook = study && study.notebookController;
      var tracked = database().getNoteById(id);
      if (!notebook || !tracked || String(tracked.notebookId) !== String(notebook.notebookId)) throw new Error("卡片不属于当前学习集或已不存在");
      return tracked;
    }
    var note = current(addon);
    if (!note || String(note.noteId) !== id) throw new Error("当前卡片已变化，请重新选中卡片后识别");
    var fresh = database().getNoteById(id);
    if (!fresh) throw new Error("卡片已不存在");
    return fresh;
  }
  function readNote(addon, payload) {
    if (!addon.inkSceneMode) throw new Error("按卡片身份跟踪需要 MN5 场景接口");
    if (typeof payload.noteId !== "string" || !payload.noteId || payload.noteId.length > 128) throw new Error("卡片身份无效");
    var note = requireNote(addon, payload.noteId), result = describeNote(note);
    result.scene = true; result.scopeToken = scopeToken(addon);
    return result;
  }
  function trackNote(addon, payload) {
    var result = readNote(addon, payload);
    addon.inkTargetId = result.noteId;
    return result;
  }
  function inspectSources(addon, payload) {
    var focus = current(addon), fresh = requireNote(addon, payload.noteId);
    function probe(note, method) {
      try {
        if (typeof note[method] !== "function") return { supported: false };
        var result = Number(note[method]());
        return isFinite(result) && result >= 0 ? { supported: true, value: result } : { supported: true, error: "返回值无效" };
      } catch (error) { return { supported: true, error: String(error.message || error).slice(0, 160) }; }
    }
    function describe(note) {
      var raw = list(note.comments), types = Object.create(null), paintCount = 0, drawingCount = 0;
      var entries = raw.slice(0, 100).map(function (comment, index) {
        var type = String(value(comment, "type") || "(无 type)"), hasPaint = !!value(comment, "paint"), fields = [];
        var drawing = value(comment, "drawing"), drawingInfo = { type: typeof drawing, present: drawing !== undefined && drawing !== null };
        if (typeof drawing === "string") drawingInfo.stringLength = drawing.length;
        // 只返回结构与计数，不返回正文、媒体内容或媒体哈希。
        try {
          fields = typeof comment.objectForKey === "function" ? list(value(comment, "allKeys")) : Object.keys(comment);
        } catch (error) { fields = []; }
        return { index: index, type: type, hasPaint: hasPaint, drawing: drawingInfo, fields: fields.slice(0, 20).map(String) };
      });
      raw.forEach(function (comment) {
        var type = String(value(comment, "type") || "(无 type)");
        types[type] = (types[type] || 0) + 1;
        if (type === "PaintNote" && value(comment, "paint")) paintCount += 1;
        if (type === "PaintNote" && value(comment, "drawing")) drawingCount += 1;
      });
      return { commentCount: raw.length, paintTypeCount: types.PaintNote || 0, paintCommentCount: paintCount, drawingCommentCount: drawingCount,
        types: types, entries: entries,
        strokes: probe(note, "getStrokesCount"), drawingBytes: probe(note, "getDrawingSize") };
    }
    var focusInfo = describe(focus), databaseInfo = describe(fresh), summary;
    if (databaseInfo.drawingCommentCount > 0) summary = sources(fresh).some(function (source) { return source.kind === "drawing"; })
      ? "检测到 drawing 绘图批注。已自动选择最后一条绘图，可点击预览检查普通笔绘图格式。"
      : "检测到 drawing 字段，但它不是当前支持的字符串媒体引用。请查看详情里的 drawing 类型。";
    else if (databaseInfo.paintCommentCount > 0) summary = "数据库返回了图片批注，请查看当前卡片对象与数据库对象的数量是否一致。";
    else if (databaseInfo.paintTypeCount > 0) summary = "已返回 PaintNote，但插件未取得 paint 或 drawing 媒体引用。";
    else if (databaseInfo.strokes.value > 0 || focusInfo.strokes.value > 0) summary = "检测到绘图笔画，但这些笔画没有可读图片来源。当前版本还没有取得这些笔迹的图片。";
    else summary = "接口未返回可读图片批注。笔画数为 0 或接口不可用，都不能仅据此断定屏幕上没有手写。";
    var app = Application.sharedInstance(), report = { noteId: payload.noteId, summary: summary,
      appVersion: String(value(app, "appVersion") || "未知"), build: String(value(app, "build") || "未知"), focus: focusInfo, database: databaseInfo };
    if (payload.inspectMedia) {
      report.drawingMedia = sources(fresh).filter(function (source) { return source.kind === "drawing"; }).slice(-3).map(function (source) {
        try {
          var data = database().getMediaByHash(source.mediaHash);
          if (!data) return { index: source.index, error: "媒体未下载或未找到" };
          var bytes = Number(value(data, "length"));
          if (bytes > 12 * 1024 * 1024) return { index: source.index, bytes: bytes, error: "超过 12 MB，跳过解码" };
          var encoded = value(data, "base64Encoding"), prefix = String(encoded || "").slice(0, 12);
          var format = prefix.indexOf("iVBORw0KGgo") === 0 ? "PNG" : prefix.indexOf("/9j/") === 0 ? "JPEG"
            : prefix.indexOf("YnBsaXN0MD") === 0 ? "二进制 Property List" : prefix.indexOf("d3Jk") === 0 ? "PencilKit wrd 绘图" : "未知二进制格式";
          if (__INK_TO_CARD_DRAWING__.supports(encoded)) {
            var preview = __INK_TO_CARD_DRAWING__.media(encoded, bytes);
            return { index: source.index, bytes: bytes, format: format, drawingDecoded: true, strokeCount: preview.drawing.strokeCount };
          }
          var image = typeof UIImage !== "undefined" && typeof UIImage.imageWithData === "function" ? UIImage.imageWithData(data) : null;
          return { index: source.index, bytes: bytes, format: format, imageDecoded: !!image };
        } catch (error) { return { index: source.index, bytes: bytes, format: format, error: String(error.message || error).slice(0, 160) }; }
      });
    }
    return report;
  }
  function saveSettings(addon, payload) {
    requireSceneScope(addon, payload);
    var topic;
    if (addon.inkSceneMode || addon.inkClassicTracking) {
      if (addon.inkNotebookOpen === false || addon.inkInactive) throw new Error("学习集已关闭或 MN 已进入后台");
      var study = Application.sharedInstance().studyController(addon.window), notebook = study && study.notebookController;
      topic = String(notebook && notebook.notebookId || "");
      if (!topic || topic !== payload.topicId) throw new Error("学习集已变化，请重新读取设置");
    } else { topic = String(requireNote(addon, payload.noteId).notebookId); }
    var normalized = config.normalize(payload.settings);
    write("settings." + topic, normalized);
    syncToolbar(addon);
    return normalized;
  }
  function toggleFollow(addon, scope) {
    if (addon.inkNotebookOpen === false || addon.inkInactive) throw new Error("请先打开一个学习集");
    requireSceneScope(addon, { scopeToken: scope });
    var state = toolbarState(addon);
    if (!state.topic) throw new Error("请先打开一个学习集");
    var options = settings(state.topic); options.auto = !options.auto;
    return saveSettings(addon, { topicId: state.topic, scopeToken: scope, settings: options });
  }
  function media(addon, payload) {
    var note = requireNote(addon, payload.noteId);
    return mediaForNote(note, payload);
  }
  function mediaForNote(note, payload, previewOnly) {
    var candidate = sources(note).find(function (source) { return source.index === payload.index && source.hash === payload.hash; });
    if (!candidate) throw new Error("手写批注已变化，请重新读取");
    var db = database();
    if (typeof db.getMediaByHash !== "function") throw new Error("当前 MN 不支持读取批注媒体");
    var data = db.getMediaByHash(candidate.mediaHash);
    if (!data) throw new Error("批注媒体尚未下载，请先在 MN 中打开这条批注");
    if (Number(value(data, "length")) > 12 * 1024 * 1024) throw new Error("批注图片超过 12 MB，请缩小图片后重试");
    if (candidate.kind === "drawing") {
      var raw = value(data, "base64Encoding");
      if (__INK_TO_CARD_DRAWING__.supports(raw)) {
        var reader = previewOnly === true ? __INK_TO_CARD_DRAWING__.preview : __INK_TO_CARD_DRAWING__.media;
        var rendered = reader(raw, Number(value(data, "length")));
        return Object.assign(rendered, { hash: candidate.hash, index: candidate.index });
      }
    }
    if (typeof UIImage === "undefined" || typeof UIImage.imageWithData !== "function") throw new Error("当前 MN 不支持解码批注图片");
    var image = UIImage.imageWithData(data);
    if (!image) throw new Error(candidate.kind === "drawing"
      ? "已读取 drawing 媒体（" + Number(value(data, "length")) + " 字节），但无法解码为图片，也不是已支持的绘图或归档格式。请检查来源或导出绘图样本。"
      : "该批注不是可读取的图片；原始笔画数据暂不支持");
    var size = value(image, "size");
    if (!size || size.width * size.height > 24000000) throw new Error("批注图片尺寸过大或无效");
    var png = typeof image.pngData === "function" ? image.pngData() : null;
    if (!png) throw new Error("当前 MN 不支持导出批注图片");
    var encoded = value(png, "base64Encoding");
    if (!encoded || String(encoded).length > 24 * 1024 * 1024) throw new Error("图片编码失败或过大");
    return { dataURL: "data:image/png;base64," + encoded, hash: candidate.hash, index: candidate.index };
  }
  function drawingMedia(note, payload, previewOnly) {
    var source = latestDrawing(note);
    if (!source || source.index !== payload.index || source.hash !== payload.hash) throw new Error("最后一条手写绘图已变化，请重新识别");
    if (!source.hash) throw new Error("最后一条绘图的媒体引用格式不支持，已跳过");
    var media = mediaForNote(note, payload, previewOnly);
    // 自动来源必须经笔画解析确认，不接受 drawing 字段里的普通位图。
    if (!media.drawing) throw new Error("最后一条绘图不是已支持的手写笔画格式，已跳过");
    return media;
  }
  function readDrawing(addon, payload) { return drawingMedia(requireNote(addon, payload.noteId), payload); }
  function previewDrawing(addon, payload) { return drawingMedia(requireNote(addon, payload.noteId), payload, true); }
  function exportDrawingSample(addon, payload) {
    var note = requireNote(addon, payload.noteId);
    var candidate = sources(note).find(function (source) { return source.index === payload.index && source.hash === payload.hash && source.kind === "drawing"; });
    if (!candidate) throw new Error("请在来源列表选择一条绘图批注；来源变化后需重新选择");
    var app = Application.sharedInstance(), directory = String(value(app, "tempPath") || "").replace(/\/$/, "");
    if (!directory || typeof app.saveFileWithUti !== "function") throw new Error("当前 MN 未开放文件导出接口");
    if (typeof NSData === "undefined" || typeof NSData.dataWithStringEncoding !== "function"
      || typeof NSFileManager === "undefined" || typeof NSFileManager.defaultManager !== "function") throw new Error("当前 MN 未开放样本文件写入接口");
    var db = database();
    if (typeof db.getMediaByHash !== "function") throw new Error("当前 MN 未开放媒体读取接口");
    var data = db.getMediaByHash(candidate.mediaHash);
    if (!data) throw new Error("绘图媒体尚未下载或不存在");
    var bytes = Number(value(data, "length"));
    if (!isFinite(bytes) || bytes % 1 !== 0 || bytes <= 0 || bytes > 1024 * 1024) throw new Error("样本必须为 1 字节至 1 MB 的绘图数据");
    var encoded = value(data, "base64Encoding");
    if (typeof encoded !== "string" || encoded.length !== Math.ceil(bytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("原始绘图编码不完整，未导出");
    // 再次检查焦点与媒体身份，避免把另一张卡的媒体当作当前样本。
    var fresh = requireNote(addon, payload.noteId);
    if (!sources(fresh).some(function (source) { return source.index === candidate.index && source.hash === candidate.hash; })) throw new Error("导出期间绘图来源已变化");
    var size = value(list(fresh.comments)[candidate.index], "size"), sizeInfo = null;
    if (typeof size === "string") sizeInfo = size.slice(0, 200);
    else if (size) {
      var width = Number(value(size, "width")), height = Number(value(size, "height"));
      if (isFinite(width) && isFinite(height)) sizeInfo = { width: width, height: height };
    }
    var sample = { format: "InkToCardDrawingSample", schemaVersion: 1,
      appVersion: String(value(app, "appVersion") || "未知"), build: String(value(app, "build") || "未知"),
      commentIndex: candidate.index, size: sizeInfo, byteLength: bytes, base64: encoded,
      runtime: { scenePanel: typeof AddonWebPanel !== "undefined", pencilKitDrawing: typeof PKDrawing !== "undefined" } };
    var output = NSData.dataWithStringEncoding(JSON.stringify(sample, null, 2), 4), manager = NSFileManager.defaultManager();
    directory += "/cn.marginnote.ink-to-card";
    if (!manager || typeof manager.createDirectoryAtPathWithIntermediateDirectoriesAttributes !== "function"
      || !manager.createDirectoryAtPathWithIntermediateDirectoriesAttributes(directory, true, null)) throw new Error("无法创建插件临时导出目录");
    var filename = "Ink-To-Card-drawing-" + Date.now() + "-" + (++sampleSerial) + ".json";
    var file = directory + "/" + filename;
    if (!output || typeof output.writeToFileAtomically !== "function" || !output.writeToFileAtomically(file, true)) throw new Error("绘图样本写入失败，未打开保存窗口");
    app.saveFileWithUti(file, "public.json");
    return { filename: filename, bytes: bytes, saveRequested: true };
  }
  function apply(addon, payload) {
    requireSceneScope(addon, payload);
    return applyForNote(requireNote(addon, payload.noteId), payload);
  }
  function applyForNote(note, payload) {
    var topic = String(note.notebookId);
    var options = settings(topic);
    if (JSON.stringify(options) !== payload.settingsToken) throw new Error("识别期间设置已变化，请重试");
    if (payload.automatic && !options.auto) return { status: "cancelled", reason: "自动识别已关闭" };
    var source = latestDrawing(note);
    if (!source || !source.hash || source.hash !== payload.hash || source.index !== payload.index) throw new Error("最后一条手写批注已变化，请重新识别");
    if (Number(note.colorIndex) !== payload.expectedColorIndex) throw new Error("识别期间卡片颜色已变化，已保留你的修改");
    var histogram = payload.histogram;
    if (!histogram || typeof histogram.pixels !== "number" || !isFinite(histogram.pixels) || histogram.pixels % 1 !== 0 || histogram.pixels <= 0 || histogram.pixels > 1048576
      || typeof histogram.colored !== "number" || !isFinite(histogram.colored) || histogram.colored < 0) throw new Error("识别结果无效");
    var total = 0;
    config.colors.forEach(function (color) {
      var count = histogram.counts && histogram.counts[color.id];
      if (typeof count !== "number" || !isFinite(count) || count < 0 || count > histogram.pixels) throw new Error("识别结果无效");
      total += count;
    });
    if (Math.abs(total - histogram.colored) > 0.01 || total > histogram.pixels + 0.01) throw new Error("识别结果无效");
    if (histogram.visible !== undefined && (typeof histogram.visible !== "number" || !isFinite(histogram.visible)
      || histogram.visible < 0 || histogram.visible < histogram.colored - 0.01 || histogram.visible > histogram.pixels + 0.01)) throw new Error("识别结果无效");
    var result = InkToCardCore.choose(histogram, options);
    if (result.status !== "matched") return result;
    // 写入必须再次通过严格解析；只读预览不能成为任何笔色的写入凭据。
    var drawing = drawingMedia(note, source).drawing;
    if (result.color === "uncolored") {
      // 原生重新解码同一绘图确认确有笔画，读取失败或仅有图片不能当成已书写。
      if (!drawing || !drawing.strokeCount || !drawing.colors.length) throw new Error("未确认有效手写绘图，保持原色");
      if (InkToCardCore.drawingHasColor(drawing, options)) return { status: "insufficient", reason: "绘图仍含彩色笔迹，未使用无彩色书写的卡色", counts: histogram.counts };
    }
    if (Number(note.colorIndex) === result.colorIndex) return Object.assign(result, { status: "unchanged", reason: "卡片已是目标颜色" });
    if (typeof UndoManager === "undefined" || typeof UndoManager.sharedInstance !== "function") throw new Error("当前 MN 没有开放撤销接口，已保留卡片原色");
    var manager = UndoManager.sharedInstance();
    if (!manager || typeof manager.undoGrouping !== "function") throw new Error("当前 MN 不支持可撤销改色");
    manager.undoGrouping("Ink To Card：按笔迹改色", topic, function () { note.colorIndex = result.colorIndex; });
    Application.sharedInstance().refreshAfterDBChanged(topic);
    var fresh = database().getNoteById(payload.noteId);
    if (!fresh || Number(fresh.colorIndex) !== result.colorIndex) throw new Error("改色后读取不一致，请检查卡片状态");
    return Object.assign(result, { status: "applied", reason: "已设置卡片色号 " + (result.colorIndex + 1) });
  }
  return { value: value, list: list, current: current, snapshot: snapshot, saveSettings: saveSettings,
    media: media, apply: apply, inspectSources: inspectSources,
    exportDrawingSample: exportDrawingSample, readDrawing: readDrawing, previewDrawing: previewDrawing, database: database,
    settings: settings, describeNote: describeNote, latestDrawing: latestDrawing,
    drawingMedia: drawingMedia, applyForNote: applyForNote,
    readNote: readNote, trackNote: trackNote, scopeToken: scopeToken,
    followEnabled: followEnabled, syncToolbar: syncToolbar, toggleFollow: toggleFollow };
})();
