/* Polls the Ask service for voice-agent commands and runs the matching UX control. */
(function () {
  var ORIGIN = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "http://127.0.0.1:8001"
    : location.origin;
  var SINCE_KEY = "il-agent-since";
  var PENDING_KEY = "il-agent-pending";
  var PILOTS = ["coimbra", "toulouse", "ghent", "benevento", "oslo"];

  function log(level, message) {
    if (window.ILLog) window.ILLog(level, message);
    else (window.__ILLogQ = window.__ILLogQ || []).push([level, message]);
  }

  function click(selector) {
    var el = document.querySelector(selector);
    if (el) el.click();
    return !!el;
  }

  function cityQuery(detail) {
    var text = (detail || "").toLowerCase();
    for (var i = 0; i < PILOTS.length; i++) {
      if (text.indexOf(PILOTS[i]) !== -1) return PILOTS[i];
    }
    return "";
  }

  function openMaps(view) {
    var tab = document.querySelector('[data-tab="maps"]');
    if (tab) tab.click();
    if (view === "globe") return click('[data-mapview="globe"]');
    return click('[data-mapview="2d"]') || !!tab;
  }

  function runHere(command) {
    var action = command.action;
    var detail = command.detail || "";
    if (action === "open_home") {
      if (typeof window.resetAquaAsk === "function") { window.resetAquaAsk(); return true; }
      location.href = "/";
      return true;
    }
    if (action === "open_ask") {
      if (typeof window.runAquaAsk === "function") {
        window.runAquaAsk(detail || "hello");
        return true;
      }
      var askInput = document.getElementById("q");
      var form = document.getElementById("askForm");
      if (!askInput || !form) return false;
      if (detail) askInput.value = detail;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      return true;
    }
    if (action === "open_globe") return openMaps("globe");
    if (action === "open_maps") return openMaps("2d");
    if (action === "close_maps") return click('[data-tab="answer"]');
    if (action === "open_mobile") {
      if (typeof window.openAquaPwa === "function") { window.openAquaPwa(false); return true; }
      return false;
    }
    if (action === "search_city") {
      var city = cityQuery(detail) || detail;
      if (typeof window.runAquaAsk === "function") {
        window.runAquaAsk("Urban stream health in " + city);
        return true;
      }
      return false;
    }
    return false;
  }

  function go(command) {
    log("ok", "command #" + command.id + " " + command.action + (command.detail ? " " + command.detail : ""));
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      var done = runHere(command);
      if (done || tries > 25) {
        clearInterval(timer);
        sessionStorage.removeItem(PENDING_KEY);
        log(done ? "ok" : "error", done ? "ran " + command.action : "gave up on " + command.action);
      }
    }, 200);
  }

  function remember(id) {
    localStorage.setItem(SINCE_KEY, String(id));
  }

  function bootPending() {
    var raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return;
    try { go(JSON.parse(raw)); } catch (err) { sessionStorage.removeItem(PENDING_KEY); }
  }

  var pollNoted = false;
  var pollMisses = 0;
  var logSince = 0;
  function poll() {
    var since = localStorage.getItem(SINCE_KEY) || "0";
    fetch(ORIGIN + "/api/agent/command?since=" + encodeURIComponent(since))
      .then(function (res) {
        return res.text().then(function (text) {
          if (!res.ok) {
            pollMisses += 1;
            if (pollMisses === 1 || pollMisses % 25 === 0) {
              log("error", "command poll " + res.status + " from " + ORIGIN + " " + text.slice(0, 160));
            }
            return null;
          }
          pollMisses = 0;
          if (!pollNoted) {
            pollNoted = true;
            log("info", "bridge reachable at " + ORIGIN);
          }
          try { return JSON.parse(text); } catch (err) {
            log("error", "command poll returned non-JSON");
            return null;
          }
        });
      })
      .then(function (data) {
        var command = data && data.command;
        if (!command || !command.id) return;
        remember(command.id);
        go(command);
      })
      .catch(function (err) {
        log("error", "command poll failed: " + (err && err.message ? err.message : "network"));
      });
    fetch(ORIGIN + "/api/agent/logs?since=" + logSince)
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        var rows = (data && data.logs) || [];
        rows.forEach(function (row) {
          logSince = row.id;
          log(row.level === "error" ? "error" : row.level === "ok" ? "ok" : "info", "server: " + row.message);
        });
      })
      .catch(function () {});
  }

  log("info", "bridge listening");
  bootPending();
  setInterval(poll, 1200);
  poll();
})();
