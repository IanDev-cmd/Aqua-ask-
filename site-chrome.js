/* Logs gear and the ElevenLabs voice widget. */
(function () {
  var style = document.createElement("style");
  style.textContent = [
    "body.il-on-home .il-gear{top:18px;}",
    ".il-gear{position:fixed;z-index:80;top:14px;left:14px;width:36px;height:36px;border:0;border-radius:50%;",
    "background:#fff;color:#12202c;box-shadow:0 2px 10px rgba(0,0,0,.28);cursor:pointer;display:grid;place-items:center;padding:0;}",
    ".il-gear svg{width:18px;height:18px;display:block;}",
    ".il-log{display:none;position:fixed;z-index:80;top:58px;left:14px;width:min(440px,calc(100vw - 28px));",
    "height:min(48vh,380px);overflow:auto;background:rgba(8,16,24,.94);color:#d7ecf5;",
    "font:12px/1.45 ui-monospace,Consolas,monospace;border-radius:12px;padding:10px 12px;box-shadow:0 8px 28px rgba(0,0,0,.35);}",
    ".il-log.open{display:block;}",
    ".il-log .err{color:#ffb4a8;}.il-log .ok{color:#b6f5c8;}.il-log .info{color:#d7ecf5;}"
  ].join("");
  document.head.appendChild(style);
  document.body.classList.add("il-on-home");

  var gear = document.createElement("button");
  gear.type = "button";
  gear.className = "il-gear";
  gear.setAttribute("aria-label", "App logs");
  gear.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/></svg>';
  var panel = document.createElement("div");
  panel.className = "il-log";
  panel.setAttribute("role", "log");
  document.body.appendChild(gear);
  document.body.appendChild(panel);
  function stamp(level, message) {
    var line = document.createElement("div");
    line.className = level === "error" ? "err" : level === "ok" ? "ok" : "info";
    var now = new Date();
    var hh = String(now.getHours()).padStart(2, "0");
    var mm = String(now.getMinutes()).padStart(2, "0");
    var ss = String(now.getSeconds()).padStart(2, "0");
    line.textContent = hh + ":" + mm + ":" + ss + "  " + message;
    panel.appendChild(line);
    while (panel.childNodes.length > 200) panel.removeChild(panel.firstChild);
    panel.scrollTop = panel.scrollHeight;
  }
  window.ILLog = function (level, message) { stamp(level || "info", message); };
  (window.__ILLogQ || []).forEach(function (row) { stamp(row[0], row[1]); });
  window.__ILLogQ = [];
  window.addEventListener("error", function (ev) {
    stamp("error", "page error: " + (ev.message || "unknown") + (ev.filename ? " (" + ev.filename.split("/").pop() + ":" + ev.lineno + ")" : ""));
  });
  window.addEventListener("unhandledrejection", function (ev) {
    var reason = ev.reason && (ev.reason.message || String(ev.reason));
    stamp("error", "unhandled: " + (reason || "promise"));
  });
  stamp("info", "log open on " + location.pathname);
  gear.addEventListener("click", function () {
    var open = panel.classList.toggle("open");
    gear.setAttribute("aria-expanded", open ? "true" : "false");
  });

  if (!document.querySelector("elevenlabs-convai")) {
    var widget = document.createElement("elevenlabs-convai");
    widget.setAttribute("agent-id", "agent_0701m3hfg95pepjts080nqe1rmf8");
    document.body.appendChild(widget);
    var script = document.createElement("script");
    script.src = "https://unpkg.com/@elevenlabs/convai-widget-embed";
    script.async = true;
    document.body.appendChild(script);
  }
})();
