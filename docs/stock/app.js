"use strict";

const HIGH_LOOKBACK = 20; // 前 20 个交易日最高价（不含最新交易日）
const LOW_LOOKBACK = 10; // 前 10 个交易日最低价（不含最新交易日）
const SHORT_LOW_LOOKBACK = 5; // 前 5 个交易日最低价（不含最新交易日）
const STOP_LOSS_HIGH_LOOKBACK = 14; // 止损价使用最近 14 个交易日最高价
const STOP_LOSS_ATR_MULTIPLIER = 2;
const SVG_NS = "http://www.w3.org/2000/svg";

const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const btnReload = document.getElementById("btnReload");
const updatedBar = document.getElementById("updatedBar");
const stockNav = document.getElementById("stockNav");

function cardId(code) {
  return `card-${String(code).replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function setStatus(text) {
  statusEl.textContent = text || "";
}

async function fetchJSON(url) {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
  return resp.json();
}

function fmtPrice(value) {
  if (value == null || Number.isNaN(value)) return "N/A";
  const text = Number(value).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return text || "0";
}

function fmtPct(value) {
  if (value == null || Number.isNaN(value)) return "N/A";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

// 根据最新交易日收盘价与历史高低点关系，决定颜色与状态文案。
function evaluateLevel(bars) {
  if (!bars || bars.length < 2) {
    return { color: "gray", state: "数据不足", high20: null, low10: null, low5: null };
  }
  const latestClose = bars[bars.length - 1].close;
  const prior = bars.slice(0, -1); // 去掉最新交易日
  const past20 = prior.slice(-HIGH_LOOKBACK);
  const past10 = prior.slice(-LOW_LOOKBACK);
  const past5 = prior.slice(-SHORT_LOW_LOOKBACK);

  let highBar = past20[0];
  for (const b of past20) if (b.high > highBar.high) highBar = b;
  let lowBar = past10[0];
  for (const b of past10) if (b.low < lowBar.low) lowBar = b;
  let shortLowBar = past5[0];
  for (const b of past5) if (b.low < shortLowBar.low) shortLowBar = b;

  const high20 = highBar.high;
  const high20Date = highBar.date;
  const low10 = lowBar.low;
  const low10Date = lowBar.date;
  const low5 = shortLowBar.low;
  const low5Date = shortLowBar.date;

  let color = "gray";
  let state = "区间内";
  if (latestClose >= high20) {
    color = "red";
    state = `区间最高 ${high20Date} ${fmtPrice(high20)}`;
  } else if (latestClose <= low10) {
    color = "green";
    state = `区间最低 ${low10Date} ${fmtPrice(low10)}`;
  }
  return { color, state, high20, high20Date, low10, low10Date, low5, low5Date, latestClose };
}

function el(tag, attrs, children) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  }
  if (children) {
    for (const c of children) node.appendChild(c);
  }
  return node;
}

function buildChart(bars, level, onSelect, buyPrice) {
  const W = 960;
  const padL = 56;
  const padR = 56;
  const padT = 18;
  // 主图（价格）、55 日均线变化、ADX、ATR 四块绘图区。
  const priceH = 224;
  const gap = 30; // 主副图之间留白（副图标题占用）
  const subH = 64;
  const adxGap = 28;
  const adxH = 52;
  const atrGap = 28;
  const atrH = 52;
  const padB = 34; // 底部日期标签
  const priceTop = padT;
  const priceBottom = priceTop + priceH;
  const subTop = priceBottom + gap;
  const subBottom = subTop + subH;
  const adxTop = subBottom + adxGap;
  const adxBottom = adxTop + adxH;
  const atrTop = adxBottom + atrGap;
  const atrBottom = atrTop + atrH;
  const H = atrBottom + padB;
  const plotW = W - padL - padR;

  const n = bars.length;
  const lastIdx = n - 1;

  // 主图纵轴范围：日 K 高/低价 + 参考线，留 5% 余量。
  const candidates = [];
  bars.forEach((b, i) => {
    if (i === lastIdx) {
      candidates.push(b.close); // 最新交易日只参与收盘价
    } else {
      candidates.push(b.high, b.low);
    }
  });
  const ma55Values = bars.map((b) => {
    const value = b.ma55 == null ? null : Number(b.ma55);
    return value == null || Number.isNaN(value) ? null : value;
  });
  ma55Values.forEach((value) => {
    if (value != null) candidates.push(value);
  });
  const atr14Values = bars.map((b) => {
    const value = b.atr14 == null ? null : Number(b.atr14);
    return value == null || Number.isNaN(value) ? null : value;
  });
  if (level.high20 != null) candidates.push(level.high20);
  if (level.low10 != null) candidates.push(level.low10);
  const hasBuy = buyPrice != null && !Number.isNaN(Number(buyPrice));
  if (hasBuy) candidates.push(Number(buyPrice));
  const latestAtr14 = atr14Values[lastIdx];
  const stopLossHigh = bars.slice(-STOP_LOSS_HIGH_LOOKBACK).reduce(
    (high, bar) => Math.max(high, Number(bar.high)),
    Number.NEGATIVE_INFINITY,
  );
  const stopLossPrice = hasBuy && latestAtr14 != null
    && Number.isFinite(stopLossHigh)
    ? stopLossHigh - STOP_LOSS_ATR_MULTIPLIER * latestAtr14
    : null;
  if (stopLossPrice != null) candidates.push(stopLossPrice);
  let min = Math.min(...candidates);
  let max = Math.max(...candidates);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const margin = (max - min) * 0.05;
  min -= margin;
  max += margin;

  const slot = n <= 0 ? plotW : plotW / n;
  const x = (i) => padL + slot * (i + 0.5);
  const y = (v) => priceTop + (1 - (v - min) / (max - min)) * priceH;
  const barW = Math.max(3, Math.min(16, slot * 0.6));

  const svg = el("svg", {
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: "xMidYMid meet",
    class: "chart",
    role: "img",
  });

  let selected = null;
  function select(node, bar) {
    if (selected) selected.classList.remove("selected");
    selected = node;
    if (selected) selected.classList.add("selected");
    if (typeof onSelect === "function") onSelect(bar);
  }

  // 主图水平网格线 + Y 轴刻度
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const v = min + ((max - min) * t) / ticks;
    const yy = y(v);
    svg.appendChild(el("line", {
      x1: padL, y1: yy, x2: W - padR, y2: yy, class: "gridline",
    }));
    const label = el("text", { x: padL - 6, y: yy + 3, class: "axis-label y" });
    label.textContent = fmtPrice(v);
    svg.appendChild(label);
  }

  // X 轴日期标签（首、中、尾），放在所有副图下方。
  const xIdx = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  for (const i of xIdx) {
    const label = el("text", { x: x(i), y: atrBottom + 16, class: "axis-label x" });
    label.textContent = (bars[i].date || "").slice(5); // MM-DD
    svg.appendChild(label);
  }

  // 最新收盘价：水平虚线（颜色随状态），不标注价格文字。
  const latestClose = bars[lastIdx].close;
  const refY = y(latestClose);
  svg.appendChild(el("line", {
    x1: padL, y1: refY, x2: W - padR, y2: refY, class: `ref-line ${level.color}`,
  }));

  // 持仓买入价：橙色水平虚线，价格标在主图右侧。
  if (hasBuy) {
    const by = y(Number(buyPrice));
    svg.appendChild(el("line", {
      x1: padL, y1: by, x2: W - padR, y2: by, class: "buy-line",
    }));
    const buyLabel = el("text", {
      x: W - padR + 6, y: by + 3, class: "buy-label", "text-anchor": "start",
    });
    buyLabel.textContent = fmtPrice(buyPrice);
    svg.appendChild(buyLabel);
  }

  // ATR 止损价：最近 N 日最高价 - M * 最新 ATR14。
  if (stopLossPrice != null) {
    const sy = y(stopLossPrice);
    const stopLine = el("line", {
      x1: padL, y1: sy, x2: W - padR, y2: sy, class: "stop-line",
    });
    const title = el("title");
    title.textContent = `止损价 ${fmtPrice(stopLossPrice)} = ${STOP_LOSS_HIGH_LOOKBACK}日最高价 - ${STOP_LOSS_ATR_MULTIPLIER} × ATR14`;
    stopLine.appendChild(title);
    svg.appendChild(stopLine);
    const stopLabel = el("text", {
      x: W - padR + 6, y: sy + 3, class: "stop-label", "text-anchor": "start",
    });
    stopLabel.textContent = fmtPrice(stopLossPrice);
    svg.appendChild(stopLabel);
  }

  // 实心日 K：实体 = 开盘-收盘，影线 = 最高-最低；红涨绿跌（按收盘与开盘比较）。
  bars.forEach((b, i) => {
    const cx = x(i);

    if (i === lastIdx) {
      // 最新交易日只显示收盘价：一个圆点（颜色随状态），不标注价格。
      const dot = el("circle", {
        cx, cy: y(b.close), r: 4.5, class: `dot dot-last clickable ${level.color}`,
      });
      const title = el("title");
      title.textContent = `${b.date}（最新）  收 ${fmtPrice(b.close)}`;
      dot.appendChild(title);
      dot.addEventListener("click", () => select(dot, b));
      svg.appendChild(dot);
      return;
    }

    const dir = b.close >= b.open ? "up" : "down"; // 红涨绿跌
    const g = el("g", { class: `candle clickable ${dir}` });

    // 上下影线
    g.appendChild(el("line", {
      x1: cx, y1: y(b.high), x2: cx, y2: y(b.low), class: "wick",
    }));

    // 实体
    const top = y(Math.max(b.open, b.close));
    const bottom = y(Math.min(b.open, b.close));
    const h = Math.max(1, bottom - top);
    g.appendChild(el("rect", {
      x: cx - barW / 2, y: top, width: barW, height: h, class: "body",
    }));

    // 透明点击热区，方便点中较窄的 K 线
    g.appendChild(el("rect", {
      x: cx - slot / 2, y: priceTop, width: slot, height: priceH, class: "hit",
    }));

    const title = el("title");
    title.textContent = `${b.date}  开 ${fmtPrice(b.open)} / 高 ${fmtPrice(b.high)} / 低 ${fmtPrice(b.low)} / 收 ${fmtPrice(b.close)}`;
    g.appendChild(title);
    g.addEventListener("click", () => select(g, b));
    svg.appendChild(g);
  });

  // 55 日均线：叠加在主图价格区间内，缺失数据时断开。
  let ma55Path = "";
  let drawingMa55 = false;
  for (let i = 0; i < ma55Values.length; i++) {
    const value = ma55Values[i];
    if (value == null) {
      drawingMa55 = false;
      continue;
    }
    const cmd = drawingMa55 ? "L" : "M";
    ma55Path += `${ma55Path ? " " : ""}${cmd} ${x(i)} ${y(value)}`;
    drawingMa55 = true;
  }
  if (ma55Path && ma55Path.includes("L")) {
    const line = el("path", { d: ma55Path, class: "ma-line ma55-line" });
    const title = el("title");
    title.textContent = "55日均线";
    line.appendChild(title);
    svg.appendChild(line);
  }

  // 前 20 日最高 / 前 10 日最低 / 前 5 日最低：仅用一个数据点标识（不显示文字）。
  function markPoint(value, dateStr, cls, prefix) {
    if (value == null) return;
    const idx = bars.findIndex((b) => b.date === dateStr);
    const cx = idx >= 0 ? x(idx) : padL;
    const dot = el("circle", { cx, cy: y(value), r: 4, class: `mark-dot ${cls}` });
    const title = el("title");
    title.textContent = `${prefix} ${dateStr} ${fmtPrice(value)}`;
    dot.appendChild(title);
    svg.appendChild(dot);
  }
  markPoint(level.high20, level.high20Date, "red", "区间最高");
  markPoint(level.low10, level.low10Date, "green", "区间最低");
  markPoint(level.low5, level.low5Date, "gray", "5日最低");

  // ── 副图：55 日均线较前一日的变化（红增绿减，含负坐标） ──
  buildSubChart(svg, bars, { x, slot, barW, subTop, subBottom, padL, padR, W }, select);

  // ── 副图：DMI(14,6) ADX 曲线，按展示周期内高低值缩放 ──
  buildAdxChart(svg, bars, { x, slot, adxTop, adxBottom, padL, padR, W }, select);

  // ── 副图：ATR14 曲线，按展示周期内高低值缩放 ──
  buildAtrChart(svg, bars, { x, slot, atrTop, atrBottom, padL, padR, W }, select);

  return svg;
}

// 副图：柱状图，柱高 = 当日 55 日均线 - 前一日 55 日均线。红增、绿减，零线居中、向下为负。
function buildSubChart(svg, bars, geo, select) {
  const { x, slot, barW, subTop, subBottom, padL, padR, W } = geo;
  const zeroY = (subTop + subBottom) / 2;
  const halfH = (subBottom - subTop) / 2;

  const deltas = bars.map((b) => (b.ma55_delta == null ? null : Number(b.ma55_delta)));
  const maxAbs = Math.max(0, ...deltas.filter((d) => d != null).map((d) => Math.abs(d)));
  const scale = maxAbs > 0 ? maxAbs : 1;
  const ySub = (v) => zeroY - (v / scale) * halfH;

  // 副图标题
  const subTitle = el("text", { x: padL, y: subTop - 8, class: "sub-title" });
  subTitle.textContent = "Δ55日均线（较前一日 · 红增绿减）";
  svg.appendChild(subTitle);

  // 上下边界刻度 + 零线
  const topLabel = el("text", { x: padL - 6, y: subTop + 3, class: "axis-label y" });
  topLabel.textContent = `+${fmtPrice(maxAbs)}`;
  svg.appendChild(topLabel);
  const botLabel = el("text", { x: padL - 6, y: subBottom + 3, class: "axis-label y" });
  botLabel.textContent = `-${fmtPrice(maxAbs)}`;
  svg.appendChild(botLabel);
  svg.appendChild(el("line", {
    x1: padL, y1: zeroY, x2: W - padR, y2: zeroY, class: "sub-zero",
  }));

  bars.forEach((b, i) => {
    const d = deltas[i];
    if (d == null) return;
    const cx = x(i);
    const yv = ySub(d);
    const up = d >= 0;
    const top = up ? yv : zeroY;
    const h = Math.max(1, Math.abs(yv - zeroY));
    const rect = el("rect", {
      x: cx - barW / 2, y: top, width: barW, height: h,
      class: `delta-bar clickable ${up ? "up" : "down"}`,
    });
    const title = el("title");
    title.textContent = `${b.date}  Δ55日均线 ${d >= 0 ? "+" : ""}${fmtPrice(d)}`;
    rect.appendChild(title);
    rect.addEventListener("click", () => select(rect, b));
    svg.appendChild(rect);
  });
}

// 副图：DMI(14,6) ADX 曲线，纵轴使用当前展示周期内的最低/最高 ADX。
function buildAdxChart(svg, bars, geo, select) {
  const { x, slot, adxTop, adxBottom, padL, padR, W } = geo;
  const adxValues = bars.map((b) => {
    const value = b.adx14_6 == null ? null : Number(b.adx14_6);
    return value == null || Number.isNaN(value) ? null : value;
  });
  const validAdxValues = adxValues.filter((value) => value != null);
  const adxMin = validAdxValues.length ? Math.min(...validAdxValues) : 0;
  const adxMax = validAdxValues.length ? Math.max(...validAdxValues) : 100;
  const adxRange = adxMax - adxMin;
  const yAdx = (value) => {
    if (adxRange === 0) return (adxTop + adxBottom) / 2;
    const clamped = Math.max(adxMin, Math.min(adxMax, value));
    return adxBottom - ((clamped - adxMin) / adxRange) * (adxBottom - adxTop);
  };

  const subTitle = el("text", { x: padL, y: adxTop - 8, class: "sub-title" });
  subTitle.textContent = "ADX(14,6)";
  svg.appendChild(subTitle);

  const ticks = adxRange === 0 ? [adxMax] : [adxMax, (adxMax + adxMin) / 2, adxMin];
  for (const tick of ticks) {
    const yy = yAdx(tick);
    svg.appendChild(el("line", {
      x1: padL, y1: yy, x2: W - padR, y2: yy, class: tick === adxMin ? "sub-zero" : "adx-grid",
    }));
    const label = el("text", { x: padL - 6, y: yy + 3, class: "axis-label y" });
    label.textContent = fmtPrice(tick);
    svg.appendChild(label);
  }

  if (adxMin <= 25 && adxMax >= 25) {
    const yy = yAdx(25);
    const line = el("line", {
      x1: padL, y1: yy, x2: W - padR, y2: yy, class: "adx-threshold",
    });
    const title = el("title");
    title.textContent = "ADX 25";
    line.appendChild(title);
    svg.appendChild(line);
  }

  let path = "";
  let drawing = false;
  for (let i = 0; i < adxValues.length; i++) {
    const value = adxValues[i];
    if (value == null) {
      drawing = false;
      continue;
    }
    const cmd = drawing ? "L" : "M";
    path += `${path ? " " : ""}${cmd} ${x(i)} ${yAdx(value)}`;
    drawing = true;
  }

  if (path && path.includes("L")) {
    const line = el("path", { d: path, class: "adx-line" });
    const title = el("title");
    title.textContent = "ADX(14,6)";
    line.appendChild(title);
    svg.appendChild(line);
  }

  adxValues.forEach((value, i) => {
    if (value == null) return;
    const dot = el("circle", {
      cx: x(i), cy: yAdx(value), r: 3, class: "adx-dot clickable",
    });
    const title = el("title");
    title.textContent = `${bars[i].date}  ADX(14,6) ${fmtPrice(value)}`;
    dot.appendChild(title);
    dot.addEventListener("click", () => select(dot, bars[i]));
    svg.appendChild(dot);

    const hit = el("rect", {
      x: x(i) - slot / 2, y: adxTop, width: slot, height: adxBottom - adxTop,
      class: "adx-hit clickable",
    });
    hit.addEventListener("click", () => select(dot, bars[i]));
    svg.appendChild(hit);
  });
}

// 副图：ATR14 曲线，纵轴使用当前展示周期内的最低/最高 ATR。
function buildAtrChart(svg, bars, geo, select) {
  const { x, slot, atrTop, atrBottom, padL, padR, W } = geo;
  const atrValues = bars.map((b) => {
    const value = b.atr14 == null ? null : Number(b.atr14);
    return value == null || Number.isNaN(value) ? null : value;
  });
  const validAtrValues = atrValues.filter((value) => value != null);
  const atrMin = validAtrValues.length ? Math.min(...validAtrValues) : 0;
  const atrMax = validAtrValues.length ? Math.max(...validAtrValues) : 1;
  const atrRange = atrMax - atrMin;
  const yAtr = (value) => {
    if (atrRange === 0) return (atrTop + atrBottom) / 2;
    const clamped = Math.max(atrMin, Math.min(atrMax, value));
    return atrBottom - ((clamped - atrMin) / atrRange) * (atrBottom - atrTop);
  };

  const subTitle = el("text", { x: padL, y: atrTop - 8, class: "sub-title" });
  subTitle.textContent = "ATR14";
  svg.appendChild(subTitle);

  const ticks = atrRange === 0 ? [atrMax] : [atrMax, (atrMax + atrMin) / 2, atrMin];
  for (const tick of ticks) {
    const yy = yAtr(tick);
    svg.appendChild(el("line", {
      x1: padL, y1: yy, x2: W - padR, y2: yy, class: tick === atrMin ? "sub-zero" : "atr-grid",
    }));
    const label = el("text", { x: padL - 6, y: yy + 3, class: "axis-label y" });
    label.textContent = fmtPrice(tick);
    svg.appendChild(label);
  }

  let path = "";
  let drawing = false;
  for (let i = 0; i < atrValues.length; i++) {
    const value = atrValues[i];
    if (value == null) {
      drawing = false;
      continue;
    }
    const cmd = drawing ? "L" : "M";
    path += `${path ? " " : ""}${cmd} ${x(i)} ${yAtr(value)}`;
    drawing = true;
  }

  if (path && path.includes("L")) {
    const line = el("path", { d: path, class: "atr-line" });
    const title = el("title");
    title.textContent = "ATR14";
    line.appendChild(title);
    svg.appendChild(line);
  }

  atrValues.forEach((value, i) => {
    if (value == null) return;
    const dot = el("circle", {
      cx: x(i), cy: yAtr(value), r: 3, class: "atr-dot clickable",
    });
    const title = el("title");
    title.textContent = `${bars[i].date}  ATR14 ${fmtPrice(value)}`;
    dot.appendChild(title);
    dot.addEventListener("click", () => select(dot, bars[i]));
    svg.appendChild(dot);

    const hit = el("rect", {
      x: x(i) - slot / 2, y: atrTop, width: slot, height: atrBottom - atrTop,
      class: "atr-hit clickable",
    });
    hit.addEventListener("click", () => select(dot, bars[i]));
    svg.appendChild(hit);
  });
}

function buildCard(payload) {
  const bars = Array.isArray(payload.data) ? payload.data : [];
  const level = evaluateLevel(bars);
  const latest = bars.length ? bars[bars.length - 1] : null;

  const card = document.createElement("section");
  card.className = "card";
  card.id = cardId(payload.code);

  const head = document.createElement("div");
  head.className = "card-head";

  const titleWrap = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = payload.name ? payload.name : payload.code;
  const sub = document.createElement("div");
  sub.className = "code";
  sub.textContent = payload.code;
  titleWrap.appendChild(title);
  titleWrap.appendChild(sub);

  // 存在买入价格：标题橙色，并显示自买入价至今的涨跌幅。
  const buyPrice = payload.buy_price;
  const held = buyPrice != null && !Number.isNaN(Number(buyPrice)) && latest;
  if (held) {
    title.classList.add("buy");
    const pnl = ((latest.close - buyPrice) / buyPrice) * 100;
    const pnlEl = document.createElement("div");
    pnlEl.className = `pnl ${pnl >= 0 ? "up" : "down"}`;
    pnlEl.textContent = `买入 ${fmtPrice(buyPrice)} · 至今 ${fmtPct(pnl)}`;
    titleWrap.appendChild(pnlEl);
  } else if (level.color === "red") {
    // 未持仓但突破前 20 日高点：标题与导航项标红。
    title.classList.add("breakout");
    const navItem = stockNav && stockNav.querySelector(`[data-code="${payload.code}"]`);
    if (navItem) navItem.classList.add("breakout");
  }

  const badge = document.createElement("div");
  badge.className = `badge ${level.color}`;
  const price = latest ? fmtPrice(latest.close) : "N/A";
  badge.innerHTML = `<span class="badge-price">${price}</span><span class="badge-state">${level.state}</span>`;

  head.appendChild(titleWrap);
  head.appendChild(badge);
  card.appendChild(head);

  if (bars.length) {
    const body = document.createElement("div");
    body.className = "card-body";

    const detail = document.createElement("div");
    detail.className = "detail";

    function renderDetail(bar) {
      const isLatest = bar.date === latest.date;
      const ma55 = bar.ma55 == null ? "—" : fmtPrice(bar.ma55);
      const dlt = bar.ma55_delta == null
        ? "—"
        : `${bar.ma55_delta >= 0 ? "+" : ""}${fmtPrice(bar.ma55_delta)}`;
      const adx = bar.adx14_6 == null ? "—" : fmtPrice(bar.adx14_6);
      const atr = bar.atr14 == null ? "—" : fmtPrice(bar.atr14);
      detail.innerHTML = `
        <div class="detail-title">当日数据${isLatest ? "（最新）" : ""}</div>
        <dl class="detail-list">
          <dt>日期</dt><dd>${bar.date}</dd>
          <dt>收盘价</dt><dd>${fmtPrice(bar.close)}</dd>
          <dt>最高价</dt><dd>${fmtPrice(bar.high)}</dd>
          <dt>最低价</dt><dd>${fmtPrice(bar.low)}</dd>
          <dt>55日均线</dt><dd>${ma55}</dd>
          <dt>Δ55日均线</dt><dd>${dlt}</dd>
          <dt>ADX(14,6)</dt><dd>${adx}</dd>
          <dt>ATR14</dt><dd>${atr}</dd>
        </dl>
        <div class="detail-hint">点击任意 K 线查看当日数据</div>
      `;
    }
    renderDetail(latest); // 默认展示最新交易日

    const chart = buildChart(bars, level, renderDetail, payload.buy_price);
    body.appendChild(chart);
    body.appendChild(detail);
    card.appendChild(body);

    const foot = document.createElement("div");
    foot.className = "card-foot";
    foot.textContent = `最新交易日 ${payload.latest_trade_date || latest.date} · 共 ${bars.length} 个交易日`;
    card.appendChild(foot);
  } else {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "无可用数据";
    card.appendChild(empty);
  }

  return card;
}

async function load() {
  setStatus("加载中…");
  grid.innerHTML = "";
  let index;
  try {
    index = await fetchJSON("data/index.json");
  } catch (err) {
    setStatus(`无法读取 data/index.json：${err.message}`);
    if (updatedBar) updatedBar.textContent = "数据更新时间：未知";
    return;
  }

  if (updatedBar) {
    updatedBar.textContent = index.generated_at
      ? `数据更新时间：${index.generated_at}（北京时间）`
      : "数据更新时间：未知";
  }

  const items = (index && index.items) || [];
  if (!items.length) {
    setStatus("data/index.json 中没有可显示的标的。");
    if (stockNav) stockNav.innerHTML = "";
    return;
  }

  buildNav(items);

  let ok = 0;
  for (const item of items) {
    try {
      const payload = await fetchJSON(`data/${item.file || item.code + ".json"}`);
      grid.appendChild(buildCard(payload));
      ok += 1;
    } catch (err) {
      const card = document.createElement("section");
      card.className = "card";
      card.id = cardId(item.code);
      card.innerHTML = `<div class="card-head"><div><h2>${item.name || item.code}</h2><div class="code">${item.code}</div></div></div><div class="empty">加载失败：${err.message}</div>`;
      grid.appendChild(card);
    }
  }
  setStatus(`已加载 ${ok}/${items.length} 个标的`);
}

// 左侧导航：列出标的名称，持仓（有买入价）显示为橙色，点击滚动到对应卡片。
function buildNav(items) {
  if (!stockNav) return;
  stockNav.innerHTML = "";
  for (const item of items) {
    const held = item.buy_price != null && !Number.isNaN(Number(item.buy_price));
    const link = document.createElement("a");
    link.className = `nav-item${held ? " held" : ""}`;
    link.dataset.code = item.code;
    link.href = `#${cardId(item.code)}`;
    link.innerHTML = `<span class="nav-name">${item.name || item.code}</span><span class="nav-code">${item.code}</span>`;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const target = document.getElementById(cardId(item.code));
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      stockNav.querySelectorAll(".nav-item.active").forEach((n) => n.classList.remove("active"));
      link.classList.add("active");
    });
    stockNav.appendChild(link);
  }
}

btnReload.addEventListener("click", load);
load();
