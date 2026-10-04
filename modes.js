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

  function overpassCities(cities, radiusM) {
    var parts = (cities || []).map(function (c) {
      return 'way["waterway"~"river|stream|canal"](around:' + Math.round(radiusM) + "," + c.lat + "," + c.lon + ");";
    }).join("");
    if (!parts) return Promise.resolve({ elements: [] });
    var q = "[out:json][timeout:12];(" + parts + ");out geom;";
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
      var map = L.map(el, { zoomControl: true, attributionControl: true }).setView([center.lat, center.lon], 13);
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        attribution: "Esri World Imagery"
      }).addTo(map);
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        opacity: 0.9
      }).addTo(map);
      window.__aquaMap = map;
      var geoLayer = L.layerGroup().addTo(map);
      var bounds = [];
      cities.forEach(function (city) {
        var r = (city.radius_km || spec.radius_km || 5) * 1000;
        bounds.push([city.lat, city.lon]);
        L.circle([city.lat, city.lon], {
          radius: r,
          color: "#7ec8f0",
          weight: 2,
          fillColor: "#0ba6ff",
          fillOpacity: 0.12
        }).addTo(geoLayer);
        L.circleMarker([city.lat, city.lon], {
          radius: 8,
          color: "#fff",
          weight: 2,
          fillColor: "#0ba6ff",
          fillOpacity: 1
        }).addTo(geoLayer).bindPopup("<strong>" + city.name + "</strong><br>" + (city.stream || "") + "<br>" + (city.radius_km || spec.radius_km) + " km radius");
      });
      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 13 });
      }
      overpassCities(cities.length ? cities : [{ lat: center.lat, lon: center.lon }], (spec.radius_km || 5) * 1000).then(function (data) {
        (data.elements || []).forEach(function (way) {
          var latlngs = (way.geometry || []).map(function (g) { return [g.lat, g.lon]; });
          if (latlngs.length > 1) {
            L.polyline(latlngs, { color: "#7ec8f0", weight: 3.2, opacity: 0.95 }).addTo(geoLayer);
          }
        });
      });
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

  function drawGlobe(mount, modes) {
    var cities = ((modes && modes.globe) || {}).cities || [];
    var focusId = ((modes && modes.globe) || {}).focus;
    three().then(function () {
      var THREE = window.THREE;
      if (globe.ready && globe.scene && globe.scene.background) {
        if (globe.raf) cancelAnimationFrame(globe.raf);
        if (globe.renderer && globe.renderer.domElement && globe.renderer.domElement.parentNode) {
          globe.renderer.domElement.parentNode.removeChild(globe.renderer.domElement);
        }
        globe.ready = false;
      }
      if (!globe.ready) {
        mount.innerHTML = "";
        var scene = new THREE.Scene();
        scene.background = null;
        var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
        camera.position.set(0, 0.1, 5.85);
        var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setClearColor(0x000000, 0);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        renderer.domElement.style.display = "block";
        mount.appendChild(renderer.domElement);
        scene.add(new THREE.AmbientLight(0xffffff, 0.45));
        var key = new THREE.DirectionalLight(0xffffff, 0.75);
        key.position.set(1.2, 0.9, 4.0);
        scene.add(key);
        var rim = new THREE.DirectionalLight(0xbfe9ff, 0.38);
        rim.position.set(-3.2, -2.0, 1.2);
        scene.add(rim);
        scene.add(new THREE.HemisphereLight(0xdff4ff, 0x2f8fd6, 0.22));
        var tilt = new THREE.Group();
        tilt.rotation.z = -16 * Math.PI / 180;
        tilt.rotation.x = 5 * Math.PI / 180;
        scene.add(tilt);
        var spin = new THREE.Group();
        spin.rotation.y = 2.45;
        tilt.add(spin);
        var mat = new THREE.MeshPhongMaterial({ shininess: 10, specular: 0x2a5f8c, emissive: 0xffffff, emissiveIntensity: 0.28 });
        spin.add(new THREE.Mesh(new THREE.SphereGeometry(2, 48, 48), mat));
        var fres = new THREE.ShaderMaterial({
          uniforms: { c: { value: 0.17 }, p: { value: 4.2 }, glow: { value: new THREE.Color(0xa8e4ff) } },
          vertexShader: "varying vec3 vN; varying vec3 vP; void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vP=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }",
          fragmentShader: "uniform float c; uniform float p; uniform vec3 glow; varying vec3 vN; varying vec3 vP; void main(){ float i=pow(c-dot(vN,vP),p); gl_FragColor=vec4(glow,1.0)*clamp(i,0.0,1.0); }",
          side: THREE.BackSide,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false
        });
        spin.add(new THREE.Mesh(new THREE.SphereGeometry(2.28, 32, 32), fres));
        var loader = new THREE.TextureLoader();
        loader.crossOrigin = "anonymous";
        loader.load(
          "https://cdn.jsdelivr.net/npm/three-globe@2.31.1/example/img/earth-blue-marble.jpg",
          function (tex) {
            mat.map = tex;
            mat.emissiveMap = tex;
            mat.emissiveIntensity = 0.30;
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
          if (globe.spin) globe.spin.rotation.y += 0.0044;
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
          new window.THREE.SphereGeometry(0.05, 10, 10),
          new window.THREE.MeshBasicMaterial({ color: city.id === focusId ? 0xea4335 : 0xfbbc05 })
        );
        dot.position.set(dir.x * 2.04, dir.y * 2.04, dir.z * 2.04);
        globe.spin.add(dot);
        globe.markers.push(dot);
      });
      resizeGlobe();
      var label = document.getElementById("globeLabel");
      if (label) {
        var names = cities.map(function (c) { return c.name; }).join(" · ");
        label.textContent = names || "OneAquaHealth pilots";
      }
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
      card.className = "gal-card";
      var img = frame.image || "";
      card.innerHTML =
        '<img class="gal-photo" alt="" referrerpolicy="no-referrer">' +
        '<div class="gal-veil"></div>' +
        '<p class="gal-kicker"></p><h3 class="gal-title"></h3><p class="gal-cap"></p>';
      var photo = card.querySelector(".gal-photo");
      if (img && /^https?:/i.test(img)) photo.src = img;
      card.querySelector(".gal-kicker").textContent = frame.kicker || frame.kind || "";
      card.querySelector(".gal-title").textContent = frame.title || "";
      card.querySelector(".gal-cap").textContent = frame.caption || "";
      if (!photo.src && frame.wiki_title) {
        fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(frame.wiki_title)).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
          var src = data && ((data.originalimage && data.originalimage.source) || (data.thumbnail && data.thumbnail.source));
          if (src) photo.src = src;
        }).catch(function () {});
      }
      stage.appendChild(card);
    });
    var idx = 0;
    function show(n) {
      var cards = stage.querySelectorAll(".gal-card");
      var total = cards.length;
      cards.forEach(function (c, i) {
        c.classList.remove("is-front", "is-next", "is-prev");
        if (i === n) {
          c.classList.add("is-front");
          c.style.order = "0";
        } else if (i === (n + 1) % total) {
          c.classList.add("is-next");
          c.style.order = "1";
        } else if (i === (n - 1 + total) % total) {
          c.classList.add("is-prev");
          c.style.order = "2";
        }
      });
      idx = n;
    }
    show(0);
    function next() { show((idx + 1) % frames.length); }
    galleryTimer = window.setInterval(next, 3800);
    stage.onmouseenter = function () { window.clearInterval(galleryTimer); };
    stage.onmouseleave = function () {
      window.clearInterval(galleryTimer);
      galleryTimer = window.setInterval(next, 3800);
    };
    stage.onclick = function () { next(); };
  }

  window.renderAquaModes = function (root, modes) {
    if (!root) return;
    modes = modes || {};
    var startTab = modes.default_tab || "answer";
    setTab(root, startTab);
    document.body.classList.toggle("is-maps-tab", startTab === "maps");
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
      window.setTimeout(function () {
        if (window.__aquaMap) window.__aquaMap.invalidateSize();
        resizeGlobe();
      }, 120);
    }
    if (sub2d) sub2d.onclick = function () { mapView("2d"); };
    if (sub3d) sub3d.onclick = function () { mapView("globe"); };
    var fullBtn = root.querySelector("[data-mapfull]");
    function afterMapResize() {
      window.setTimeout(function () {
        if (window.__aquaMap) window.__aquaMap.invalidateSize();
        resizeGlobe();
      }, 80);
    }
    if (fullBtn) {
      fullBtn.onclick = function () {
        document.body.classList.toggle("map-fs");
        fullBtn.textContent = document.body.classList.contains("map-fs") ? "Exit" : "Full";
        afterMapResize();
      };
    }
    document.onkeydown = function (ev) {
      if (ev.key === "Escape" && document.body.classList.contains("map-fs")) {
        document.body.classList.remove("map-fs");
        if (fullBtn) fullBtn.textContent = "Full";
        afterMapResize();
      }
    };
    root.querySelectorAll(".mode-tab").forEach(function (btn) {
      btn.onclick = function () {
        var tab = btn.getAttribute("data-tab");
        setTab(root, tab);
        document.body.classList.toggle("is-maps-tab", tab === "maps");
        if (tab !== "maps") {
          document.body.classList.remove("map-fs");
          if (fullBtn) fullBtn.textContent = "Full";
        }
        window.setTimeout(function () {
          if (window.__aquaMap) window.__aquaMap.invalidateSize();
          resizeGlobe();
        }, 80);
      };
    });
    if (graphSvg) drawGraph(graphSvg, modes.graph || {});
    if (gal) drawGallery(gal, modes.gallery || []);
    mapView(modes.map_view || "2d");
  };
})();
