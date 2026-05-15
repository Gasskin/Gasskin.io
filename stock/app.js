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
  unclassified: '\u672a\u5206\u7c7b',
  stockNav: '\u80a1\u7968',
  category: '\u5206\u7c7b',
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

function safeIdPart(value) {
  const text = String(value ?? '').trim();
  const safe = text.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'item';
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
  if (kind === 'short-ma-ratio') {
    return number > 1 ? 'tone-positive' : 'tone-negative';
  }
  if (kind === 'ma120-ratio') {
    return number >= 1 ? 'tone-positive' : 'tone-negative';
  }
  if (kind === 'quantile') {
    if (number <= 0.3) return 'tone-negative';
    if (number >= 0.7) return 'tone-positive';
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
      tone: metricTone('short-ma-ratio', priceToMa20),
    },
    {
      label: LABELS.priceToMa60,
      value: formatRatioPercent(priceToMa60),
      detail: `MA60 ${formatPrice(row.ma60)}`,
      tone: metricTone('short-ma-ratio', priceToMa60),
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

function normalizeWatchGroups(watch) {
  if (!Array.isArray(watch)) {
    throw new Error('watch.json \u9876\u5c42\u7ed3\u6784\u5e94\u4e3a\u6570\u7ec4');
  }

  const groups = [];
  const ungrouped = [];
  let stockIndex = 0;

  const normalizeStock = (stock, classify) => {
    const code = String(stock?.code ?? '').trim();
    const name = String(stock?.name ?? '').trim();
    const normalized = {
      ...stock,
      code,
      name,
      classify,
      navId: `stock-${safeIdPart(code || name)}-${stockIndex}`,
    };
    stockIndex += 1;
    return normalized;
  };

  watch.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;

    if (Array.isArray(entry.stock)) {
      const classify = String(entry.classify ?? LABELS.unclassified).trim() || LABELS.unclassified;
      const stocks = entry.stock
        .filter(stock => stock && typeof stock === 'object')
        .map(stock => normalizeStock(stock, classify));

      groups.push({
        name: classify,
        navId: `classify-${index}-${safeIdPart(classify)}`,
        stocks,
      });
      return;
    }

    if (entry.code) {
      ungrouped.push(normalizeStock(entry, LABELS.unclassified));
    }
  });

  if (ungrouped.length) {
    groups.push({
      name: LABELS.unclassified,
      navId: `classify-${groups.length}-${safeIdPart(LABELS.unclassified)}`,
      stocks: ungrouped,
    });
  }

  return groups.filter(group => group.stocks.length);
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

  return `<article id="${escapeHtml(stock.navId)}" class="stock-card ${holding ? 'holding' : ''}">
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
  return `<article id="${escapeHtml(item.navId)}" class="stock-card error">
    <div class="stock-head">
      <div class="identity">
        <h2>${escapeHtml(item.name || item.code)}</h2>
        <span>${escapeHtml(item.code)}</span>
      </div>
    </div>
    <div class="error-text">${escapeHtml(error?.message || String(error))}</div>
  </article>`;
}

function renderGroup(group, cardsById) {
  return `<section id="${escapeHtml(group.navId)}" class="classify-section">
    <header class="classify-head">
      <div>
        <span class="classify-label">${escapeHtml(LABELS.category)}</span>
        <h2>${escapeHtml(group.name)}</h2>
      </div>
      <span class="classify-count">${group.stocks.length}</span>
    </header>
    <div class="classify-list">
      ${group.stocks.map(stock => cardsById.get(stock.navId) || '').join('')}
    </div>
  </section>`;
}

function renderStockNav(groups) {
  if (!groups.length) return '';

  return `<div class="stock-nav-title">${escapeHtml(LABELS.stockNav)}</div>
    ${groups.map(group => `<div class="nav-group">
      <a class="nav-group-link" href="#${escapeHtml(group.navId)}">
        <span>${escapeHtml(group.name)}</span>
        <strong>${group.stocks.length}</strong>
      </a>
      <div class="nav-links">
        ${group.stocks.map(stock => `<a class="stock-nav-link" href="#${escapeHtml(stock.navId)}">
          <span class="nav-stock-name">${escapeHtml(stock.name || stock.code)}</span>
          <span class="nav-stock-code">${escapeHtml(stock.code)}</span>
        </a>`).join('')}
      </div>
    </div>`).join('')}`;
}

async function main() {
  try {
    const watch = await fetchJson('watch.json');
    const groups = normalizeWatchGroups(watch);
    const stocks = groups.flatMap(group => group.stocks);
    const results = await Promise.allSettled(stocks.map(loadStock));

    const cardsById = new Map();

    results.forEach((result, index) => {
      const stock = stocks[index];
      if (result.status === 'fulfilled') {
        cardsById.set(stock.navId, renderStock(result.value));
      } else {
        cardsById.set(stock.navId, renderError(stock, result.reason));
      }
    });

    $('stockNav').innerHTML = renderStockNav(groups);
    $('watchlist').innerHTML = groups.map(group => renderGroup(group, cardsById)).join('');

    const loaded = results.filter(result => result.status === 'fulfilled').length;
    $('summary').textContent = `${loaded}/${stocks.length} ${LABELS.loaded}`;
  } catch (error) {
    $('summary').textContent = LABELS.loadingFailed;
    const banner = $('errorBanner');
    banner.textContent = error?.message || String(error);
    banner.classList.remove('hidden');
  }
}

main();
