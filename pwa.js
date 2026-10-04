/* AquaAsk PWA: install overlay, real QR, home-screen prompt */
(function () {
  var deferredPrompt = null;
  var qrDrawn = "";

  function installUrl() {
    var origin = (location.origin && location.origin !== "null") ? location.origin : "https://aqua-ask.onrender.com";
    return origin.replace(/\/$/, "") + "/?install=1";
  }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
  }

  function sheet() { return document.getElementById("pwaSheet"); }
  function note() { return document.getElementById("pwaNote"); }
  function installBtn() { return document.getElementById("pwaInstall"); }

  function setNote(text) {
    var el = note();
    if (el) el.textContent = text;
  }

  function drawQr(url) {
    var host = document.getElementById("pwaQr");
    var label = document.getElementById("pwaUrl");
    if (label) label.textContent = url;
    if (!host) return;
    if (qrDrawn === url && host.getAttribute("data-url") === url) return;
    host.innerHTML = "";
    host.setAttribute("data-url", url);
    if (typeof qrcode === "function") {
      try {
        var qr = qrcode(0, "M");
        qr.addData(url);
        qr.make();
        host.innerHTML = qr.createSvgTag({ scalable: true, margin: 2 });
        var svg = host.querySelector("svg");
        if (svg) {
          svg.setAttribute("role", "img");
          svg.setAttribute("aria-label", "QR code to install AquaAsk");
          svg.style.width = "100%";
          svg.style.height = "auto";
        }
        qrDrawn = url;
        return;
      } catch (err) {}
    }
    var img = document.createElement("img");
    img.alt = "QR code to install AquaAsk";
    img.width = 240;
    img.height = 240;
    img.src = "https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&ecc=M&data=" + encodeURIComponent(url);
    host.appendChild(img);
    qrDrawn = url;
  }

  function openCard(fromScan) {
    var box = sheet();
    if (!box) return;
    if (window.closeAquaMenus) window.closeAquaMenus();
    drawQr(installUrl());
    box.classList.add("open");
    document.body.classList.add("pwa-open");
    var btn = installBtn();
    if (isStandalone()) {
      setNote("AquaAsk is already running as an installed app on this device. Every screen — Ask, Maps, Graphs, and Gallery — works offline-capable from your home screen.");
      if (btn) { btn.textContent = "Installed"; btn.disabled = true; }
    } else if (fromScan || isIos()) {
      if (isIos()) {
        setNote("On iPhone or iPad: tap Share, then Add to Home Screen. AquaAsk opens as a real app with Ask, Maps, Globe, Graphs, and Gallery.");
      } else {
        setNote("This link opened from the QR. Tap Install on this device to add AquaAsk to your home screen as a real app.");
      }
      if (btn) { btn.textContent = "Install on this device"; btn.disabled = false; }
    } else {
      setNote("Scan the QR with your phone camera. It opens AquaAsk and shows the install prompt so you can add it as a real app.");
      if (btn) { btn.textContent = "Install on this device"; btn.disabled = false; }
    }
  }

  function closeCard() {
    var box = sheet();
    if (box) box.classList.remove("open");
    document.body.classList.remove("pwa-open");
  }

  function promptInstall() {
    var btn = installBtn();
    if (isStandalone()) return;
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === "accepted") {
          setNote("Installed. Launch AquaAsk from your home screen — it is a standalone app for every screen.");
          if (btn) { btn.textContent = "Installed"; btn.disabled = true; }
        } else {
          setNote("Install was dismissed. You can scan the QR on a phone or use the browser’s Add to Home Screen menu.");
        }
        deferredPrompt = null;
      });
      return;
    }
    if (isIos()) {
      setNote("Safari on iOS: tap the Share button, then Add to Home Screen. That installs AquaAsk as a real app.");
      return;
    }
    setNote("If the install banner does not appear yet, use your browser menu → Install app / Add to Home Screen. Scanning the QR on a phone is the fastest path.");
  }

  function bind() {
    document.querySelectorAll("[data-pwa]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        openCard(false);
      });
    });
    var closeBtn = document.getElementById("pwaClose");
    if (closeBtn) closeBtn.addEventListener("click", closeCard);
    var box = sheet();
    if (box) box.addEventListener("click", function (e) {
      if (e.target === box) closeCard();
    });
    var btn = installBtn();
    if (btn) btn.addEventListener("click", function (e) {
      e.preventDefault();
      promptInstall();
    });
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    var btn = installBtn();
    if (btn && !isStandalone()) {
      btn.disabled = false;
      btn.textContent = "Install on this device";
    }
  });
  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    setNote("AquaAsk is on your home screen. Open it like any other app — Ask, Maps, Globe, Graphs, and Gallery all work.");
    var btn = installBtn();
    if (btn) { btn.textContent = "Installed"; btn.disabled = true; }
  });

  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  }

  bind();
  window.openAquaPwa = openCard;
  window.closeAquaPwa = closeCard;

  var boot = new URLSearchParams(location.search);
  if (boot.get("install") === "1") {
    window.setTimeout(function () { openCard(true); }, 280);
  }
})();
