/**
 * 上证指数水位仪 – app.js
 * 读取 data.json，渲染最新价格、MA120、水位进度条。
 */

// ── 水位区间着色 ──────────────────────────────────────────────
const ZONES    = [{ max:100, color:'#34c97a' }, { max:999, color:'#f04e4e' }, { max:Infinity, color:'#06b6d4' }];
const getZone  = pct => ZONES.find(z => pct < z.max) ?? ZONES[ZONES.length - 1];
const $        = id  => document.getElementById(id);
const fmt      = n   => n.toLocaleString('zh-CN', { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmt0     = n   => n.toLocaleString('zh-CN', { maximumFractionDigits:0 });
const fmt4     = n   => n.toLocaleString('zh-CN', { minimumFractionDigits:4, maximumFractionDigits:4 });
const pctColor = v   => v > 0 ? '#f04e4e' : v < 0 ? '#34c97a' : '#6b7a99';
const sign     = v   => v >= 0 ? '+' : '';
const esc      = v   => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
const ETF_NAMES = {
  '588000.SH': '科创50ETF',
  '159995.SZ': '芯片ETF',
  '159915.SZ': '创业板ETF',
};

// ── 大盘水位 ────────────────────────────────────────────────
function renderIndex(d, updateTime) {
  const priceEl = $('idx-price');
  priceEl.textContent = fmt(d.latest_price);
  priceEl.style.color = pctColor(d.change);

  // 在价格右侧追加涨跌幅
  const chgEl = priceEl.parentElement.querySelector('.kv-chg')
    || priceEl.insertAdjacentElement('afterend', Object.assign(document.createElement('span'), { className: 'kv-chg' }));
  chgEl.textContent = `${sign(d.change_pct)}${d.change_pct.toFixed(2)}%`;
  chgEl.style.color = pctColor(d.change);

  $('idx-ma120').textContent = fmt(d.ma120);

  const waterEl = $('idx-water');
  waterEl.textContent = `${d.water_level.toFixed(2)}%`;
  waterEl.style.color = getZone(d.water_level).color;

  $('updateTime').textContent = updateTime ? `更新于 ${updateTime}` : '';
}

// ── 自选股卡片 ──────────────────────────────────────────────
function renderStock(s) {
  if (s.error) {
    return `<div class="stock-card err">
      <div class="sc-head">
        <div class="sc-left"><span class="sc-name">${s.ts_code}</span></div>
      </div>
      <div style="padding:.6rem 1.2rem;font-size:.8rem;color:#f87171">⚠️ ${s.error}</div>
    </div>`;
  }

  const pc = pctColor(s.change);
  const wc = getZone(s.water_level).color;
  const chgStr = `${sign(s.change_pct)}${s.change_pct.toFixed(2)}%`;

  const noteHtml = (s.note && s.note !== '/')
    ? `<span class="sc-note">${s.note}</span>` : '';

  const buysHtml = (s.buys || []).length
    ? `<div class="sc-buys">${(s.buys).map(b =>
        `<span class="buy-tag">
          <span class="buy-tag-price">¥${b.price.toFixed(3)}</span>
          <span class="buy-tag-sep">›</span>
          <span class="buy-tag-pct" style="color:${pctColor(b.pct)}">${sign(b.pct)}${b.pct.toFixed(2)}%</span>
        </span>`).join('')}
      </div>` : '';

  return `<div class="stock-card">
    <div class="sc-head">
      <div class="sc-left">
        <span class="sc-name" ${s.buys?.length ? 'style="color:#f97316"' : ''}>${s.name}</span>
        <span class="sc-code">${s.ts_code}</span>
      </div>
      ${noteHtml}
    </div>
    <div class="sc-metrics">
      <div class="sc-metric">
        <div class="sc-metric-label">当前价</div>
        <div class="sc-metric-val" style="color:${pc}">${fmt(s.latest_price)}</div>
        <div class="sc-metric-sub" style="color:${pc}">${chgStr}</div>
      </div>
      <div class="sc-metric">
        <div class="sc-metric-label">MA120</div>
        <div class="sc-metric-val dim">${fmt(s.ma120)}</div>
      </div>
      <div class="sc-metric">
        <div class="sc-metric-label">水位</div>
        <div class="sc-metric-val" style="color:${wc}">${s.water_level.toFixed(2)}%</div>
      </div>
    </div>
    ${buysHtml}
  </div>`;
}

// ── 入口 ────────────────────────────────────────────────────
let _watchlist = [];
let _momentumLoaded = false;
let _activeMomentumPayload = null;
let _activeMomentumItem = null;
let _activeMomentumFile = '';
let _activeMomentumRange = 'year';
let _activeMomentumCustomRange = null;
let _controlsBound = false;
const _momentumItems = new Map();
const RANGE_OPTIONS = {
  year: { label: '近一年', days: 365 },
  month: { label: '近一月', days: 31 },
  week: { label: '近一周', days: 7 },
};

function applyFilters() {
  const onlyHolding = document.getElementById('onlyHolding').checked;
  const dir = document.getElementById('sortBtn').dataset.dir; // 'asc' | 'desc'

  let list = [..._watchlist];
  if (onlyHolding) list = list.filter(s => s.buys && s.buys.length > 0);
  list.sort((a, b) => {
    const wa = a.water_level ?? 0, wb = b.water_level ?? 0;
    return dir === 'asc' ? wa - wb : wb - wa;
  });

  const el = document.getElementById('watchlist');
  el.innerHTML = list.length
    ? list.map(renderStock).join('')
    : '<p class="empty-tip">暂无数据</p>';
}

function switchPage(page) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });
  $('watchPage').classList.toggle('active', page === 'watch');
  $('momentumPage').classList.toggle('active', page === 'momentum');
  if (page === 'momentum' && !_momentumLoaded) loadMomentumCharts();
}

