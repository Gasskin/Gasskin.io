/**
 * 上证指数水位仪 – app.js
 * 读取 data.json，渲染最新价格、MA120、水位进度条。
 */

// ── 水位区间着色 ──────────────────────────────────────────────
const ZONES = [
  // { max: 100,      color: '#f97316' },
  // { max: 105,      color: '#eab308' },
  { max: 100,      color: '#22c55e' },
  { max: 999,       color: '#ef4444' },
  { max: Infinity, color: '#06b6d4' },
];
const getZone  = pct => ZONES.find(z => pct < z.max) ?? ZONES[ZONES.length - 1];
const $        = id  => document.getElementById(id);
const fmt      = n   => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctColor = v   => v > 0 ? '#ef4444' : v < 0 ? '#22c55e' : '#94a3b8'; // 涨红跌绿（A股）
const sign     = v   => v >= 0 ? '+' : '';

// ── 渲染大盘水位 ──────────────────────────────────────────────
function renderIndex(d, updateTime = d?.update_time) {
  const priceEl = $('idx-price');
  priceEl.textContent = fmt(d.latest_price);
  priceEl.style.color = pctColor(d.change);

  $('idx-ma120').textContent = fmt(d.ma120);

  const waterEl = $('idx-water');
  waterEl.textContent = `${d.water_level.toFixed(2)}%`;
  waterEl.style.color = getZone(d.water_level).color;

  $('updateTime').textContent = updateTime ?? '—';
}

// ── 渲染单只自选股卡片 ────────────────────────────────────────
function renderStock(s) {
  if (s.error) {
    return `<div class="stock-card error-card">
      <div class="stock-header">
        <span class="stock-name">${s.ts_code}</span>
        <span class="stock-note">${s.note}</span>
      </div>
      <div class="stock-err">⚠️ ${s.error}</div>
    </div>`;
  }

  const priceColor = pctColor(s.change);
  const waterColor = getZone(s.water_level).color;
  const chgStr = `${sign(s.change_pct)}${s.change_pct.toFixed(2)}%`;
  const hasBuys = (s.buys || []).length > 0;

  const buysHtml = (s.buys || []).map(b => `
    <div class="buy-row">
      <span class="buy-label">买入</span>
      <span class="buy-price">¥${b.price.toFixed(3)}</span>
      <span class="buy-arrow">→</span>
      <span class="buy-pct" style="color:${pctColor(b.pct)}">${sign(b.pct)}${b.pct.toFixed(2)}%</span>
    </div>`).join('');

  return `<div class="stock-card">
    <div class="stock-header">
      <span class="stock-name${hasBuys ? ' has-buys' : ''}">${s.name} <span class="stock-code">${s.ts_code}</span></span>
      <span class="stock-note">${s.note}</span>
    </div>
    <div class="stock-metrics">
      <div class="sm-item">
        <span class="lbl">当前</span>
        <span style="color:${priceColor}">${fmt(s.latest_price)}</span>
        <span class="sm-chg" style="color:${priceColor}">${chgStr}</span>
      </div>
      <div class="sm-item">
        <span class="lbl">MA120</span>
        <span>${fmt(s.ma120)}</span>
      </div>
      <div class="sm-item">
        <span class="lbl">水位</span>
        <span style="color:${waterColor}">${s.water_level.toFixed(2)}%</span>
      </div>
    </div>
    ${buysHtml ? `<div class="buys">${buysHtml}</div>` : ''}
  </div>`;
}

// ── 主入口 ────────────────────────────────────────────────────
async function main() {
  try {
    const res = await fetch('data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    renderIndex(data.index, data.update_time);

    const wl = data.watchlist ?? [];
    $('watchlist').innerHTML = wl.length
      ? wl.map(renderStock).join('')
      : '<p class="empty-tip">watch.txt 中暂无自选股</p>';

  } catch (err) {
    const el = $('errorBanner');
    el.textContent = `⚠️ 数据加载失败：${err.message}`;
    el.classList.remove('hidden');
    console.error(err);
  }
}

main();

