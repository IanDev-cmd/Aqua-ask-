/* AquaAsk PWA: Chrome install prompt, QR, Web Push */
(function () {
  var deferredPrompt = null;
  var qrDrawn = "";
  var swReg = null;
  var vapidPublic = "";
  var lastEndpoint = "";

  function originUrl() {
    return (location.origin && location.origin !== "null") ? location.origin.replace(/\/$/, "") : "https://aqua-ask.onrender.com";
  }
  function installUrl() {
    return originUrl() + "/install";
  }
  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }
  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
  }
  function isAndroid() {
    return /android/i.test(navigator.userAgent || "");
  }
  function isChromeFamily() {
    var ua = navigator.userAgent || "";
    return /Chrome|Chromium|Edg|OPR/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua);
  }
  function isWebView() {
    var ua = navigator.userAgent || "";
    return /; wv\)|WebView|Instagram|FBAN|FBAV|Line\/|Twitter/i.test(ua);
  }
  function wantNativeInstall() {
    var path = (location.pathname || "").replace(/\/$/, "") || "/";
    var q = new URLSearchParams(location.search);
    return path === "/install" || q.get("install") === "1";
  }
  function chromeIntentUrl() {
    var host = originUrl().replace(/^https?:\/\//, "");
    return "intent://" + host + "/install#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" + encodeURIComponent(installUrl()) + ";end";
  }

  function sheet() { return document.getElementById("pwaSheet"); }
  function note() { return document.getElementById("pwaNote"); }
  function installBtn() { return document.getElementById("pwaInstall"); }
  function pushBtn() { return document.getElementById("pwaPush"); }

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
          svg.setAttribute("aria-label", "QR code to install AquaAsk as a Chrome app");
          svg.style.width = "100%";
          svg.style.height = "auto";
        }
        qrDrawn = url;
        return;
      } catch (err) {}
    }
    var img = document.createElement("img");
    img.alt = "QR code to install AquaAsk as a Chrome app";
    img.width = 240;
    img.height = 240;
    img.src = "https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&ecc=M&data=" + encodeURIComponent(url);
    host.appendChild(img);
    qrDrawn = url;
  }

  function refreshButtons() {
    var btn = installBtn();
    var push = pushBtn();
    if (isStandalone()) {
      if (btn) { btn.textContent = "Installed as app"; btn.disabled = true; }
    } else if (isWebView() && isAndroid()) {
      if (btn) { btn.textContent = "Open Chrome to install"; btn.disabled = false; }
    } else {
      if (btn) { btn.textContent = "Install app"; btn.disabled = false; }
    }
    if (push) {
      if (!("Notification" in window) || !("PushManager" in window)) {
        push.hidden = true;
        return;
      }
      push.hidden = false;
      if (Notification.permission === "granted") {
        push.textContent = "Notifications on";
      } else {
        push.textContent = "Enable notifications";
        push.disabled = false;
      }
    }
  }

  function openCard(fromScan) {
    var box = sheet();
    if (!box) return;
    if (window.closeAquaMenus) window.closeAquaMenus();
    drawQr(installUrl());
    box.classList.add("open");
    document.body.classList.add("pwa-open");
    refreshButtons();
    if (isStandalone()) {
      setNote("AquaAsk is already installed as an app on this device. Enable notifications to get OneAquaHealth alerts on your home screen.");
    } else if (isWebView() && isAndroid()) {
      setNote("This in-app browser cannot install PWAs. Open in Chrome — Chrome will ask to install AquaAsk as a real app.");
    } else if (fromScan || wantNativeInstall()) {
      if (isIos()) {
        setNote("On iPhone: tap Share, then Add to Home Screen. That installs AquaAsk as an app, not a Safari tab.");
      } else {
        setNote("Chrome will ask to install AquaAsk as an app on this phone. Tap Install app if the system prompt is waiting.");
        tryNativeInstall();
      }
    } else {
      setNote("Scan the QR with your phone camera. Chrome opens the install prompt so AquaAsk is added as a real app — not a website shortcut.");
    }
  }

  function closeCard() {
    var box = sheet();
    if (box) box.classList.remove("open");
    document.body.classList.remove("pwa-open");
  }

  function tryNativeInstall() {
    var btn = installBtn();
    if (isStandalone()) return false;
    if (isWebView() && isAndroid()) {
      location.href = chromeIntentUrl();
      return true;
    }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === "accepted") {
          setNote("Installed. Open AquaAsk from your home screen — it launches as a standalone app.");
          if (btn) { btn.textContent = "Installed as app"; btn.disabled = true; }
        } else {
          setNote("Install was dismissed. Tap Install app again — Chrome’s native prompt installs the app, not a web tab.");
        }
        deferredPrompt = null;
      }).catch(function () {
        setNote("Tap Install app to open Chrome’s native install dialog.");
      });
      return true;
    }
    return false;
  }

  function promptInstall() {
    if (isStandalone()) return;
    if (tryNativeInstall()) return;
    if (isIos()) {
      setNote("Safari on iOS: tap Share, then Add to Home Screen. That installs AquaAsk as a real app.");
      return;
    }
    if (!isChromeFamily()) {
      setNote("Open this page in Google Chrome, then tap Install app. Chrome’s install dialog adds AquaAsk as an app.");
      return;
    }
    setNote("Chrome is preparing the install. Stay on this page a moment, then tap Install app. Look for Chrome’s Install app dialog — not Add bookmark.");
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function loadVapid() {
    return fetch("/api/push/vapid").then(function (res) { return res.ok ? res.json() : null; }).then(function (data) {
      vapidPublic = (data && data.publicKey) || "";
      return vapidPublic;
    }).catch(function () { return ""; });
  }

  function subscribePush() {
    return Promise.resolve(vapidPublic || loadVapid()).then(function () {
      if (swReg) return swReg;
      return navigator.serviceWorker.ready.then(function (reg) {
        swReg = reg;
        return reg;
      });
    }).then(function () {
      if (!swReg || !vapidPublic) throw new Error("push-unready");
      return Notification.requestPermission();
    }).then(function (perm) {
      if (perm !== "granted") throw new Error("permission");
      return swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublic)
      });
    }).then(function (sub) {
      lastEndpoint = sub.endpoint || "";
      return fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON ? sub.toJSON() : sub)
      }).then(function (res) {
        if (!res.ok) throw new Error("subscribe");
        return fetch("/api/push/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint })
        });
      });
    });
  }

  function enablePush() {
    var push = pushBtn();
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setNote("This browser cannot receive app notifications.");
      return;
    }
    if (push) push.disabled = true;
    subscribePush().then(function () {
      setNote("Notifications are on. You will get a real system alert from the AquaAsk app — check your notification shade.");
      refreshButtons();
    }).catch(function () {
      if (push) push.disabled = false;
      setNote("Allow notifications when Chrome asks. That enables real app push, not in-page banners.");
    });
  }

  window.notifyAquaAsk = function (title, body, url) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    var payload = { title: title || "AquaAsk", body: body || "", url: url || location.pathname + location.search };
    if (swReg && swReg.showNotification) {
      swReg.showNotification(payload.title, {
        body: payload.body,
        icon: "/pwa/icon-192.png",
        badge: "/pwa/icon-192.png",
        data: { url: payload.url }
      });
    }
    if (!lastEndpoint) return;
    payload.endpoint = lastEndpoint;
    fetch("/api/push/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(function () {});
  };

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
    var push = pushBtn();
    if (push) push.addEventListener("click", function (e) {
      e.preventDefault();
      enablePush();
    });
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    refreshButtons();
    if (wantNativeInstall() && !isStandalone()) {
      window.setTimeout(tryNativeInstall, 120);
    }
  });
  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    setNote("AquaAsk is installed as a Chrome app. Open it from your home screen, then enable notifications.");
    refreshButtons();
  });

  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(function (reg) {
      swReg = reg;
    }).catch(function () {});
  }

  bind();
  loadVapid();
  window.openAquaPwa = openCard;
  window.closeAquaPwa = closeCard;

  if (wantNativeInstall()) {
    window.setTimeout(function () { openCard(true); }, 200);
  }
})();
