var __INK_TO_CARD_BATCH__ = (function () {
  var native = __INK_TO_CARD_NATIVE__, serial = 0;
  function notebook(addon) {
    if (addon.inkNotebookOpen === false || addon.inkInactive) throw new Error("学习集已关闭或 MN 已进入后台，批量处理已停止");
    var study = Application.sharedInstance().studyController(addon.window);
    var controller = study && study.notebookController;
    if (!controller || !controller.notebookId) throw new Error("请先打开一个学习集");
    return controller;
  }
  function unwrap(item) {
    // 选中项可能是节点或带 note 字段的原生字典，仅沿官方 note 属性解包。
    for (var i = 0; item && !native.value(item, "noteId") && i < 3; i += 1) item = native.value(item, "note");
    return item;
  }
  function begin(addon, payload) {
    var controller = notebook(addon), topic = String(controller.notebookId), db = native.database(), roots;
    if (payload.scope === "selected") {
      var view = controller.mindmapView;
      if (!view || native.value(view, "selViewLst") === undefined) throw new Error("当前 MN 未开放脑图选中列表");
      roots = native.list(native.value(view, "selViewLst")).map(unwrap);
      if (roots.some(function (item) { return !item || !item.noteId; })) throw new Error("无法读取选中的卡片对象");
    } else if (payload.scope === "notebook") {
      if (typeof db.getNotebookById !== "function") throw new Error("当前 MN 未开放学习集读取接口");
      var book = db.getNotebookById(topic);
      if (!book || native.value(book, "notes") === undefined) throw new Error("无法读取学习集卡片列表");
      roots = native.list(native.value(book, "notes"));
    } else throw new Error("批量范围无效");
    var queue = roots.slice(), seen = Object.create(null), ids = [];
    while (queue.length) {
      var item = queue.pop(), id = item && String(item.noteId || "");
      if (!id || seen[id]) continue;
      seen[id] = true;
      if (String(item.notebookId) !== topic) continue;
      ids.push(id);
      if (ids.length > 5000) throw new Error("一次最多处理 5000 张卡，请缩小选择范围");
      if (payload.scope === "notebook") {
        queue = queue.concat(native.list(native.value(item, "childNotes")));
        var childMap = native.value(item, "childMindMap");
        if (childMap) queue.push(childMap);
      }
    }
    if (!ids.length) throw new Error(payload.scope === "selected" ? "请先在脑图中选中要处理的卡片" : "学习集中没有可处理的卡片");
    var options = native.settings(topic);
    if (options.mapping.uncolored < 0 && (options.policy === "red" ? options.mapping.red < 0 : !Object.keys(options.mapping).some(function (key) { return options.mapping[key] >= 0; }))) {
      throw new Error(options.policy === "red" ? "请先设置红色对应的卡片色号" : "请先设置笔迹颜色映射");
    }
    var job = { id: "batch-" + Date.now() + "-" + (++serial), topic: topic, ids: ids,
      settings: options, token: JSON.stringify(options), position: 0, prepared: null };
    addon.inkBatch = job;
    return { batchId: job.id, total: ids.length, settings: options };
  }
  function requireJob(addon, payload) {
    var job = addon.inkBatch;
    if (!job || job.id !== payload.batchId) throw new Error("批量任务已结束或取消");
    try {
      if (String(notebook(addon).notebookId) !== job.topic) throw new Error("学习集已切换，批量处理已停止");
      if (JSON.stringify(native.settings(job.topic)) !== job.token) throw new Error("识别设置已变化，批量处理已停止");
    } catch (error) { addon.inkBatch = null; throw error; }
    return job;
  }
  function prepare(addon, payload) {
    var job = requireJob(addon, payload);
    if (payload.position !== job.position || job.position >= job.ids.length) throw new Error("批量处理顺序已失效");
    job.prepared = null;
    var id = job.ids[job.position++], note, snapshot;
    try {
      note = native.database().getNoteById(id);
      if (!note || String(note.notebookId) !== job.topic) throw new Error("卡片已删除或移动到其他学习集");
      snapshot = native.describeNote(note);
      if (!snapshot.source) throw new Error("没有可读取的手写绘图");
      var media = native.drawingMedia(note, snapshot.source);
      requireJob(addon, payload);
      job.prepared = snapshot;
      return { noteId: id, title: snapshot.title, media: media };
    } catch (error) {
      // 任务失效属于整批停止；单卡数据缺失或解码失败仅跳过该卡。
      requireJob(addon, payload);
      return { noteId: id, title: snapshot ? snapshot.title : id, skipped: true, reason: String(error.message || error) };
    }
  }
  function apply(addon, payload) {
    var job = requireJob(addon, payload), snapshot = job.prepared;
    if (!snapshot || snapshot.noteId !== payload.noteId) throw new Error("这张卡尚未准备识别，不能批量写入");
    job.prepared = null;
    try {
      var note = native.database().getNoteById(snapshot.noteId);
      if (!note || String(note.notebookId) !== job.topic) throw new Error("卡片已删除或移动到其他学习集");
      return native.applyForNote(note, { noteId: snapshot.noteId, index: snapshot.source.index, hash: snapshot.source.hash,
        settingsToken: job.token, expectedColorIndex: snapshot.colorIndex, automatic: false, histogram: payload.histogram });
    } catch (error) { return { status: "skipped", reason: String(error.message || error) }; }
  }
  function end(addon, payload) {
    if (addon.inkBatch && addon.inkBatch.id === payload.batchId) addon.inkBatch = null;
    return { ended: true };
  }
  return { begin: begin, prepare: prepare, apply: apply, end: end };
})();
