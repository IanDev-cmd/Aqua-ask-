/* AquaAsk answer-card modes: Maps (Leaflet 2D + Three globe), Graphs, Gallery */
(function () {
  var leafletPromise = null;
  var threePromise = null;
  var globe = { ready: false, spin: null, tilt: null, renderer: null, scene: null, camera: null, markers: [], raf: 0 };
  var galleryTimer = 0;
  var graphTip = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var hit = document.querySelector('script[src="' + src + '"]');
      if (hit) {
        if (hit.getAttribute("data-ok") === "1") return resolve();
        hit.addEventListener("load", resolve);
        hit.addEventListener("error", reject);
        return;
      }
      var el = document.createElement("script");
      el.src = src;
      el.async = true;
      el.onload = function () { el.setAttribute("data-ok", "1"); resolve(); };
      el.onerror = reject;
      document.head.appendChild(el);
    });
  }
  function loadCss(href) {
    if (document.querySelector('link[href="' + href + '"]')) return;
    var el = document.createElement("link");
    el.rel = "stylesheet";
    el.href = href;
    document.head.appendChild(el);
  }
  function leaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (!leafletPromise) {
      loadCss("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
      leafletPromise = loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js").then(function () { return window.L; });
    }
    return leafletPromise;
  }
  function three() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (!threePromise) {
      threePromise = loadScript("https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js");
    }
    return threePromise;
  }

  function setTab(root, name) {
    root.querySelectorAll(".mode-tab").forEach(function (btn) {
      btn.classList.toggle("is-on", btn.getAttribute("data-tab") === name);
    });
    root.querySelectorAll(".mode-panel").forEach(function (panel) {
      panel.classList.toggle("is-on", panel.getAttribute("data-panel") === name);
    });
    if (name === "maps") {
      window.setTimeout(function () {
        if (window.__aquaMap) window.__aquaMap.invalidateSize();
        resizeGlobe();
      }, 80);
    }
  }

  function overpass(lat, lon, radiusM) {
    var q = "[out:json][timeout:8];way[\"waterway\"~\"river|stream|canal\"](around:" + Math.round(radiusM) + "," + lat + "," + lon + ");out geom;";
    return fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: q,
      headers: { "Content-Type": "text/plain" }
    }).then(function (r) { return r.ok ? r.json() : { elements: [] }; }).catch(function () { return { elements: [] }; });
  }

  function drawMap(el, modes) {
    var spec = (modes && modes.map_2d) || {};
    var cities = spec.cities || [];
    var center = spec.center || { lat: 40.2, lon: -8.41 };
    leaflet().then(function (L) {
      if (window.__aquaMap) {
        window.__aquaMap.remove();
        window.__aquaMap = null;
      }
      el.innerHTML = "";
      var map = L.map(el, { zoomControl: true, attributionControl: false }).setView([center.lat, center.lon], 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);
      window.__aquaMap = map;
      cities.forEach(function (city) {
        var r = (city.radius_km || spec.radius_km || 5) * 1000;
        L.circle([city.lat, city.lon], {
          radius: r,
          color: city.risk === "ok" ? "#12b5c4" : "#f9ab00",
          weight: 2,
          fillColor: city.risk === "ok" ? "#12b5c4" : "#f9ab00",
          fillOpacity: 0.12
        }).addTo(map);
        L.circleMarker([city.lat, city.lon], {
          radius: 8,
          color: "#fff",
          weight: 2,
          fillColor: "#1a73e8",
          fillOpacity: 1
        }).addTo(map).bindPopup("<strong>" + city.name + "</strong><br>" + (city.stream || "") + "<br>" + (city.radius_km || spec.radius_km) + " km radius");
      });
      var op = spec.overpass;
      if (op && op.lat) {
        overpass(op.lat, op.lon, op.radius_m || 5000).then(function (data) {
          (data.elements || []).forEach(function (way) {
            var latlngs = (way.geometry || []).map(function (g) { return [g.lat, g.lon]; });
            if (latlngs.length > 1) {
              L.polyline(latlngs, { color: "#1a73e8", weight: 3, opacity: 0.85 }).addTo(map);
            }
          });
        });
      }
      window.setTimeout(function () { map.invalidateSize(); }, 200);
    }).catch(function () {
      el.innerHTML = "<p class='mode-fallback'>Map tiles could not load.</p>";
    });
  }

  function latLonToDir(lat, lon) {
    var phi = (90 - lat) * Math.PI / 180;
    var theta = (lon + 180) * Math.PI / 180;
    return { x: -Math.sin(phi) * Math.cos(theta), y: Math.cos(phi), z: Math.sin(phi) * Math.sin(theta) };
  }

  function resizeGlobe() {
    var mount = document.getElementById("globeMount");
    if (!mount || !globe.renderer || !globe.camera) return;
    var w = Math.max(120, mount.clientWidth);
    var h = Math.max(120, mount.clientHeight);
    globe.camera.aspect = w / h;
    globe.camera.updateProjectionMatrix();
    globe.renderer.setSize(w, h, false);
  }

  function flyGlobe(city) {
    if (!globe.spin || !city) return;
    var targetY = -(city.lon * Math.PI / 180);
    var targetX = (city.lat * Math.PI / 180) * 0.35;
    var startY = globe.spin.rotation.y;
    var startX = globe.tilt.rotation.x;
    var t0 = performance.now();
    function step(now) {
      var p = Math.min(1, (now - t0) / 1400);
      var e = 1 - Math.pow(1 - p, 3);
      globe.spin.rotation.y = startY + (targetY - startY) * e;
      globe.tilt.rotation.x = startX + (targetX - startX) * e;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function drawGlobe(mount, modes) {
    var cities = ((modes && modes.globe) || {}).cities || [];
    var focusId = ((modes && modes.globe) || {}).focus;
    three().then(function () {
      var THREE = window.THREE;
      if (!globe.ready) {
        mount.innerHTML = "";
        var scene = new THREE.Scene();
        var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
        camera.position.set(0, 0.08, 5.6);
        var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        mount.appendChild(renderer.domElement);
        scene.add(new THREE.AmbientLight(0xffffff, 0.5));
        var key = new THREE.DirectionalLight(0xffffff, 0.7);
        key.position.set(1.1, 0.8, 4);
        scene.add(key);
        var tilt = new THREE.Group();
        tilt.rotation.z = -16 * Math.PI / 180;
        scene.add(tilt);
        var spin = new THREE.Group();
        tilt.add(spin);
        var mat = new THREE.MeshPhongMaterial({ shininess: 8, specular: 0x2a5f8c, emissive: 0xffffff, emissiveIntensity: 0.22 });
        spin.add(new THREE.Mesh(new THREE.SphereGeometry(2, 40, 40), mat));
        var loader = new THREE.TextureLoader();
        loader.crossOrigin = "anonymous";
        loader.load(
          "https://cdn.jsdelivr.net/npm/three-globe@2.31.1/example/img/earth-blue-marble.jpg",
          function (tex) {
            mat.map = tex;
            mat.emissiveMap = tex;
            mat.needsUpdate = true;
          }
        );
        globe.scene = scene;
        globe.camera = camera;
        globe.renderer = renderer;
        globe.tilt = tilt;
        globe.spin = spin;
        globe.mat = mat;
        globe.ready = true;
        function tick() {
          globe.raf = requestAnimationFrame(tick);
          if (globe.spin) globe.spin.rotation.y += 0.0016;
          renderer.render(scene, camera);
        }
        tick();
        window.addEventListener("resize", resizeGlobe);
      }
      globe.markers.forEach(function (m) {
        if (m.parent) m.parent.remove(m);
      });
      globe.markers = [];
      cities.forEach(function (city) {
        var dir = latLonToDir(city.lat, city.lon);
        var dot = new window.THREE.Mesh(
          new window.THREE.SphereGeometry(0.045, 10, 10),
          new window.THREE.MeshBasicMaterial({ color: city.id === focusId ? 0xea4335 : 0xfbbc05 })
        );
        dot.position.set(dir.x * 2.04, dir.y * 2.04, dir.z * 2.04);
        globe.spin.add(dot);
        globe.markers.push(dot);
      });
      resizeGlobe();
      var focus = cities.filter(function (c) { return c.id === focusId; })[0] || cities[0];
      var i = 0;
      function cycle() {
        if (!document.getElementById("globeMount")) return;
        var city = cities[i % cities.length];
        flyGlobe(city);
        var label = document.getElementById("globeLabel");
        if (label) label.textContent = city.name + " · OneAquaHealth pilot";
        i += 1;
      }
      cycle();
      window.clearInterval(window.__aquaGlobeCycle);
      window.__aquaGlobeCycle = window.setInterval(cycle, 3200);
    }).catch(function () {
      mount.innerHTML = "<p class='mode-fallback'>Globe could not load.</p>";
    });
  }

  function catmull(points, n) {
    var out = [];
    if (!points.length) return out;
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1);
      var x = t * (points.length - 1);
      var i0 = Math.floor(x);
      var i1 = Math.min(points.length - 1, i0 + 1);
      var f = x - i0;
      out.push(points[i0] * (1 - f) + points[i1] * f);
    }
    return out;
  }

  function drawGraph(svg, spec) {
    var w = 640, h = 280, pad = { l: 36, r: 18, t: 28, b: 36 };
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.innerHTML = "";
    var labels = spec.labels || [];
    var series = spec.series || [];
    if (!labels.length || !series.length) {
      svg.innerHTML = "<text x='40' y='140' fill='#5f6368'>No comparable series in this answer.</text>";
      return;
    }
    var all = [];
    series.forEach(function (s) { (s.points || []).forEach(function (p) { all.push(p); }); });
    var min = Math.min.apply(null, all.concat([0]));
    var max = Math.max.apply(null, all.concat([1]));
    var span = max - min || 1;
    function x(i) { return pad.l + i * (w - pad.l - pad.r) / Math.max(1, labels.length - 1); }
    function y(v) { return h - pad.b - ((v - min) / span) * (h - pad.t - pad.b); }
    var ns = "http://www.w3.org/2000/svg";
    function el(name, attrs) {
      var node = document.createElementNS(ns, name);
      Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
      return node;
    }
    svg.appendChild(el("rect", { x: 0, y: 0, width: w, height: h, fill: "transparent" }));
    for (var g = 0; g < 4; g++) {
      var gy = pad.t + g * (h - pad.t - pad.b) / 3;
      svg.appendChild(el("line", { x1: pad.l, x2: w - pad.r, y1: gy, y2: gy, stroke: "rgba(95,99,104,.18)", "stroke-dasharray": "3 6" }));
    }
    series.forEach(function (s, si) {
      var pts = s.points || [];
      var dense = catmull(pts, 48);
      var d = "";
      dense.forEach(function (v, i) {
        var px = pad.l + i * (w - pad.l - pad.r) / Math.max(1, dense.length - 1);
        d += (i ? "L" : "M") + px + " " + y(v);
      });
      var area = d + " L" + (w - pad.r) + " " + (h - pad.b) + " L" + pad.l + " " + (h - pad.b) + " Z";
      svg.appendChild(el("path", { d: area, fill: s.color || "#12b5c4", "fill-opacity": si ? "0.16" : "0.22" }));
      svg.appendChild(el("path", { d: d, fill: "none", stroke: s.color || "#12b5c4", "stroke-width": "3.2", filter: "url(#glow)" }));
      pts.forEach(function (v, i) {
        svg.appendChild(el("circle", { cx: x(i), cy: y(v), r: 4.2, fill: s.color || "#12b5c4", stroke: "#fff", "stroke-width": "2" }));
      });
    });
    var defs = el("defs", {});
    defs.innerHTML = '<filter id="glow"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
    svg.insertBefore(defs, svg.firstChild);
    labels.forEach(function (lab, i) {
      var t = el("text", { x: x(i), y: h - 12, fill: "#5f6368", "font-size": "11", "text-anchor": "middle" });
      t.textContent = lab;
      svg.appendChild(t);
    });
    if (spec.highlight_value) {
      var hx = x(Math.max(0, labels.indexOf(spec.highlight_label)));
      var hv = spec.highlight_value + (spec.highlight_unit ? " " + spec.highlight_unit : "");
      var ht = el("text", { x: hx, y: 22, fill: "#202124", "font-size": "20", "font-weight": "600", "text-anchor": "middle" });
      ht.textContent = hv;
      svg.appendChild(ht);
    }
    svg.onmousemove = function (ev) {
      var box = svg.getBoundingClientRect();
      var t = (ev.clientX - box.left) / box.width;
      var idx = Math.round(t * (labels.length - 1));
      idx = Math.max(0, Math.min(labels.length - 1, idx));
      if (!graphTip) return;
      graphTip.textContent = labels[idx] + " · " + series.map(function (s) { return s.name + " " + s.points[idx]; }).join("  ·  ");
    };
  }

  function drawGallery(stage, frames) {
    window.clearInterval(galleryTimer);
    stage.innerHTML = "";
    if (!frames || !frames.length) {
      stage.innerHTML = "<p class='mode-fallback'>No gallery frames for this query.</p>";
      return;
    }
    frames.forEach(function (frame, i) {
      var card = document.createElement("article");
      card.className = "gal-card" + (i === 0 ? " is-front" : "");
      card.style.setProperty("--i", String(i));
      var img = frame.image || "h2o-assets/aquaask-bg-1.jpg";
      card.innerHTML =
        '<div class="gal-photo" style="background-image:url(\'' + img + '\')"></div>' +
        '<div class="gal-veil"></div>' +
        '<p class="gal-kicker"></p><p class="gal-metric"></p><h3 class="gal-title"></h3><p class="gal-cap"></p>';
      card.querySelector(".gal-kicker").textContent = frame.kicker || frame.kind || "";
      card.querySelector(".gal-metric").textContent = ((frame.metric || "") + (frame.unit ? " " + frame.unit : "")).trim();
      card.querySelector(".gal-title").textContent = frame.title || "";
      card.querySelector(".gal-cap").textContent = frame.caption || "";
      if (frame.wiki) {
        fetch(frame.wiki).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
          var src = data && data.thumbnail && data.thumbnail.source;
          if (src) card.querySelector(".gal-photo").style.backgroundImage = "url('" + src + "')";
        }).catch(function () {});
      }
      stage.appendChild(card);
    });
    var idx = 0;
    function show(n) {
      var cards = stage.querySelectorAll(".gal-card");
      cards.forEach(function (c, i) {
        c.classList.toggle("is-front", i === n);
        c.style.setProperty("--shift", String(i - n));
      });
      idx = n;
    }
    show(0);
    function next() { show((idx + 1) % frames.length); }
    galleryTimer = window.setInterval(next, 3400);
    stage.onmouseenter = function () { window.clearInterval(galleryTimer); };
    stage.onmouseleave = function () {
      window.clearInterval(galleryTimer);
      galleryTimer = window.setInterval(next, 3400);
    };
    stage.onclick = function () { next(); };
  }

  window.renderAquaModes = function (root, modes) {
    if (!root) return;
    modes = modes || {};
    setTab(root, modes.default_tab || "answer");
    root.querySelectorAll(".mode-tab").forEach(function (btn) {
      btn.onclick = function () { setTab(root, btn.getAttribute("data-tab")); };
    });
    var map2d = root.querySelector("#map2d");
    var globeMount = root.querySelector("#globeMount");
    var graphSvg = root.querySelector("#graphSvg");
    var gal = root.querySelector("#galleryStage");
    graphTip = root.querySelector("#graphTip");
    var sub2d = root.querySelector('[data-mapview="2d"]');
    var sub3d = root.querySelector('[data-mapview="globe"]');
    function mapView(which) {
      root.classList.toggle("map-globe", which === "globe");
      if (sub2d) sub2d.classList.toggle("is-on", which === "2d");
      if (sub3d) sub3d.classList.toggle("is-on", which === "globe");
      if (which === "globe") drawGlobe(globeMount, modes);
      else drawMap(map2d, modes);
    }
    if (sub2d) sub2d.onclick = function () { mapView("2d"); };
    if (sub3d) sub3d.onclick = function () { mapView("globe"); };
    if (graphSvg) drawGraph(graphSvg, modes.graph || {});
    if (gal) drawGallery(gal, modes.gallery || []);
    if ((modes.default_tab || "answer") === "maps") mapView(modes.map_view || "2d");
    else {
      mapView(modes.map_view || "2d");
    }
  };
})();
