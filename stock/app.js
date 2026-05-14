const $ = id => document.getElementById(id);

const fmt = value => Number(value).toLocaleString('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmtPrice = value => value == null ? '—' : fmt(value);
const fmtPct = value => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
const pctClass = value => value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
const fmtRatio = value => value == null ? '—' : value.toFixed(2);

const signalDefs = [
  {
    key: 'closeLtMa120',
    label: '收盘价 < MA120',
    primary: true,
    calc: row => compare(row.close, row.ma120, (close, ma120) => close < ma120),
    detail: row => compareDetail(row.close, row.ma120),
  },
  {
    key: 'closeGteMa60',
    label: '收盘价 >= MA60',
    primary: true,
    calc: row => compare(row.close, row.ma60, (close, ma60) => close >= ma60),
    detail: row => compareDetail(row.close, row.ma60),
  },
  {
    key: 'closeGteMa20',
    label: '收盘价 >= MA20',
    primary: true,
    calc: row => compare(row.close, row.ma20, (close, ma20) => close >= ma20),
    detail: row => compareDetail(row.close, row.ma20),
  },
  {
    key: 'volumeRatio',
    label: '5日均交易量 / 20日均交易量 >= 1',
    primary: true,
    calc: row => ratioSignal(row.volume_ma5, row.volume_ma20),
    detail: row => ratioDetail(row.volume_ma5, row.volume_ma20),
  },
  {
    key: 'amountRatio',
    label: '5日均交易额 / 20日均交易额 >= 1',
    primary: true,
    calc: row => ratioSignal(row.amount_ma5, row.amount_ma20),
    detail: row => ratioDetail(row.amount_ma5, row.amount_ma20),
  },
  {
    key: 'ma20GteMa60',
    label: 'MA20 >= MA60',
    primary: false,
    softOff: true,
    calc: row => compare(row.ma20, row.ma60, (ma20, ma60) => ma20 >= ma60),
    detail: row => compareDetail(row.ma20, row.ma60),
  },
];

const primarySignalCount = signalDefs.filter(signal => signal.primary).length;

function compare(left, right, fn) {
  if (left == null || right == null) return null;
  return fn(Number(left), Number(right));
}

function ratioSignal(shortAvg, longAvg) {
  const ratio = calcRatio(shortAvg, longAvg);
  return ratio == null ? null : ratio >= 1;
}

function calcRatio(left, right) {
  if (left == null || right == null || Number(right) === 0) return null;
  return Number(left) / Number(right);
}

function compareDetail(left, right) {
  return `${fmtPrice(left)} / ${fmtPrice(right)}`;
}

function ratioDetail(left, right) {
  const ratio = calcRatio(left, right);
  return `${fmtPrice(left)} / ${fmtPrice(right)} = ${fmtRatio(ratio)}`;
}

function signalClass(value) {
  if (value === true) return 'on';
  if (value === false) return 'off';
  return 'unknown';
}

function signalClasses(signal) {
  const classes = ['signal', signalClass(signal.value)];
  if (signal.primary === false) classes.push('secondary');
  if (signal.softOff && signal.value === false) classes.push('soft-off');
  return classes.join(' ');
}

function signalText(value) {
  if (value === true) return '是';
  if (value === false) return '否';
  return '—';
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

async function loadStock(item) {
  const data = await fetchJson(`watch_data/${item.code}.json`);
  const records = Array.isArray(data.records) ? data.records : [];
  if (!records.length) {
    throw new Error(`${item.code} 没有 records`);
  }

  const latest = records.reduce((latestRow, row) => {
    return String(row.trade_date) > String(latestRow.trade_date) ? row : latestRow;
  }, records[0]);
  const signals = getSignals(latest);

  return {
    ...item,
    data,
    latest,
    signals,
    signalScore: signals.filter(signal => signal.primary && signal.value === true).length,
  };
}

function getSignals(row) {
  return signalDefs.map(def => ({
    ...def,
    value: def.calc(row),
    detail: def.detail(row),
  }));
}

function renderSignals(signals) {
  return signals.map(signal => {
    return `<div class="${signalClasses(signal)}">
      <span class="signal-label">${escapeHtml(signal.label)}</span>
      <span class="signal-value">${signalText(signal.value)}</span>
      <span class="signal-detail">${escapeHtml(signal.detail)}</span>
    </div>`;
  }).join('');
}

function renderBuys(item, close) {
  const buys = Array.isArray(item.buys) ? item.buys : [];
  if (!buys.length) return '';

  return `<div class="buys">
    ${buys.map(price => {
      const pct = close == null || Number(price) === 0
        ? null
        : (Number(close) - Number(price)) / Number(price) * 100;
      return `<span class="buy">
        <span class="buy-price">买入 ${fmtPrice(price)}</span>
        <span class="buy-pct ${pct == null ? 'flat' : pctClass(pct)}">${pct == null ? '—' : fmtPct(pct)}</span>
      </span>`;
    }).join('')}
  </div>`;
}

function renderStock(stock) {
  const row = stock.latest;
  const note = stock.note == null ? '' : String(stock.note);
  const close = row.close;
  const holding = Array.isArray(stock.buys) && stock.buys.length > 0;

  return `<article class="stock-card ${holding ? 'holding' : ''}">
    <div class="stock-head">
      <div class="identity">
        <h2>${escapeHtml(stock.name || stock.code)}</h2>
        <span>${escapeHtml(stock.code)}</span>
      </div>
      <div class="price">
        <span class="price-label">${escapeHtml(row.trade_date)}</span>
        <strong>${fmtPrice(close)}</strong>
        <span class="signal-score">信号 ${stock.signalScore}/${primarySignalCount}</span>
      </div>
    </div>

    ${note ? `<div class="note">${escapeHtml(note)}</div>` : ''}

    <div class="signals">
      ${renderSignals(stock.signals)}
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
    <div class="error-text">${escapeHtml(error.message)}</div>
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
        loadedStocks.push({ index, stock: result.value });
      } else {
        errorCards.push(renderError(watch[index], result.reason));
      }
    });
    loadedStocks.sort((left, right) => {
      return right.stock.signalScore - left.stock.signalScore || left.index - right.index;
    });

    const cards = [
      ...loadedStocks.map(item => renderStock(item.stock)),
      ...errorCards,
    ];

    $('watchlist').innerHTML = cards.join('');

    const loaded = results.filter(result => result.status === 'fulfilled').length;
    $('summary').textContent = `${loaded}/${watch.length} 已加载`;
  } catch (error) {
    $('summary').textContent = '加载失败';
    const banner = $('errorBanner');
    banner.textContent = error.message;
    banner.classList.remove('hidden');
  }
}

main();
