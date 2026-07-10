"use strict";

const DISPLAY_DAYS = 20;
const SVG_NS = "http://www.w3.org/2000/svg";

const stockNav = document.getElementById("stockNav");
const chartPanel = document.getElementById("chartPanel");
const payloadCache = new Map();
let selectedCode = null;

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function formatPrice(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(2);
}

function getDayChange(bars, index) {
  const current = bars[index];
  const rawExplicit = current && (current.pct_chg ?? current.change_pct);
  const explicit = Number(rawExplicit);
  if (rawExplicit != null && Number.isFinite(explicit)) return explicit;
  if (index < 1) return null;

  const previousClose = Number(bars[index - 1].close);
  const currentClose = Number(current.close);
  if (!Number.isFinite(previousClose) || !Number.isFinite(currentClose) || previousClose === 0) return null;
  return ((currentClose - previousClose) / previousClose) * 100;
}

function formatChange(value) {
  if (!Number.isFinite(value)) return "暂无";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

async function fetchJSON(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function createChart(bars, onSelect) {
  const width = 1000;
  const height = 430;
  const pad = { top: 26, right: 28, bottom: 50, left: 68 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const lows = bars.map((bar) => Number(bar.low)).filter(Number.isFinite);
  const highs = bars.map((bar) => Number(bar.high)).filter(Number.isFinite);
  const rawMin = Math.min(...lows);
  const rawMax = Math.max(...highs);
  const breathingRoom = Math.max((rawMax - rawMin) * 0.08, rawMax * 0.005, 0.01);
  const minPrice = rawMin - breathingRoom;
  const maxPrice = rawMax + breathingRoom;
  const priceRange = maxPrice - minPrice || 1;
  const slot = plotWidth / bars.length;
  const candleWidth = Math.max(7, Math.min(22, slot * 0.52));
  const x = (index) => pad.left + slot * (index + 0.5);
  const y = (price) => pad.top + ((maxPrice - price) / priceRange) * plotHeight;

  const svg = svgEl("svg", {
    class: "k-chart",
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": "最近 20 个交易日 K 线图",
  });

  const title = svgEl("title");
  title.textContent = "最近 20 个交易日 K 线图，点击任意 K 线查看当日涨跌幅";
  svg.appendChild(title);

  for (let i = 0; i < 5; i += 1) {
    const ratio = i / 4;
    const gridY = pad.top + plotHeight * ratio;
    const price = maxPrice - priceRange * ratio;
    svg.appendChild(svgEl("line", {
      x1: pad.left,
      y1: gridY,
      x2: width - pad.right,
      y2: gridY,
      class: "grid-line",
    }));
    const label = svgEl("text", {
      x: pad.left - 12,
      y: gridY + 4,
      class: "axis-label price",
    });
    label.textContent = formatPrice(price);
    svg.appendChild(label);
  }

  const dateIndexes = [...new Set([0, 4, 9, 14, bars.length - 1].filter((index) => index < bars.length))];
  for (const index of dateIndexes) {
    const label = svgEl("text", {
      x: x(index),
      y: height - 20,
      class: "axis-label date",
    });
    label.textContent = String(bars[index].date).slice(5);
    svg.appendChild(label);
  }

  const candles = [];
  function selectCandle(index) {
    candles.forEach((candle, candleIndex) => candle.classList.toggle("selected", candleIndex === index));
    onSelect(bars[index], getDayChange(bars, index));
  }

  bars.forEach((bar, index) => {
    const open = Number(bar.open);
    const close = Number(bar.close);
    const high = Number(bar.high);
    const low = Number(bar.low);
    const direction = close > open ? "up" : close < open ? "down" : "flat";
    const centerX = x(index);
    const bodyTop = y(Math.max(open, close));
    const bodyBottom = y(Math.min(open, close));
    const bodyHeight = Math.max(2, bodyBottom - bodyTop);
    const group = svgEl("g", {
      class: `candle ${direction}`,
      role: "button",
      tabindex: "0",
      "aria-label": `${bar.date}，点击查看当日涨跌幅`,
    });

    group.appendChild(svgEl("line", {
      x1: centerX,
      y1: y(high),
      x2: centerX,
      y2: y(low),
      class: "wick",
    }));
    group.appendChild(svgEl("rect", {
      x: centerX - candleWidth / 2,
      y: bodyTop,
      width: candleWidth,
      height: bodyHeight,
      rx: 1,
      class: "body",
    }));
    group.appendChild(svgEl("rect", {
      x: centerX - slot / 2,
      y: pad.top,
      width: slot,
      height: plotHeight,
      class: "hit",
    }));

    group.addEventListener("click", () => selectCandle(index));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectCandle(index);
      }
    });
    candles.push(group);
    svg.appendChild(group);
  });

  requestAnimationFrame(() => selectCandle(bars.length - 1));
  return svg;
}

