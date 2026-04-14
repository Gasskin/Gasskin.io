(function () {
  "use strict";

  var mapEl = document.getElementById("map");
  var panel = document.getElementById("panel");
  var panelTitle = document.getElementById("panel-title");
  var memberList = document.getElementById("member-list");
  var closePanel = document.getElementById("close-panel");
  var toast = document.getElementById("toast");

  var SQRT3 = Math.sqrt(3);
  var selectedKingdom = -1;

  function hsl(c) {
    if (!c) return "#6b7a8c";
    if (typeof c.hex === "string" && c.hex[0] === "#") return c.hex;
    var h = Number(c.h);
    var s = Number(c.s);
    var l = Number(c.l);
    return (
      "hsl(" +
      (isFinite(h) ? h.toFixed(2) : "210") +
      "," +
      (isFinite(s) ? s.toFixed(1) : "45") +
      "%," +
      (isFinite(l) ? l.toFixed(1) : "38") +
      "%)"
    );
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      toast.hidden = true;
    }, 3200);
  }

  function fitFontSize(name, approxW, approxH) {
    var base = Math.sqrt(Math.max(approxW * approxH, 1)) * 0.11;
    base = Math.max(10, Math.min(22, base));
    if (name.length > 6) base *= 0.9;
    if (name.length > 10) base *= 0.88;
    return Math.round(base);
  }

  function axialToPixel(q, r, R, ox, oy) {
    return {
      x: R * SQRT3 * (q + r * 0.5) + ox,
      y: R * 1.5 * r + oy,
    };
  }

  function hexPathD(cx, cy, R) {
    var parts = [];
    for (var i = 0; i < 6; i++) {
      var ang = -Math.PI / 2 + i * (Math.PI / 3);
      var px = cx + R * Math.cos(ang);
      var py = cy + R * Math.sin(ang);
      parts.push((i === 0 ? "M" : "L") + px.toFixed(2) + " " + py.toFixed(2));
    }
    parts.push("Z");
    return parts.join("");
  }

  function buildDefs(ns, w, h) {
    var defs = document.createElementNS(ns, "defs");
    var og = document.createElementNS(ns, "linearGradient");
    og.setAttribute("id", "oceanGrad");
    og.setAttribute("x1", "0%");
    og.setAttribute("y1", "0%");
    og.setAttribute("x2", "100%");
    og.setAttribute("y2", "100%");
    var s1 = document.createElementNS(ns, "stop");
    s1.setAttribute("offset", "0%");
    s1.setAttribute("stop-color", "#0e2436");
    var s2 = document.createElementNS(ns, "stop");
    s2.setAttribute("offset", "50%");
    s2.setAttribute("stop-color", "#152a3d");
    var s3 = document.createElementNS(ns, "stop");
    s3.setAttribute("offset", "100%");
    s3.setAttribute("stop-color", "#0a1824");
    og.appendChild(s1);
    og.appendChild(s2);
    og.appendChild(s3);
    defs.appendChild(og);
    return defs;
  }

  function setKingdomSelection(k, on) {
    var sel = mapEl.querySelectorAll('.hex-cell[data-k="' + k + '"]');
    for (var i = 0; i < sel.length; i++) {
      if (on) sel[i].classList.add("selected");
      else sel[i].classList.remove("selected");
    }
  }

  function renderHexMap(data) {
    var vb = data.mapSize || { w: 1000, h: 620 };
    var w = vb.w;
    var h = vb.h;
    mapEl.setAttribute("viewBox", "0 0 " + w + " " + h);

    while (mapEl.firstChild) mapEl.removeChild(mapEl.firstChild);

    var ns = "http://www.w3.org/2000/svg";
    var hex = data.hex || {};
    var R = Number(hex.R) || 8;
    var ox = (hex.origin && Number(hex.origin[0])) || 0;
    var oy = (hex.origin && Number(hex.origin[1])) || 0;
    var cells = data.hexCells || [];
    var kdoms = data.kingdoms || [];

    mapEl.appendChild(buildDefs(ns, w, h));

    var ocean = document.createElementNS(ns, "rect");
    ocean.setAttribute("class", "ocean-layer");
    ocean.setAttribute("x", "0");
    ocean.setAttribute("y", "0");
    ocean.setAttribute("width", String(w));
    ocean.setAttribute("height", String(h));
    mapEl.appendChild(ocean);

    var layer = document.createElementNS(ns, "g");
    layer.setAttribute("class", "hex-layer");

    function activate(idx) {
      var k = kdoms[idx];
      if (!k) return;
      if (selectedKingdom >= 0) setKingdomSelection(selectedKingdom, false);
      selectedKingdom = idx;
      setKingdomSelection(idx, true);
      panelTitle.textContent = k.name;
      memberList.innerHTML = "";
      if (!k.members || k.members.length === 0) {
        var li0 = document.createElement("li");
        li0.textContent = "（暂无成员）";
        memberList.appendChild(li0);
      } else {
        k.members.forEach(function (m) {
          var li = document.createElement("li");
          li.textContent = m;
          memberList.appendChild(li);
        });
      }
      panel.hidden = false;
    }

    for (var i = 0; i < cells.length; i++) {
      var row = cells[i];
      var q = row[0];
      var r = row[1];
      var ki = row[2];
      var p = axialToPixel(q, r, R, ox, oy);
      var path = document.createElementNS(ns, "path");
      path.setAttribute("d", hexPathD(p.x, p.y, R));
      path.setAttribute("fill", hsl(kdoms[ki] && kdoms[ki].color));
      path.setAttribute("fill-opacity", "0.88");
      path.setAttribute("class", "hex-cell");
      path.setAttribute("data-k", String(ki));
      path.setAttribute("vector-effect", "non-scaling-stroke");
      path.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var kk = parseInt(ev.currentTarget.getAttribute("data-k"), 10);
        if (!isNaN(kk)) activate(kk);
      });
      layer.appendChild(path);
    }

    mapEl.appendChild(layer);

    var labelGroup = document.createElementNS(ns, "g");
    labelGroup.setAttribute("class", "labels-root");
    kdoms.forEach(function (k, idx) {
      var lab = k.label || [w * 0.5, h * 0.5];
      var t = document.createElementNS(ns, "text");
      t.setAttribute("x", lab[0]);
      t.setAttribute("y", lab[1]);
      t.setAttribute("class", "tile-label");
      var hc = k.hexCount || 1;
      var approx = 2 * R * Math.sqrt(hc);
      t.setAttribute("font-size", String(fitFontSize(k.name, approx, approx * 0.75)));
      t.textContent = k.name;
      labelGroup.appendChild(t);
    });
    mapEl.appendChild(labelGroup);
  }

  function render(data) {
    if (data.mapVersion === 2 && data.hexCells && data.hex) {
      selectedKingdom = -1;
      renderHexMap(data);
      return;
    }
    showToast("数据格式已更新，请运行 python build.py 重新生成 data.json");
  }

  closePanel.addEventListener("click", function () {
    panel.hidden = true;
    if (selectedKingdom >= 0) {
      setKingdomSelection(selectedKingdom, false);
      selectedKingdom = -1;
    }
  });

  document.addEventListener("click", function (e) {
    if (!panel.hidden && !panel.contains(e.target) && !mapEl.contains(e.target)) {
      closePanel.click();
    }
  });

  fetch("data.json")
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(render)
    .catch(function () {
      showToast("无法加载 data.json，请先运行 python build.py 并用本地服务器打开");
    });
})();
