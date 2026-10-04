/* AquaAsk product tour: glow the active control, show a tip card, autoclick a full ask. */
(function () {
  var QUESTION = "What is happening in urban streams in Coimbra, Toulouse, Ghent, Benevento, and Oslo?";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var running = false;
  var waitTimer = 0;
  var waitResolve = null;
  var currentEl = null;
  var idx = 0;
  var STEPS = [];

  function $(sel) { return document.querySelector(sel); }
  function card() { return document.getElementById("tourCard"); }
  function ms(n) { return reduced ? Math.min(420, Math.round(n * 0.35)) : n; }

  function clearGlow() {
    document.querySelectorAll(".tour-glow").forEach(function (el) {
      el.classList.remove("tour-glow", "is-on");
    });
    currentEl = null;
  }

  function placeCard(el) {
    var box = card();
    if (!box) return;
    var cw = Math.min(320, window.innerWidth - 28);
    var ch = box.offsetHeight || 168;
    var x = 16;
    var y = window.innerHeight - ch - 18;
    if (el) {
      var r = el.getBoundingClientRect();
      x = Math.min(window.innerWidth - cw - 14, Math.max(14, r.left));
      y = r.bottom + 14;
      if (r.top < 72) {
        x = 16;
        y = Math.max(72, r.bottom + 16);
        if (y + ch > window.innerHeight - 12) y = 88;
      } else if (y + ch > window.innerHeight - 12) {
        y = Math.max(12, r.top - ch - 14);
      }
    }
    box.style.left = x + "px";
    box.style.top = Math.max(12, y) + "px";
  }

  function showCard(step, n, total) {
    var box = card();
    document.getElementById("tourStepN").textContent = String(n);
    document.getElementById("tourStepT").textContent = String(total);
    document.getElementById("tourTitle").textContent = step.title;
    document.getElementById("tourBody").textContent = step.body;
    box.classList.add("open");
    box.hidden = false;
    box.setAttribute("aria-hidden", "false");
    placeCard(currentEl);
  }

  function glow(el) {
    clearGlow();
    if (!el) return;
    currentEl = el;
    el.classList.add("tour-glow", "is-on");
    try { el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduced ? "auto" : "smooth" }); } catch (e) {}
  }

  function wait(n) {
    if (skipWait) return Promise.resolve("next");
    return new Promise(function (resolve) {
      window.clearTimeout(waitTimer);
      waitResolve = function (why) {
        waitResolve = null;
        window.clearTimeout(waitTimer);
        resolve(why || "timeout");
      };
      waitTimer = window.setTimeout(function () {
        if (waitResolve) waitResolve("timeout");
      }, ms(n));
    });
  }

  var skipWait = false;

  function waitUntil(fn, timeout) {
    var limit = Date.now() + (timeout || 40000);
    return new Promise(function (resolve) {
      (function tick() {
        if (!running) return resolve("stop");
        if (skipWait || fn()) return resolve("ok");
        if (Date.now() > limit) return resolve("timeout");
        window.setTimeout(tick, 120);
      })();
    });
  }

  function typeQuestion(text) {
    var input = document.getElementById("q");
    if (!input) return Promise.resolve();
    input.value = "";
    input.focus();
    if (typeof window.fitAquaQuery === "function") window.fitAquaQuery();
    if (reduced || skipWait) {
      input.value = text;
      if (typeof window.fitAquaQuery === "function") window.fitAquaQuery();
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      var i = 0;
      function tick() {
        if (!running) return resolve();
        if (skipWait) {
          input.value = text;
          if (typeof window.fitAquaQuery === "function") window.fitAquaQuery();
          return resolve();
        }
        i += 1;
        input.value = text.slice(0, i);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        if (typeof window.fitAquaQuery === "function") window.fitAquaQuery();
        if (i >= text.length) return resolve();
        window.setTimeout(tick, 22);
      }
      tick();
    });
  }

  function clickEl(el) {
    if (!el) return;
    try { el.click(); } catch (e) {}
  }

  STEPS = [
    {
      sel: ".wordmark",
      title: "Welcome to AquaAsk",
      body: "OneAquaHealth search for urban streams, publications, and the five European pilots. This tour clicks every major control and asks a real question.",
      wait: 2400
    },
    {
      sel: "#homeLink",
      title: "Home",
      body: "Home always brings you back to this cinematic landing — search bar, suggestion cards, and shortcuts.",
      wait: 1800
    },
    {
      sel: "#askLink",
      title: "Ask",
      body: "Ask focuses the search bar without leaving this page. There is no separate ASK screen.",
      wait: 1800
    },
    {
      sel: "#appsBtn",
      title: "Apps grid",
      body: "The grid opens OneAquaHealth jumps: Globe, Health, Climate, Pulse, Cities, and Upload.",
      click: true,
      wait: 2200
    },
    {
      sel: "#apps",
      title: "Quick destinations",
      body: "Each tile is a ready-made question. We will close this and type a full query instead.",
      wait: 2000,
      after: function () { if (window.closeAquaMenus) window.closeAquaMenus(); }
    },
    {
      sel: "#askForm",
      title: "Search bar",
      body: "Type a OneAquaHealth question here. Plus opens extra prompts, the lens reverse-searches a photo, and AI Mode adds live web search.",
      wait: 2400
    },
    {
      sel: "#plusBtn",
      title: "Plus menu",
      body: "Explore the project, open Ask, upload studies, or jump to the five urban-stream cities.",
      click: true,
      wait: 2200
    },
    {
      sel: "#plusMenu",
      title: "Starter prompts",
      body: "These are the same questions the suggestion cards use. Closing the menu next.",
      wait: 1800,
      after: function () { if (window.closeAquaMenus) window.closeAquaMenus(); }
    },
    {
      sel: "#aiBtn",
      title: "AI Mode",
      body: "AI Mode forces a live web pass on top of the OneAquaHealth knowledge base when you need fresher context.",
      wait: 2000
    },
    {
      sel: ".gcard",
      title: "Suggestion cards",
      body: "Explore, Ask, Pilot cities, and Upload study files. Clicking one runs that query immediately.",
      wait: 2200
    },
    {
      sel: "#shortcuts",
      title: "Shortcut row",
      body: "Ask, Sources, Health, Climate, Pulse, Menu, and Add shortcut. This last row has no glow outline — it stays clean over the ocean background.",
      wait: 2400
    },
    {
      sel: "#q",
      title: "A full question",
      body: "Watch AquaAsk type a real urban-stream question across all five pilot cities, then submit it.",
      wait: 600,
      run: function () { return typeQuestion(QUESTION); }
    },
    {
      sel: "#askForm",
      title: "Submitting",
      body: "The query goes to the RAG engine. Source icons bombard the bar while publications are retrieved.",
      run: function () {
        if (typeof window.runAquaAsk === "function") window.runAquaAsk(QUESTION, false);
        return waitUntil(function () {
          var bar = document.getElementById("modeBar");
          return bar && !bar.hidden && document.body.classList.contains("has-result") && !document.body.classList.contains("is-thinking");
        }, 50000);
      },
      wait: 800
    },
    {
      sel: "#quoteCard",
      title: "Answer card",
      body: "The white card matches the search bar width. Answer, Maps, Graphs, and Gallery stay on this same card.",
      wait: 2400
    },
    {
      sel: '[data-tab="answer"]',
      title: "Answer",
      body: "Grounded prose from OneAquaHealth publications, with citations represented as the icons in the search bar.",
      click: true,
      wait: 2200
    },
    {
      sel: '[data-tab="maps"]',
      title: "Maps",
      body: "2D opens on satellite imagery with the same stream GeoJSON and radius circles for each city.",
      click: true,
      wait: 2800
    },
    {
      sel: '[data-mapview="2d"]',
      title: "Satellite 2D",
      body: "Esri World Imagery is the default basemap. Cyan lines are Overpass waterways; rings are the urban-stream radius.",
      click: true,
      wait: 2600
    },
    {
      sel: '[data-mapview="globe"]',
      title: "Globe",
      body: "The 3D globe sits on Harmony’s deep blue (#001135 with the cyan radial) and rotates all the way around the five pilots.",
      click: true,
      wait: 3600
    },
    {
      sel: "[data-mapfull]",
      title: "Full screen",
      body: "Maps can fill the viewport. Use Full, then Exit or Escape to return to the card.",
      click: true,
      wait: 2400
    },
    {
      sel: "[data-mapfull]",
      title: "Exit full screen",
      body: "Back to the answer card. The 2D / Globe / Full controls stay with you.",
      click: true,
      wait: 1600
    },
    {
      sel: '[data-tab="graphs"]',
      title: "Graphs",
      body: "Interactive comparison across Coimbra, Toulouse, Ghent, Benevento, and Oslo. Hover the chart for a city readout.",
      click: true,
      wait: 2600
    },
    {
      sel: '[data-tab="gallery"]',
      title: "Gallery",
      body: "Real web and Wikipedia photos of the cities and streams — side by side, not stacked. Hover pauses the carousel.",
      click: true,
      wait: 3200
    },
    {
      sel: "#homeLink",
      title: "You’re ready",
      body: "Home clears the card. Ask anything about urban streams, One Health, or the five pilots.",
      click: true,
      wait: 2200
    }
  ];

  function stop(done) {
    running = false;
    window.clearTimeout(waitTimer);
    if (waitResolve) waitResolve("stop");
    waitResolve = null;
    clearGlow();
    var box = card();
    if (box) {
      box.classList.remove("open");
      box.hidden = true;
      box.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("is-tour");
    var fab = document.getElementById("tourStart");
    if (fab) fab.textContent = "Tour";
    if (done) {
      try { localStorage.setItem("aquaask-tour-v1", "1"); } catch (e) {}
    }
  }

  function runStep(step) {
    if (!running) return Promise.resolve("stop");
    skipWait = false;
    var el = step.sel ? $(step.sel) : null;
    glow(el);
    showCard(step, idx + 1, STEPS.length);
    var chain = Promise.resolve();
    if (step.run) chain = chain.then(step.run);
      if (step.click) {
        clickEl(el);
        window.setTimeout(function () { placeCard(currentEl); }, 90);
      }
    return chain.then(function () {
      if (!running) return "stop";
      return wait(step.wait || 1800);
    }).then(function (why) {
      if (step.after) step.after();
      return why;
    });
  }

  function start() {
    if (running) {
      stop(false);
      return;
    }
    running = true;
    idx = 0;
    document.body.classList.add("is-tour");
    var fab = document.getElementById("tourStart");
    if (fab) fab.textContent = "Stop";
    if (document.body.classList.contains("has-result") && typeof window.resetAquaAsk === "function") {
      window.resetAquaAsk();
    }
    if (window.closeAquaMenus) window.closeAquaMenus();

    (function next() {
      if (!running) return;
      if (idx >= STEPS.length) {
        stop(true);
        return;
      }
      runStep(STEPS[idx]).then(function (why) {
        if (!running || why === "stop") return;
        idx += 1;
        next();
      });
    })();
  }

  function bind() {
    var fab = document.getElementById("tourStart");
    var skip = document.getElementById("tourSkip");
    var nextBtn = document.getElementById("tourNext");
    if (fab) fab.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      start();
    });
    if (skip) skip.addEventListener("click", function (e) {
      e.stopPropagation();
      stop(true);
    });
    if (nextBtn) nextBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      skipWait = true;
      if (waitResolve) waitResolve("next");
    });
    var box = card();
    if (box) box.addEventListener("click", function (e) { e.stopPropagation(); });
    window.addEventListener("resize", function () {
      if (running) placeCard(currentEl);
    });
    window.addEventListener("keydown", function (e) {
      if (!running) return;
      if (e.key === "Escape") {
        e.preventDefault();
        stop(true);
      } else if (e.key === "Enter" || e.key === "ArrowRight") {
        if (waitResolve) waitResolve("next");
      }
    });
  }

  bind();
  window.startAquaTour = start;
  window.stopAquaTour = function () { stop(true); };

  var params = new URLSearchParams(location.search);
  var hasQ = !!(params.get("q") || "").trim();
  var force = params.get("tour") === "1";
  var install = params.get("install") === "1";
  var standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  var seen = false;
  try { seen = localStorage.getItem("aquaask-tour-v1") === "1"; } catch (e) {}
  if (!install && !standalone && (force || (!hasQ && !seen))) {
    window.setTimeout(function () {
      if (!running && !document.body.classList.contains("has-result")) start();
    }, force ? 400 : 1100);
  }
})();
