const byId = id => document.getElementById(id);
const format = value => Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatPercent = value => `${(Number(value) * 100).toLocaleString('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

let index;
let selectedId;
let comparisonId = '';
let activeView = 'players';
let playerSort = 'averageRank';
let heroSort = 'averageRank';
const expandedHeroes = new Set();
const expandedPlayerHeroes = new Set();

async function readJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePlayers(a, b, sortKey = playerSort) {
  if (sortKey === 'winRate') {
    return b.winRate - a.winRate || a.averageRank - b.averageRank || b.matchCount - a.matchCount || compareText(a.id, b.id);
  }
  if (sortKey === 'top3Rate') {
    return b.top3Rate - a.top3Rate || a.averageRank - b.averageRank || b.matchCount - a.matchCount || compareText(a.id, b.id);
  }
  return a.averageRank - b.averageRank || b.matchCount - a.matchCount || compareText(a.id, b.id);
}

function compareHeroes(a, b, sortKey = heroSort) {
  if (sortKey === 'winRate') {
    return b.winRate - a.winRate || a.averageRank - b.averageRank || b.matchCount - a.matchCount || compareText(a.name, b.name);
  }
  if (sortKey === 'top3Rate') {
    return b.top3Rate - a.top3Rate || a.averageRank - b.averageRank || b.matchCount - a.matchCount || compareText(a.name, b.name);
  }
  if (sortKey === 'matchCount') {
    return b.matchCount - a.matchCount || a.averageRank - b.averageRank || compareText(a.name, b.name);
  }
  return a.averageRank - b.averageRank || b.matchCount - a.matchCount || compareText(a.name, b.name);
}

function sortedPlayers() {
  return [...index.players].sort((a, b) => comparePlayers(a, b, playerSort));
}

function renderPlayers() {
  if (!index) return;
  byId('player-sort').querySelectorAll('.sort-col').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.sort === playerSort));
  });
  const query = byId('search').value.trim().toLocaleLowerCase();
  const fragment = document.createDocumentFragment();
  sortedPlayers().forEach((player, position) => {
    if (!player.id.toLocaleLowerCase().includes(query)) return;
    const button = element('button', 'player-button');
    button.type = 'button';
    button.dataset.id = player.id;
    button.setAttribute('aria-pressed', String(player.id === selectedId));
    button.title = player.id;
    const name = element('span');
    name.append(element('span', 'list-name', player.id), element('span', 'list-count', `${player.matchCount} 场`));
    button.append(
      element('span', 'position', String(position + 1).padStart(2, '0')),
      name,
      element('span', `list-metric${playerSort === 'averageRank' ? ' is-active' : ''}`, format(player.averageRank)),
      element('span', `list-metric${playerSort === 'winRate' ? ' is-active' : ''}`, formatPercent(player.winRate)),
      element('span', `list-metric${playerSort === 'top3Rate' ? ' is-active' : ''}`, formatPercent(player.top3Rate))
    );
    button.addEventListener('click', () => selectPlayer(player));
    fragment.append(button);
  });
  byId('no-results').hidden = fragment.childElementCount > 0;
  byId('player-list').replaceChildren(fragment);
}

function svgNode(tag, attributes = {}, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function drawRadar(player, comparison) {
  const chart = byId('radar');
  chart.replaceChildren(
    svgNode('title', { id: 'radar-title' }, `${player.id}与${comparison.name}的平均数据对比`),
    svgNode('desc', { id: 'radar-description' }, `绿色实线代表${player.id}，黄色实线代表${comparison.name}。`)
  );
  const point = (i, ratio) => {
    const angle = -Math.PI / 2 + i * 2 * Math.PI / index.metrics.length;
    return [270 + Math.cos(angle) * 160 * ratio, 235 + Math.sin(angle) * 160 * ratio];
  };
  const points = ratios => ratios.map((ratio, i) => point(i, ratio).join(',')).join(' ');
  for (let ring = 5; ring >= 1; ring--) {
    chart.append(svgNode('polygon', {
      points: points(index.metrics.map(() => ring / 5)), fill: ring === 5 ? '#16212a' : 'none',
      'fill-opacity': ring === 5 ? '.4' : '0', stroke: '#2b3947', 'stroke-width': 1,
    }));
  }
  index.metrics.forEach((metric, i) => {
    const [x, y] = point(i, 1);
    chart.append(svgNode('line', { x1: 270, y1: 235, x2: x, y2: y, stroke: '#2b3947' }));
    const [labelX, labelY] = point(i, 1.26);
    chart.append(svgNode('text', { x: labelX, y: labelY, fill: '#e4e7ec', 'font-size': 20, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, metric.label));
    chart.append(svgNode('text', { x: labelX, y: labelY + 24, fill: '#b2bed0', 'font-size': 14, 'text-anchor': 'middle' }, `上限 ${format(metric.max)}`));
  });
  for (const [values, color, name] of [
    [comparison.averages, '#f5d45c', comparison.name],
    [player.averages, '#6ed7bd', player.id],
  ]) {
    chart.append(svgNode('polygon', {
      points: points(index.metrics.map(m => values[m.key] / m.max)), fill: color, 'fill-opacity': '.12',
      stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round',
    }));
    index.metrics.forEach((metric, i) => {
      const [cx, cy] = point(i, values[metric.key] / metric.max);
      const dot = svgNode('circle', { cx, cy, r: 4, fill: color });
      dot.append(svgNode('title', {}, `${name} · ${metric.label}：${format(values[metric.key])}`));
      chart.append(dot);
    });
  }
}

function renderComparisonOptions() {
  const candidates = sortedPlayers().filter(player => player.id !== selectedId);
  if (!candidates.some(player => player.id === comparisonId)) comparisonId = '';
  const averageOption = element('option', '', '平均值');
  averageOption.value = '';
  byId('comparison-target').replaceChildren(averageOption, ...candidates.map(player => {
    const option = element('option', '', player.id);
    option.value = player.id;
    return option;
  }));
  byId('comparison-target').value = comparisonId;
}

function renderComparison(player) {
  const target = index.players.find(entry => entry.id === comparisonId);
  const comparison = target
    ? { name: target.id, averages: target.averages }
    : { name: '所有玩家', averages: index.overall };
  byId('comparison-value').textContent = byId('comparison-target').selectedOptions[0].textContent;
  byId('comparison-legend').textContent = target ? target.id : '玩家均值';
  drawRadar(player, comparison);
}

function heroNameCell(hero, expanded, onToggle) {
  const cell = element('td');
  const subCount = hero.lineups?.length || 0;
  if (!subCount) {
    cell.textContent = hero.name;
    return cell;
  }
  const toggle = element('button', 'expand-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.append(
    element('span', 'expand-chevron', '▸'),
    element('span', '', hero.name),
    element('span', 'hero-subcount', `${subCount} 套阵容`)
  );
  toggle.addEventListener('click', event => {
    event.stopPropagation();
    onToggle();
  });
  cell.append(toggle);
  return cell;
}

function renderPlayerHeroes(player) {
  const heroes = player.heroes || [];
  byId('player-heroes-summary').textContent = heroes.length
    ? `共 ${heroes.length} 位棋手 · ${player.heroMatchCount} 场记录`
    : '';
  const fragment = document.createDocumentFragment();
  for (const hero of heroes) {
    const hasLineups = (hero.lineups?.length || 0) > 0;
    const expanded = hasLineups && expandedPlayerHeroes.has(hero.name);
    const toggle = () => {
      if (expandedPlayerHeroes.has(hero.name)) expandedPlayerHeroes.delete(hero.name);
      else expandedPlayerHeroes.add(hero.name);
      renderPlayerHeroes(player);
    };
    const row = element('tr', hasLineups ? 'expandable-row' : '');
    if (hasLineups) {
      row.setAttribute('aria-expanded', String(expanded));
      row.addEventListener('click', toggle);
    }
    row.append(
      heroNameCell(hero, expanded, toggle),
      element('td', '', String(hero.matchCount)),
      element('td', 'metric-highlight', formatPercent(hero.usageRate)),
      element('td', '', format(hero.averageRank)),
      element('td', '', formatPercent(hero.winRate)),
      element('td', '', formatPercent(hero.top3Rate))
    );
    fragment.append(row);
    if (expanded) {
      for (const lineup of hero.lineups) {
        const sub = element('tr', 'sub-row');
        const nameCell = element('td');
        nameCell.append(element('span', 'sub-name', lineup.name));
        sub.append(
          nameCell,
          element('td', '', String(lineup.matchCount)),
          element('td', '', formatPercent(lineup.usageRate)),
          element('td', '', format(lineup.averageRank)),
          element('td', '', formatPercent(lineup.winRate)),
          element('td', '', formatPercent(lineup.top3Rate))
        );
        fragment.append(sub);
      }
    }
  }
  byId('player-heroes').replaceChildren(fragment);
  byId('no-player-heroes').hidden = heroes.length > 0;
}

function selectPlayer(player) {
  if (selectedId !== player.id) expandedPlayerHeroes.clear();
  selectedId = player.id;
  document.querySelectorAll('.player-button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.id === selectedId)));
  byId('player-name').textContent = player.id;
  byId('player-legend').textContent = player.id;
  byId('average-rank').textContent = format(player.averages.rank);
  byId('win-rate').textContent = formatPercent(player.winRate);
  byId('top3-rate').textContent = formatPercent(player.top3Rate);
  byId('match-count').textContent = player.matchCount;
  renderComparisonOptions();
  renderComparison(player);
  renderPlayerHeroes(player);
  byId('player-content').hidden = false;
  byId('player-status').textContent = '';
}

function renderHeroes() {
  if (!index) return;
  byId('hero-sort').querySelectorAll('.sort-col').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.sort === heroSort));
  });
  const allHeroes = index.heroes || [];
  byId('hero-total').textContent = allHeroes.length
    ? `共 ${allHeroes.length} 位棋手 · ${index.heroRecordCount} 条有效记录`
    : '暂无棋手记录';
  const query = byId('hero-search').value.trim().toLocaleLowerCase();
  const ordered = [...allHeroes].sort((a, b) => compareHeroes(a, b, heroSort));
  const fragment = document.createDocumentFragment();
  let visibleCount = 0;
  ordered.forEach((hero, position) => {
    const heroMatched = !query || hero.name.toLocaleLowerCase().includes(query);
    const matchedLineups = (hero.lineups || []).filter(item => item.name.toLocaleLowerCase().includes(query));
    if (!heroMatched && !matchedLineups.length) return;
    visibleCount += 1;
    const hasLineups = (hero.lineups?.length || 0) > 0;
    const autoExpand = Boolean(query) && !heroMatched && matchedLineups.length > 0;
    const expanded = hasLineups && (expandedHeroes.has(hero.name) || autoExpand);
    const toggle = () => {
      if (expandedHeroes.has(hero.name)) expandedHeroes.delete(hero.name);
      else expandedHeroes.add(hero.name);
      renderHeroes();
    };
    const row = element('tr', hasLineups ? 'expandable-row' : '');
    if (hasLineups) {
      row.setAttribute('aria-expanded', String(expanded));
      row.addEventListener('click', toggle);
    }
    row.append(
      element('td', '', String(position + 1).padStart(2, '0')),
      heroNameCell(hero, expanded, toggle),
      element('td', heroSort === 'matchCount' ? 'metric-highlight' : '', String(hero.matchCount)),
      element('td', heroSort === 'averageRank' ? 'metric-highlight' : '', format(hero.averageRank)),
      element('td', heroSort === 'winRate' ? 'metric-highlight' : '', formatPercent(hero.winRate)),
      element('td', heroSort === 'top3Rate' ? 'metric-highlight' : '', formatPercent(hero.top3Rate))
    );
    fragment.append(row);
    if (expanded) {
      const subItems = [...(autoExpand ? matchedLineups : hero.lineups)].sort((a, b) => compareHeroes(a, b, heroSort));
      for (const lineup of subItems) {
        const sub = element('tr', 'sub-row');
        const nameCell = element('td');
        const subName = element('span', 'sub-name', lineup.name);
        subName.append(element('span', 'sub-share', formatPercent(lineup.usageRate)));
        nameCell.append(subName);
        sub.append(
          element('td', '', ''),
          nameCell,
          element('td', heroSort === 'matchCount' ? 'metric-highlight' : '', String(lineup.matchCount)),
          element('td', heroSort === 'averageRank' ? 'metric-highlight' : '', format(lineup.averageRank)),
          element('td', heroSort === 'winRate' ? 'metric-highlight' : '', formatPercent(lineup.winRate)),
          element('td', heroSort === 'top3Rate' ? 'metric-highlight' : '', formatPercent(lineup.top3Rate))
        );
        fragment.append(sub);
      }
    }
  });
  byId('hero-list').replaceChildren(fragment);
  byId('no-heroes').hidden = visibleCount > 0;
}

function setActiveView(view) {
  activeView = view;
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.setAttribute('aria-selected', String(tab.dataset.view === view));
  });
  byId('players-view').hidden = view !== 'players';
  byId('heroes-view').hidden = view !== 'heroes';
}

function normalizePlayers(summary) {
  const fields = ['rank', ...summary.metrics.map(metric => metric.key)];
  for (const player of summary.players) {
    if (!player.averages) {
      if (!player.totals || !player.matchCount) throw new Error('请重新运行“生成数据.bat”更新数据');
      player.averages = Object.fromEntries(fields.map(key => [key, player.totals[key] / player.matchCount]));
    }
    if (player.winRate === undefined || player.top3Rate === undefined) {
      throw new Error('请重新运行“生成数据.bat”更新胜率与棋手数据');
    }
    if (!Array.isArray(player.heroes)) player.heroes = [];
    if (player.heroMatchCount === undefined) {
      player.heroMatchCount = player.heroes.reduce((sum, item) => sum + item.matchCount, 0);
    }
  }
  if (!Array.isArray(summary.heroes)) summary.heroes = [];
  if (summary.heroRecordCount === undefined) {
    summary.heroRecordCount = summary.heroes.reduce((sum, item) => sum + item.matchCount, 0);
  }
}

async function init() {
  try {
    index = await readJson('data/index.json');
    if (!index.players?.length) throw new Error('没有玩家记录');
    normalizePlayers(index);
    byId('dashboard').hidden = false;
    document.querySelectorAll('.view-tab').forEach(tab => {
      tab.addEventListener('click', () => setActiveView(tab.dataset.view));
    });
    byId('player-sort').addEventListener('click', event => {
      const button = event.target.closest('.sort-col');
      if (!button || !button.dataset.sort) return;
      playerSort = button.dataset.sort;
      renderPlayers();
      renderComparisonOptions();
    });
    byId('hero-sort').addEventListener('click', event => {
      const button = event.target.closest('.sort-col');
      if (!button || !button.dataset.sort) return;
      heroSort = button.dataset.sort;
      renderHeroes();
    });
    byId('search').addEventListener('input', renderPlayers);
    byId('hero-search').addEventListener('input', renderHeroes);
    byId('comparison-target').addEventListener('change', () => {
      if (!index) return;
      comparisonId = byId('comparison-target').value;
      renderComparison(index.players.find(player => player.id === selectedId));
    });
    renderPlayers();
    selectPlayer(sortedPlayers()[0]);
    renderHeroes();
  } catch (error) {
    byId('status').hidden = false;
    byId('status').textContent = location.protocol === 'file:'
      ? '请通过网站或本地开发服务器打开此页，直接双击 HTML 无法读取 JSON 数据。'
      : `无法加载对局数据（${error.message}）。请将 data.xlsx 放入 wxq 文件夹，双击“生成数据.bat”后刷新页面。`;
  }
}

init();
