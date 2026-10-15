// 在业务脚本之前运行；即使业务脚本未加载或初始化失败，也能显示原因。
var InkToCardStartup = (function () {
  var initialized = false, settled = false, failure = "";
  function showFailure() {
    if (!failure) return;
    var title = document.getElementById("note-title"), status = document.getElementById("status");
    if (!title || !status) return;
    title.textContent = "插件启动失败";
    status.textContent = failure + "。请重新导入测试包并重启 MarginNote。";
    status.className = "error";
    document.querySelectorAll("button, select, input").forEach(function (control) { control.disabled = true; });
  }
  function fail(message) {
    if (failure) return;
    failure = message; clearTimeout(watchdog); showFailure();
  }
  var watchdog = setTimeout(function () {
    if (!settled) fail(initialized ? "MN 卡片读取未完成" : "页面脚本未完成初始化");
  }, 25000);
  window.addEventListener("error", function (event) {
    if (event.target && event.target.tagName === "SCRIPT") {
      fail("脚本无法加载：" + String(event.target.src || "未知文件").split("/").pop());
    } else if (event.message) { fail("页面脚本出错：" + event.message); }
  }, true);
  window.addEventListener("unhandledrejection", function (event) {
    fail("页面操作出错：" + String(event.reason && event.reason.message || event.reason));
  });
  document.addEventListener("DOMContentLoaded", showFailure);
  return {
    initialized: function () { initialized = true; },
    settled: function () { settled = true; clearTimeout(watchdog); },
    failed: function () { return !!failure; }
  };
})();
