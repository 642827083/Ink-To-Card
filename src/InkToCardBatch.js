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
  function childCards(note) {
    var children = native.list(native.value(note, "childNotes")), childMap = native.value(note, "childMindMap");
    return childMap ? children.concat([childMap]) : children;
  }
  function begin(addon, payload) {
    var controller = notebook(addon), topic = String(controller.notebookId);
    if (["selected", "direct-children", "children"].indexOf(payload.scope) < 0) throw new Error("批量范围无效");
    var childrenOnly = payload.scope !== "selected", directOnly = payload.scope === "direct-children", view = controller.mindmapView;
    if (!view || native.value(view, "selViewLst") === undefined) throw new Error("当前 MN 未开放脑图选中列表");
    var roots = native.list(native.value(view, "selViewLst")).map(unwrap);
    if (roots.some(function (item) { return !item || !item.noteId; })) throw new Error("无法读取选中的卡片对象");
    if (!roots.length) throw new Error(childrenOnly ? "请先在脑图中选中要处理下级卡片的父卡片" : "请先在脑图中选中要处理的卡片");
    var queue = roots.slice(), seen = Object.create(null), excluded = Object.create(null), ids = [];
    // 多选父子卡片时，所有选中项均只作为遍历起点，不参与子卡片改色。
    if (childrenOnly) roots.forEach(function (item) { excluded[String(item.noteId)] = true; });
    if (directOnly) {
      // 先收集每个选中项的直接下级，不再向下展开，避免多选父子时受遍历顺序影响。
      queue = [];
      roots.forEach(function (item) {
        if (String(item.notebookId) === topic) queue = queue.concat(childCards(item));
      });
    }
    while (queue.length) {
      var item = queue.pop(), id = item && String(item.noteId || "");
      if (!id || seen[id]) continue;
      seen[id] = true;
      if (String(item.notebookId) !== topic) continue;
      if (!excluded[id]) ids.push(id);
      if (ids.length > 5000) throw new Error("一次最多处理 5000 张卡，请缩小选择范围");
      if (payload.scope === "children") queue = queue.concat(childCards(item));
    }
    if (!ids.length) throw new Error(directOnly ? "选中卡片下没有可处理的下一级卡片"
      : childrenOnly ? "选中卡片下没有可处理的下级卡片" : "请先在脑图中选中要处理的卡片");
    var options = native.settings(topic);
    if (options.mapping.uncolored < 0 && (options.policy === "red" ? options.mapping.red < 0 : !Object.keys(options.mapping).some(function (key) { return options.mapping[key] >= 0; }))) {
      throw new Error(options.policy === "red" ? "请先设置红色对应的卡片色号" : "请先设置笔迹颜色映射");
    }
    var job = { id: "batch-" + Date.now() + "-" + (++serial), topic: topic, ids: ids,
      settings: options, token: JSON.stringify(options), directAnalysis: payload.analysisMode === "ink", position: 0, prepared: null };
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
      var media = job.directAnalysis ? native.analyzeDrawing(note, snapshot.source, job.settings) : native.drawingMedia(note, snapshot.source);
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
        settingsToken: job.token, expectedColorIndex: snapshot.colorIndex, automatic: false, histogram: payload.histogram }, job.directAnalysis, function () {
          requireJob(addon,payload);
          return native.database().getNoteById(snapshot.noteId);
        });
    } catch (error) { requireJob(addon,payload); return { status: "skipped", reason: String(error.message || error) }; }
  }
  function end(addon, payload) {
    if (addon.inkBatch && addon.inkBatch.id === payload.batchId) addon.inkBatch = null;
    return { ended: true };
  }
  return { begin: begin, prepare: prepare, apply: apply, end: end };
})();
