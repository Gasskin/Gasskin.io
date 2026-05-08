/**
 * 上证指数水位仪 – app.js
 * 读取 data.json，渲染最新价格、MA120、水位进度条。
 */

// ── 水位区间着色 ──────────────────────────────────────────────
const ZONES    = [{ max:100, color:'#34c97a' }, { max:999, color:'#f04e4e' }, { max:Infinity, color:'#06b6d4' }];
const getZone  = pct => ZONES.find(z => pct < z.max) ?? ZONES[ZONES.length - 1];
const $        = id  => document.getElementById(id);
const fmt      = n   => n.toLocaleString('zh-CN', { minimumFractionDigits:2, maximumFractionDigits:2 });
const pctColor = v   => v > 0 ? '#f04e4e' : v < 0 ? '#34c97a' : '#6b7a99';
const sign     = v   => v >= 0 ? '+' : '';

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
  }
}

main();