function bindControls() {
  if (_controlsBound) return;
  _controlsBound = true;

  document.getElementById('onlyHolding').addEventListener('change', applyFilters);

  const sortBtn = document.getElementById('sortBtn');
  sortBtn.addEventListener('click', () => {
    const next = sortBtn.dataset.dir === 'asc' ? 'desc' : 'asc';
    sortBtn.dataset.dir = next;
    sortBtn.textContent = next === 'asc' ? '水位 ↑' : '水位 ↓';
    applyFilters();
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
  });

  $('momentumDialogClose').addEventListener('click', closeMomentumDialog);
  document.querySelector('[data-close-dialog]').addEventListener('click', closeMomentumDialog);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && _activeMomentumPayload) closeMomentumDialog();
  });
}

async function fetchJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return res.json();
}

function normalizeManifest(data) {
  if (Array.isArray(data)) return data.map(file => ({ file }));
  if (Array.isArray(data.files)) return data.files.map(file => typeof file === 'string' ? { file } : file);
  if (Array.isArray(data.items)) return data.items.map(item => typeof item === 'string' ? { file: item } : item);
  return [];
}

function displayNameFor(meta, manifestItem = {}, file = '') {
  const tsCode = meta.ts_code ?? manifestItem.ts_code ?? file.replace(/^data|\.json$/g, '');
  return manifestItem.name || meta.name || ETF_NAMES[tsCode] || tsCode;
}

function recentRecords(records, range = 'year') {
  if (!records.length) return records;
  const last = new Date(`${records[records.length - 1].date}T00:00:00`);
  const start = new Date(last);
  start.setDate(start.getDate() - (RANGE_OPTIONS[range]?.days ?? RANGE_OPTIONS.year.days));
  return records.filter(record => new Date(`${record.date}T00:00:00`) >= start);
}

