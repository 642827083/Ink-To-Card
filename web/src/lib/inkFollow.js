var InkToCardFollow = (function () {
  // 每张卡分别等待稳定，单消费者处理；不依赖当前选择，也不扫描整个学习集。
  function create(options) {
    var now = options.now || Date.now, later = options.later || setTimeout, cancel = options.cancel || clearTimeout;
    var jobs = new Map(), attempted = new Map(), enabled = false, timer = null, working = false, generation = 0;
    function plan() {
      if (timer !== null) { cancel(timer); timer = null; }
      if (!enabled || working || !jobs.size) return;
      var due = Infinity;
      jobs.forEach(function (job) { due = Math.min(due, job.next, job.finished ? job.expires : Infinity); });
      timer = later(function () { timer = null; run(); }, Math.max(0, due - now()));
    }
    function enqueue(id) {
      if (!enabled || typeof id !== "string" || !id || id.length > 128) return;
      var time = now(), job = jobs.get(id);
      if (!job) {
        if (jobs.size >= 128) { options.onError(new Error("待识别卡片较多，请用批量处理补查")); return; }
        job = { id: id, key: "", observed: 0, errors: 0, revision: 0, finished: false };
        jobs.set(id, job);
      }
      job.revision += 1; job.next = time; job.tail = time + 1800; job.expires = time + 8000;
      plan();
    }
    async function run() {
      if (!enabled || working) return;
      var time = now(), job = null;
      jobs.forEach(function (candidate, id) {
        if (candidate.finished && candidate.expires <= time) { jobs.delete(id); return; }
        if (candidate.next <= time && (!job || candidate.next < job.next)) job = candidate;
      });
      if (!job) { plan(); return; }
      working = true;
      var epoch = generation, revision = job.revision;
      function valid() { return enabled && epoch === generation && jobs.get(job.id) === job; }
      try {
        var snapshot = await options.read(job.id);
        if (!valid()) return;
        if (job.revision !== revision) { job.next = now(); return; }
        if (!snapshot.available || !snapshot.settings.auto || !snapshot.source) { jobs.delete(job.id); return; }
        var key = snapshot.topicId + ":" + snapshot.noteId + ":" + snapshot.source.index + ":" + snapshot.source.hash + ":" + JSON.stringify(snapshot.settings);
        if (key !== job.key) { job.key = key; job.finished = false; job.observed = now(); job.next = now() + 300; return; }
        if (now() - job.observed < 300) { job.next = job.observed + 300; return; }
        if (!attempted.has(key)) {
          if (options.busy && options.busy()) { job.next = now() + 100; return; }
          // 每份媒体只自动尝试一次，保护撤销和手动改色；下一份媒体有独立的机会。
          attempted.set(key, true);
          if (attempted.size > 256) attempted.delete(attempted.keys().next().value);
          var handled = await options.handle(snapshot, valid);
          if (!valid()) return;
          if (handled === false) { attempted.delete(key); job.next = now() + 100; return; }
        }
        job.finished = true;
        // 官方事件有 1.5 秒去重窗口；追加复查。尚未处理的任务不因批量忙碌而过期。
        job.next = job.tail > now() ? job.tail : now() + 1500;
      } catch (error) {
        if (valid()) {
          options.onError(error);
          job.errors += 1;
          if (job.errors >= 3) jobs.delete(job.id); else job.next = now() + 1500;
        }
      } finally { working = false; plan(); }
    }
    function reset() {
      generation += 1; jobs.clear();
      if (timer !== null) cancel(timer);
      timer = null;
    }
    return {
      enqueue: enqueue,
      setEnabled: function (value) { value = value === true; if (enabled === value) return; enabled = value; if (!enabled) reset(); else plan(); },
      invalidate: reset,
      stop: function () { enabled = false; reset(); }
    };
  }
  return { create: create };
})();
