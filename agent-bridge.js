/* Polls the Ask service for voice-agent commands and runs the matching UX control. */
(function () {
  var ORIGIN = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "http://127.0.0.1:8001"
    : location.origin;
  var SINCE_KEY = "il-agent-since";
  var PENDING_KEY = "il-agent-pending";

  function log(level, message) {
    if (window.ILLog) window.ILLog(level, message);
    else (window.__ILLogQ = window.__ILLogQ || []).push([level, message]);
  }

  function pageKind() {
    var path = location.pathname;
    if (path.indexOf("desktop.html") !== -1) return "globe";
    if (path.indexOf("aquaask.html") !== -1) return "ask";
    if (path.indexOf("/mobile/") !== -1) return "mobile";
    return "home";
  }

  function urls() {
    return {
      home: "index.html",
      globe: "index.html",
      ask: "index.html",
      mobile: "index.html"
    };
  }

  function askSection(detail) {
    var section = (detail || "").toLowerCase().trim();
    if (section === "library" || section === "sources" || section === "pulse" || section === "labs" || section === "upload") return section;
    return "";
  }

  function needsPage(action) {
    if (action === "open_home") return "home";
    if (action === "open_ask") return "home";
    if (action === "open_mobile") return "home";
    return "home";
  }

  function click(selector) {
    var el = document.querySelector(selector);
    if (el) el.click();
    return !!el;
  }

  function cityId(detail) {
    var text = (detail || "").toLowerCase();
    var ids = ["jakarta", "manila", "lagos", "miami", "mumbai", "mombasa", "sydney", "rotterdam", "hcmc", "capetown"];
    if (text.indexOf("ho chi") !== -1 || text.indexOf("saigon") !== -1 || text === "hcmc") return "hcmc";
    if (text.indexOf("cape") !== -1) return "capetown";
    for (var i = 0; i < ids.length; i++) {
      if (text.indexOf(ids[i]) !== -1) return ids[i];
    }
    return "";
  }

  function cardId(detail) {
    var city = cityId(detail);
    if (city) return city;
    var text = (detail || "").toLowerCase();
    var cards = [
      ["ocean", "ocean"],
      ["climate", "climate"],
      ["arctic", "arctic"],
      ["thirst", "thirsty"],
      ["bird", "birds"],
      ["jungle", "jungle"],
      ["wallet", "wallet"],
      ["milestone", "milestone"]
    ];
    for (var i = 0; i < cards.length; i++) {
      if (text.indexOf(cards[i][0]) !== -1) return cards[i][1];
    }
    return "";
  }

  function layerKey(detail) {
    var text = (detail || "").toLowerCase();
    if (text.indexOf("night") !== -1) return "night";
    if (text.indexOf("marble") !== -1 || text.indexOf("satellite") !== -1) return "marble";
    return "default";
  }

  function runHere(command) {
    var action = command.action;
    var detail = command.detail || "";
    if (action === "open_globe" || action === "open_home" || action === "open_mobile") return true;
    if (action === "open_maps") {
      if (typeof window.openTerraRoadmap === "function") {
        window.openTerraRoadmap(cityId(detail) || "jakarta");
        return true;
      }
      return false;
    }
    if (action === "close_maps") return click("#terraClose") || click("#rmPathClose");
    if (action === "zoom_in") return click("#gPlus");
    if (action === "zoom_out") return click("#gMinus");
    if (action === "set_layer") {
      if (typeof window.__globeTex === "function") {
        window.__globeTex(layerKey(detail));
        return true;
      }
      return false;
    }
    if (action === "open_compass") return click("#compassFab") || click("#terraGpsCompass");
    if (action === "open_wallet") return click('.icon-tip[data-card="wallet"]');
    if (action === "open_milestone") return click('.icon-tip[data-card="milestone"]');
    if (action === "search_city") {
      var id = cityId(detail);
      var card = id && document.querySelector('.card[data-id="' + id + '"]');
      if (card) { card.click(); return true; }
      var input = document.getElementById("gsearchIn");
      if (input && detail) {
        input.value = detail;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
      return false;
    }
    if (action === "open_card") {
      var cid = cardId(detail);
      if (cid === "wallet" || cid === "milestone") return click('.icon-tip[data-card="' + cid + '"]');
      var button = cid && document.querySelector('.card[data-id="' + cid + '"]');
      if (button) { button.click(); return true; }
      return false;
    }
    if (action === "open_ask") {
      if (typeof window.runAquaAsk === "function") {
        window.runAquaAsk(detail || "hello");
        return true;
      }
      var askInput = document.getElementById("q") || document.getElementById("askInput");
      var form = document.getElementById("askForm");
      if (!askInput || !form) return false;
      if (detail) {
        askInput.value = detail;
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
      return true;
    }
    return false;
  }

  function go(command) {
    var target = needsPage(command.action);
    log("ok", "command #" + command.id + " " + command.action + (command.detail ? " " + command.detail : "") + " on " + pageKind());
    if (pageKind() !== target) {
      var dest = urls()[target];
      if (command.action === "open_ask" && command.detail && target === "ask") {
        sessionStorage.removeItem(PENDING_KEY);
        var section = askSection(command.detail);
        location.href = section ? dest + "#" + section : dest + "?q=" + encodeURIComponent(command.detail);
        return;
      }
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(command));
      if (command.action === "open_maps") dest += "#roadmap";
      log("info", "navigate to " + dest);
      location.href = dest;
      return;
    }
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

  log("info", "bridge listening on the " + pageKind() + " page");
  bootPending();
  setInterval(poll, 1200);
  poll();
})();
