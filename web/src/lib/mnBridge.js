var MNBridge = (function () {
  var pending = {}, queue = [], running = false;
  window.InkToCardReceive = function (response) {
    var item = pending[response.requestId];
    if (!item) return;
    clearTimeout(item.timeout);
    delete pending[response.requestId];
    item.frame.remove();
    running = false;
    if (response.error) item.reject(new Error(response.error));
    else item.resolve(response.payload);
    pump();
  };
  function pump() {
    if (running || !queue.length) return;
    var item = queue.shift();
    running = true;
    pending[item.id] = item;
    var frame = document.createElement("iframe");
    frame.hidden = true;
    item.frame = frame;
    item.timeout = setTimeout(function () {
      if (!pending[item.id]) return;
      delete pending[item.id]; frame.remove(); running = false;
      item.reject(new Error("MN 未响应，请重新打开插件或检查插件日志")); pump();
    }, 20000);
    frame.src = "inktocard://bridge?payload=" + encodeURIComponent(JSON.stringify({ requestId: item.id, command: item.command, payload: item.payload }));
    document.body.appendChild(frame);
  }
  function send(command, payload) {
    if (window.InkToCardDemoBridge) return window.InkToCardDemoBridge.send(command, payload);
    return new Promise(function (resolve, reject) {
      queue.push({ id: Date.now() + "-" + Math.random().toString(16).slice(2), command: command, payload: payload || {}, resolve: resolve, reject: reject });
      pump();
    });
  }
  return { send: send };
})();