function renderPayload(payload) {
  const bars = (Array.isArray(payload.data) ? payload.data : []).slice(-DISPLAY_DAYS);
  if (!bars.length) {
    chartPanel.innerHTML = '<div class="empty">暂无 K 线数据</div>';
    return;
  }

  chartPanel.innerHTML = `
    <header class="chart-head">
      <h2 class="chart-title">
        <span class="chart-name"></span>
        <span class="chart-code"></span>
      </h2>
      <div id="dayChange" class="day-change">
        <span class="change-date">点击 K 线</span>
        <span class="change-value">—</span>
      </div>
    </header>
    <div id="chartWrap" class="chart-wrap"></div>
    <p class="chart-caption">红涨绿跌 · 共 20 个交易日</p>
  `;

  chartPanel.querySelector(".chart-name").textContent = payload.name || payload.code;
  chartPanel.querySelector(".chart-code").textContent = payload.code || "";
  const dayChange = document.getElementById("dayChange");
  const dateEl = dayChange.querySelector(".change-date");
  const valueEl = dayChange.querySelector(".change-value");

  const updateChange = (bar, value) => {
    dayChange.classList.remove("up", "down");
    if (Number.isFinite(value) && value !== 0) dayChange.classList.add(value > 0 ? "up" : "down");
    dateEl.textContent = bar.date;
    valueEl.textContent = formatChange(value);
  };

  document.getElementById("chartWrap").appendChild(createChart(bars, updateChange));
}

async function selectStock(item, button) {
  selectedCode = item.code;
  stockNav.querySelectorAll(".stock-button").forEach((node) => {
    const active = node === button;
    node.classList.toggle("active", active);
    node.setAttribute("aria-current", active ? "true" : "false");
  });
  chartPanel.innerHTML = '<div class="loading">正在加载行情…</div>';

  try {
    let payload = payloadCache.get(item.code);
    if (!payload) {
      payload = await fetchJSON(`data/${item.file || `${item.code}.json`}`);
      payloadCache.set(item.code, payload);
    }
    if (selectedCode === item.code) renderPayload(payload);
  } catch (error) {
    if (selectedCode === item.code) {
      chartPanel.innerHTML = `<div class="error">行情加载失败：${error.message}</div>`;
    }
  }
}

function buildNavigation(items) {
  stockNav.innerHTML = "";
  items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stock-button";
    button.innerHTML = '<span class="stock-name"></span><span class="stock-code"></span>';
    button.querySelector(".stock-name").textContent = item.name || item.code;
    button.querySelector(".stock-code").textContent = item.code;
    button.addEventListener("click", () => selectStock(item, button));
    stockNav.appendChild(button);
    if (index === 0) selectStock(item, button);
  });
}

async function load() {
  try {
    const index = await fetchJSON("data/index.json");
    const items = Array.isArray(index.items) ? index.items : [];
    if (!items.length) {
      chartPanel.innerHTML = '<div class="empty">暂无标的</div>';
      return;
    }
    buildNavigation(items);
  } catch (error) {
    chartPanel.innerHTML = `<div class="error">列表加载失败：${error.message}</div>`;
  }
}

load();
