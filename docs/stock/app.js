const $ = id => document.getElementById(id);

const EMPTY = '--';

const LABELS = {
  price: '\u80a1\u4ef7',
  priceToMa20: '\u80a1\u4ef7 / MA20',
  priceToMa60: '\u80a1\u4ef7 / MA60',
  priceToMa120: '\u80a1\u4ef7 / MA120',
  peQuantile: 'PE \u5206\u4f4d',
  pbQuantile: 'PB \u5206\u4f4d',
  tradeDate: '\u4ea4\u6613\u65e5',
  buyAt: '\u4e70\u5165',
  loaded: '\u5df2\u52a0\u8f7d',
  loadingFailed: '\u52a0\u8f7d\u5931\u8d25',
  missingRecords: '\u6ca1\u6709 records',
};

function toNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value, digits = 2) {
  const number = toNumber(value);
  if (number == null) return EMPTY;
  return number.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPrice(value) {
  return formatNumber(value, 2);
}

function formatRatio(value) {
  return formatNumber(value, 2);
}

function formatRatioPercent(value) {
  const number = toNumber(value);
  if (number == null) return EMPTY;
  return `${(number * 100).toFixed(2)}%`;
}

function formatQuantile(value) {
  const number = toNumber(value);
  if (number == null) return EMPTY;
  return `${(number * 100).toFixed(1)}%`;
}

function formatPct(value) {
  const number = toNumber(value);
  if (number == null) return EMPTY;
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function formatTradeDate(value) {
  const text = String(value ?? '').trim();
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  return text || EMPTY;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`${path} HTTP ${response.status}`);
  }
  return response.json();
}

function calcRatio(left, right) {
  const numerator = toNumber(left);
  const denominator = toNumber(right);
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

function metricTone(kind, value) {
  const number = toNumber(value);
  if (number == null) return 'tone-muted';
  if (kind === 'ma120-ratio') {
    return number >= 1 ? 'tone-positive' : 'tone-negative';
  }
  if (kind === 'quantile') {
    if (number <= 0.3) return 'tone-positive';
    if (number >= 0.7) return 'tone-negative';
  }
  return 'tone-neutral';
}

function buildMetrics(row) {
  const priceToMa20 = calcRatio(row.close, row.ma20);
  const priceToMa60 = calcRatio(row.close, row.ma60);
  const priceToMa120 = calcRatio(row.close, row.ma120);

  return [
    {
      label: LABELS.price,
      value: formatPrice(row.close),
      detail: formatTradeDate(row.trade_date),
      tone: 'tone-neutral',
    },
    {
      label: LABELS.priceToMa20,
      value: formatRatioPercent(priceToMa20),
      detail: `MA20 ${formatPrice(row.ma20)}`,
      tone: 'tone-neutral',
    },
    {
      label: LABELS.priceToMa60,
      value: formatRatioPercent(priceToMa60),
      detail: `MA60 ${formatPrice(row.ma60)}`,
      tone: 'tone-neutral',
    },
    {
      label: LABELS.priceToMa120,
      value: formatRatioPercent(priceToMa120),
      detail: `MA120 ${formatPrice(row.ma120)}`,
      tone: metricTone('ma120-ratio', priceToMa120),
    },
    {
      label: LABELS.peQuantile,
      value: formatQuantile(row.pe_ttm_quantile),
      detail: `PE ${formatRatio(row.pe_ttm)}`,
      tone: metricTone('quantile', row.pe_ttm_quantile),
    },
    {
      label: LABELS.pbQuantile,
      value: formatQuantile(row.pb_quantile),
      detail: `PB ${formatRatio(row.pb)}`,
      tone: metricTone('quantile', row.pb_quantile),
    },
  ];
}

function renderMetrics(metrics) {
  return metrics.map(metric => {
    return `<div class="metric ${metric.tone}">
      <span class="metric-label">${escapeHtml(metric.label)}</span>
      <strong class="metric-value">${escapeHtml(metric.value)}</strong>
      <span class="metric-detail">${escapeHtml(metric.detail)}</span>
    </div>`;
  }).join('');
}

async function loadStock(item) {
  const data = await fetchJson(`watch_data/${item.code}.json`);
  const records = Array.isArray(data.records) ? data.records : [];
  if (!records.length) {
    throw new Error(`${item.code} ${LABELS.missingRecords}`);
  }

  const latest = records.reduce((latestRow, row) => {
    return String(row.trade_date) > String(latestRow.trade_date) ? row : latestRow;
  }, records[0]);

  return {
    ...item,
    data,
    latest,
  };
}

function pctClass(value) {
  const number = toNumber(value);
  if (number == null) return 'flat';
  return number > 0 ? 'up' : number < 0 ? 'down' : 'flat';
}

function renderBuys(item, close) {
  const buys = Array.isArray(item.buys) ? item.buys : [];
  if (!buys.length) return '';

  return `<div class="buys">
    ${buys.map(price => {
      const buyPrice = toNumber(price);
      const closePrice = toNumber(close);
      const pct = buyPrice == null || closePrice == null || buyPrice === 0
        ? null
        : ((closePrice - buyPrice) / buyPrice) * 100;

      return `<span class="buy">
        <span class="buy-price">${escapeHtml(LABELS.buyAt)} ${escapeHtml(formatPrice(price))}</span>
        <span class="buy-pct ${pctClass(pct)}">${escapeHtml(formatPct(pct))}</span>
      </span>`;
    }).join('')}
  </div>`;
}

function renderStock(stock) {
  const row = stock.latest;
  const note = stock.note == null ? '' : String(stock.note).trim();
  const close = row.close;
  const holding = Array.isArray(stock.buys) && stock.buys.length > 0;
  const metrics = buildMetrics(row);

  return `<article class="stock-card ${holding ? 'holding' : ''}">
    <div class="stock-head">
      <div class="identity">
        <h2>${escapeHtml(stock.name || stock.code)}</h2>
        <span>${escapeHtml(stock.code)}</span>
      </div>
      <div class="asof">
        <span class="asof-label">${escapeHtml(LABELS.tradeDate)}</span>
        <strong>${escapeHtml(formatTradeDate(row.trade_date))}</strong>
      </div>
    </div>

    ${note ? `<div class="note">${escapeHtml(note)}</div>` : ''}

    <div class="metrics">
      ${renderMetrics(metrics)}
    </div>

    ${renderBuys(stock, close)}
  </article>`;
}

function renderError(item, error) {
  return `<article class="stock-card error">
    <div class="stock-head">
      <div class="identity">
        <h2>${escapeHtml(item.name || item.code)}</h2>
        <span>${escapeHtml(item.code)}</span>
      </div>
    </div>
    <div class="error-text">${escapeHtml(error?.message || String(error))}</div>
  </article>`;
}

async function main() {
  try {
    const watch = await fetchJson('watch.json');
    const results = await Promise.allSettled(watch.map(loadStock));

    const loadedStocks = [];
    const errorCards = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        loadedStocks.push(result.value);
      } else {
        errorCards.push(renderError(watch[index], result.reason));
      }
    });

    $('watchlist').innerHTML = [
      ...loadedStocks.map(renderStock),
      ...errorCards,
    ].join('');

    const loaded = results.filter(result => result.status === 'fulfilled').length;
    $('summary').textContent = `${loaded}/${watch.length} ${LABELS.loaded}`;
  } catch (error) {
    $('summary').textContent = LABELS.loadingFailed;
    const banner = $('errorBanner');
    banner.textContent = error?.message || String(error);
    banner.classList.remove('hidden');
  }
}

main();
