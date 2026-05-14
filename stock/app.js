/**
 * 自选股页面
 * 读取 data.json，渲染上证指数、自选股列表及基础筛选排序。
 */

const ZONES = [{ max: 100, color: '#34c97a' }, { max: Infinity, color: '#f04e4e' }];
const getZone = pct => ZONES.find(z => pct < z.max) ?? ZONES[ZONES.length - 1];
const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctColor = v => v > 0 ? '#f04e4e' : v < 0 ? '#34c97a' : '#6b7a99';
const sign = v => v >= 0 ? '+' : '';

let watchlist = [];

function renderIndex(data, updateTime) {
  const priceEl = $('idx-price');
  priceEl.textContent = fmt(data.latest_price);
  priceEl.style.color = pctColor(data.change);

  const chgEl = priceEl.parentElement.querySelector('.kv-chg')
    || priceEl.insertAdjacentElement('afterend', Object.assign(document.createElement('span'), { className: 'kv-chg' }));
  chgEl.textContent = `${sign(data.change_pct)}${data.change_pct.toFixed(2)}%`;
  chgEl.style.color = pctColor(data.change);

  $('idx-ma120').textContent = fmt(data.ma120);

  const waterEl = $('idx-water');
  waterEl.textContent = `${data.water_level.toFixed(2)}%`;
  waterEl.style.color = getZone(data.water_level).color;

  $('updateTime').textContent = updateTime ? `更新于 ${updateTime}` : '';
}

function renderStock(stock) {
  if (stock.error) {
    return `<div class="stock-card err">
      <div class="sc-head">
        <div class="sc-left"><span class="sc-name">${stock.ts_code}</span></div>
      </div>
      <div class="stock-error">⚠️ ${stock.error}</div>
    </div>`;
  }

  const changeColor = pctColor(stock.change);
  const waterColor = getZone(stock.water_level).color;
  const noteHtml = stock.note && stock.note !== '/' ? `<span class="sc-note">${stock.note}</span>` : '';
  const buysHtml = (stock.buys || []).length
    ? `<div class="sc-buys">${stock.buys.map(buy => `
        <span class="buy-tag">
          <span class="buy-tag-price">¥${buy.price.toFixed(3)}</span>
          <span class="buy-tag-sep">›</span>
          <span class="buy-tag-pct" style="color:${pctColor(buy.pct)}">${sign(buy.pct)}${buy.pct.toFixed(2)}%</span>
        </span>`).join('')}
      </div>`
    : '';

  return `<div class="stock-card">
    <div class="sc-head">
      <div class="sc-left">
        <span class="sc-name" ${stock.buys?.length ? 'style="color:#f97316"' : ''}>${stock.name}</span>
        <span class="sc-code">${stock.ts_code}</span>
      </div>
      ${noteHtml}
    </div>
    <div class="sc-metrics">
      <div class="sc-metric">
        <div class="sc-metric-label">当前价</div>
        <div class="sc-metric-val" style="color:${changeColor}">${fmt(stock.latest_price)}</div>
        <div class="sc-metric-sub" style="color:${changeColor}">${sign(stock.change_pct)}${stock.change_pct.toFixed(2)}%</div>
      </div>
      <div class="sc-metric">
        <div class="sc-metric-label">MA120</div>
        <div class="sc-metric-val dim">${fmt(stock.ma120)}</div>
      </div>
      <div class="sc-metric">
        <div class="sc-metric-label">水位</div>
        <div class="sc-metric-val" style="color:${waterColor}">${stock.water_level.toFixed(2)}%</div>
      </div>
    </div>
    ${buysHtml}
  </div>`;
}

function applyFilters() {
  const onlyHolding = $('onlyHolding').checked;
  const dir = $('sortBtn').dataset.dir;

  let list = [...watchlist];
  if (onlyHolding) {
    list = list.filter(stock => stock.buys && stock.buys.length > 0);
  }

  list.sort((a, b) => {
    const left = a.water_level ?? 0;
    const right = b.water_level ?? 0;
    return dir === 'asc' ? left - right : right - left;
  });

  $('watchlist').innerHTML = list.length
    ? list.map(renderStock).join('')
    : '<p class="empty-tip">暂无数据</p>';
}

function bindControls() {
  $('onlyHolding').addEventListener('change', applyFilters);

  const sortBtn = $('sortBtn');
  sortBtn.addEventListener('click', () => {
    const next = sortBtn.dataset.dir === 'asc' ? 'desc' : 'asc';
    sortBtn.dataset.dir = next;
    sortBtn.textContent = next === 'asc' ? '水位 ↑' : '水位 ↓';
    applyFilters();
  });
}

async function main() {
  bindControls();

  try {
    const response = await fetch('data.json', { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    renderIndex(data.index, data.update_time);
    watchlist = data.watchlist ?? [];
    applyFilters();
  } catch (error) {
    const el = $('errorBanner');
    el.textContent = `⚠️ 数据加载失败：${error.message}`;
    el.classList.remove('hidden');
  }
}

main();