function recordsInCustomRange(records, customRange) {
  if (!customRange?.start || !customRange?.end) return records;
  const start = new Date(`${customRange.start}T00:00:00`);
  const end = new Date(`${customRange.end}T23:59:59`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  return records.filter(record => {
    const date = new Date(`${record.date}T00:00:00`);
    return date >= start && date <= end;
  });
}

function activeRangeRecords(records, range = 'year', customRange = null) {
  return customRange ? recordsInCustomRange(records, customRange) : recentRecords(records, range);
}

function defaultCustomRange(records, range = 'year') {
  const scoped = recentRecords(records, range);
  if (!scoped.length) return { start: '', end: '' };
  return { start: scoped[0].date, end: scoped[scoped.length - 1].date };
}

function chartScales(records) {
  const values = records.map(r => Number(r.total_score ?? 0)).filter(Number.isFinite);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(100, ...values);
  const pad = Math.max(5, (maxValue - minValue) * 0.08);
  return { minValue, maxValue: maxValue + pad };
}

function pathFor(records, width, height, pad, minValue, maxValue) {
  const span = maxValue - minValue || 1;
  return records.map((record, index) => {
    const x = pad.left + (records.length === 1 ? 0 : index / (records.length - 1)) * (width - pad.left - pad.right);
    const score = Number(record.total_score ?? 0);
    const y = pad.top + (1 - (score - minValue) / span) * (height - pad.top - pad.bottom);
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

function yForValue(value, height, pad, minValue, maxValue) {
  const span = maxValue - minValue || 1;
  return pad.top + (1 - (value - minValue) / span) * (height - pad.top - pad.bottom);
}

function renderMomentumSummary(payload, file, manifestItem = {}) {
  const meta = payload.metadata ?? {};
  const records = (payload.records ?? []).filter(item => item.date);
  const tsCode = meta.ts_code ?? file.replace(/^data|\.json$/g, '');
  const latest = records[records.length - 1];
  const name = displayNameFor(meta, manifestItem, file);

  if (!records.length) {
    return `<button class="momentum-row" type="button" disabled>
      <span class="momentum-name">${esc(name)}</span>
      <span class="momentum-code">${esc(tsCode)}</span>
      <span class="momentum-score dim">暂无</span>
    </button>`;
  }

  const score = Number(latest.total_score ?? 0);
  const scoreColor = score > 100 ? '#f04e4e' : score > 0 ? '#f59e0b' : '#6b7a99';
  return `<button class="momentum-row" type="button">
    <span class="momentum-title">
      <span class="momentum-name">${esc(name)}</span>
      <span class="momentum-code">${esc(tsCode)}</span>
    </span>
    <span class="momentum-latest">
      <span class="momentum-label">最新总分</span>
      <strong style="color:${scoreColor}">${fmt(score)}</strong>
    </span>
  </button>`;
}

function latestMomentumScore(payload) {
  const records = (payload.records ?? []).filter(item => item.date);
  const latest = records[records.length - 1];
  const score = Number(latest?.total_score ?? Number.NEGATIVE_INFINITY);
  return Number.isFinite(score) ? score : Number.NEGATIVE_INFINITY;
}

function renderMomentumChart(payload, manifestItem = {}, file = '', range = 'year', customRange = null) {
  const meta = payload.metadata ?? {};
  const allRecords = (payload.records ?? []).filter(item => item.date);
  const records = activeRangeRecords(allRecords, range, customRange);
  const tsCode = meta.ts_code ?? manifestItem.ts_code ?? file.replace(/^data|\.json$/g, '');
  const name = displayNameFor(meta, manifestItem, file);
  const latest = records[records.length - 1];
  const rangeLabel = customRange ? '自定义' : (RANGE_OPTIONS[range]?.label ?? RANGE_OPTIONS.year.label);
  const inputRange = customRange ?? defaultCustomRange(allRecords, range);

  if (!records.length) {
    return `<div class="chart-card">
      <div class="chart-head">
        <div class="chart-title-block">
          <div class="chart-title">${esc(name)}</div>
          <div class="chart-sub">${esc(tsCode)} · ${esc(rangeLabel)}</div>
        </div>
      </div>
      ${renderRangeControls(range, inputRange, customRange)}
      <div class="chart-empty">暂无${esc(rangeLabel)}记录</div>
    </div>`;
  }

  const width = 760;
  const height = 360;
  const pad = { top: 22, right: 22, bottom: 36, left: 46 };
  const { minValue, maxValue } = chartScales(records);
  const path = pathFor(records, width, height, pad, minValue, maxValue);
  const score = Number(latest.total_score ?? 0);
  const scoreColor = score > 100 ? '#f04e4e' : score > 0 ? '#f59e0b' : '#6b7a99';
  const y100 = yForValue(100, height, pad, minValue, maxValue);

  return `<div class="chart-card">
    <div class="chart-head">
      <div class="chart-title-block">
        <div class="chart-title">${esc(name)}</div>
        <div class="chart-sub">${esc(tsCode)} · ${esc(rangeLabel)} · ${records.length} 个交易日</div>
      </div>
      <div class="chart-latest">
        <span>最新总分</span>
        <strong style="color:${scoreColor}">${fmt(latest.total_score ?? 0)}</strong>
      </div>
    </div>
    ${renderRangeControls(range, inputRange, customRange)}
    <div class="chart-stage">
      <svg class="score-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(tsCode)} 动量分数折线图">
        <line class="grid-line" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" />
        <line class="grid-line" x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" />
        <line class="grid-line soft" x1="${pad.left}" y1="${pad.top}" x2="${width - pad.right}" y2="${pad.top}" />
        <text class="axis-label" x="${pad.left - 10}" y="${pad.top + 4}" text-anchor="end">${fmt0(maxValue)}</text>
        <text class="axis-label" x="${pad.left - 10}" y="${height - pad.bottom + 4}" text-anchor="end">${fmt0(minValue)}</text>
        <line class="threshold-line" x1="${pad.left}" y1="${y100}" x2="${width - pad.right}" y2="${y100}" />
        <text class="threshold-label" x="${width - pad.right - 4}" y="${y100 - 6}" text-anchor="end">100</text>
        <path class="score-line" d="${path}" />
        <line class="hover-line hidden" x1="0" y1="${pad.top}" x2="0" y2="${height - pad.bottom}" />
        <circle class="hover-dot hidden" cx="0" cy="0" r="4.5" />
        <rect class="hit-area" x="${pad.left}" y="${pad.top}" width="${width - pad.left - pad.right}" height="${height - pad.top - pad.bottom}" />
      </svg>
    </div>
    <div class="chart-detail">
    </div>
  </div>`;
}

function renderRangeControls(range, inputRange, customRange) {
  return `<div class="chart-range-panel">
    <div class="chart-range-tabs">
      ${Object.entries(RANGE_OPTIONS).map(([key, item]) =>
        `<button class="range-btn ${!customRange && key === range ? 'active' : ''}" type="button" data-range="${key}">${item.label}</button>`
      ).join('')}
    </div>
    <div class="date-range">
      <label>开始 <input class="date-input" type="date" data-date-role="start" value="${esc(inputRange.start)}"></label>
      <label>结束 <input class="date-input" type="date" data-date-role="end" value="${esc(inputRange.end)}"></label>
    </div>
  </div>`;
}

function renderDetail(record) {
  return `<span>${esc(record.date)}</span>
    <span>总分 ${fmt(record.total_score ?? 0)}</span>
    <span>收盘 ${fmt4(record.close ?? 0)}</span>
    <span>成交量 ${fmt0(record.volume ?? 0)}</span>
    <span>趋势 ${fmt(record.trend_score ?? 0)}</span>
    <span>动量 ${fmt(record.momentum_score ?? 0)}</span>
    <span>量能 ${fmt(record.volume_score ?? 0)}</span>`;
}

function bindChartInteractions(card, payload, range = 'year', customRange = null) {
  const records = activeRangeRecords(payload.records ?? [], range, customRange);
  const svg = card?.querySelector('.score-chart');
  const hit = card?.querySelector('.hit-area');
  const line = card?.querySelector('.hover-line');
  const dot = card?.querySelector('.hover-dot');
  const detail = card?.querySelector('.chart-detail');
  if (!svg || !hit || !line || !dot || !detail || !records.length) return;

  const viewBox = svg.viewBox.baseVal;
  const pad = { top: 22, right: 22, bottom: 36, left: 46 };
  const { minValue, maxValue } = chartScales(records);
  const span = maxValue - minValue || 1;

  const setActive = index => {
    const bounded = Math.max(0, Math.min(records.length - 1, index));
    const record = records[bounded];
    const x = pad.left + (records.length === 1 ? 0 : bounded / (records.length - 1)) * (viewBox.width - pad.left - pad.right);
    const score = Number(record.total_score ?? 0);
    const y = pad.top + (1 - (score - minValue) / span) * (viewBox.height - pad.top - pad.bottom);

    line.setAttribute('x1', x);
    line.setAttribute('x2', x);
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
    line.classList.remove('hidden');
    dot.classList.remove('hidden');
    detail.innerHTML = renderDetail(record);
  };

  const handlePointer = event => {
    const rect = svg.getBoundingClientRect();
    const pct = (event.clientX - rect.left) / rect.width;
    const x = pct * viewBox.width;
    const chartPct = (x - pad.left) / (viewBox.width - pad.left - pad.right);
    setActive(Math.round(chartPct * (records.length - 1)));
  };

  hit.addEventListener('pointermove', handlePointer);
  hit.addEventListener('click', handlePointer);
  setActive(records.length - 1);
}

function renderActiveMomentumChart() {
  const body = $('momentumDialogBody');
  body.innerHTML = renderMomentumChart(
    _activeMomentumPayload,
    _activeMomentumItem,
    _activeMomentumFile,
      _activeMomentumRange,
      _activeMomentumCustomRange,
  );
  const card = body.querySelector('.chart-card');
  bindChartInteractions(card, _activeMomentumPayload, _activeMomentumRange, _activeMomentumCustomRange);
  body.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeMomentumRange = btn.dataset.range || 'year';
      _activeMomentumCustomRange = null;
      renderActiveMomentumChart();
    });
  });
  body.querySelectorAll('.date-input').forEach(input => {
    input.addEventListener('change', () => {
      const start = body.querySelector('[data-date-role="start"]')?.value;
      const end = body.querySelector('[data-date-role="end"]')?.value;
      _activeMomentumCustomRange = { start, end };
      renderActiveMomentumChart();
    });
  });
}

async function loadMomentumCharts() {
  const listEl = $('momentumCharts');
  const countEl = $('momentumCount');
  _momentumLoaded = true;
  listEl.innerHTML = '<p class="empty-tip">加载中...</p>';

  try {
    const manifest = normalizeManifest(await fetchJson('momentum-output/index.json'));
    if (!manifest.length) {
      listEl.innerHTML = '<p class="empty-tip">暂无动量数据</p>';
      countEl.textContent = '0';
      return;
    }

    listEl.innerHTML = '';
    _momentumItems.clear();
    countEl.textContent = `${manifest.length} 个`;
    const entries = [];
    for (const item of manifest) {
      const file = item.file ?? item.path;
      if (!file) continue;
      const payload = await fetchJson(`momentum-output/${file}`);
      entries.push({ file, item, payload, score: latestMomentumScore(payload) });
    }

    entries.sort((a, b) => b.score - a.score);
    for (const { file, item, payload } of entries) {
      listEl.insertAdjacentHTML('beforeend', renderMomentumSummary(payload, file, item));
      const row = listEl.lastElementChild;
      if (row && !row.disabled) {
        _momentumItems.set(file, { payload, item });
        row.addEventListener('click', () => openMomentumDialog(payload, item, file));
      }
    }
  } catch (err) {
    listEl.innerHTML = `<p class="empty-tip">动量数据加载失败：${esc(err.message)}</p>`;
    countEl.textContent = '—';
  }
}

function openMomentumDialog(payload, manifestItem, file) {
  _activeMomentumPayload = payload;
  _activeMomentumItem = manifestItem;
  _activeMomentumFile = file;
  _activeMomentumRange = 'year';
  _activeMomentumCustomRange = null;
  const dialog = $('momentumDialog');
  renderActiveMomentumChart();
  dialog.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeMomentumDialog() {
  $('momentumDialog').classList.add('hidden');
  $('momentumDialogBody').innerHTML = '';
  document.body.classList.remove('modal-open');
  _activeMomentumPayload = null;
  _activeMomentumItem = null;
  _activeMomentumFile = '';
  _activeMomentumRange = 'year';
  _activeMomentumCustomRange = null;
}

async function main() {
  bindControls();

  try {
    const res = await fetch('data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderIndex(data.index, data.update_time);
    _watchlist = data.watchlist ?? [];
    applyFilters();
  } catch (err) {
    const el = document.getElementById('errorBanner');
    el.textContent = `⚠️ 数据加载失败：${err.message}`;
    el.classList.remove('hidden');
  }
}

main();
