const byId = id => document.getElementById(id);
const format = value => Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let index;
let allEvents;
let eventRequestNumber = 0;
let selectedId;
let comparisonId = '';

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

function renderPlayers() {
  if (!index) return;
  const query = byId('search').value.trim().toLocaleLowerCase();
  const fragment = document.createDocumentFragment();
  index.players.forEach((player, position) => {
    if (!player.id.toLocaleLowerCase().includes(query)) return;
    const button = element('button', 'player-button');
    button.type = 'button';
    button.dataset.id = player.id;
    button.setAttribute('aria-pressed', String(player.id === selectedId));
    button.title = player.id;
    const name = element('span');
    name.append(element('span', 'list-name', player.id), element('span', 'list-count', `${player.matchCount} 场对局`));
    button.append(element('span', 'position', String(position + 1).padStart(2, '0')), name, element('span', 'list-rank', format(player.averageRank)));
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
    svgNode('desc', { id: 'radar-description' }, `绿色实线代表${player.id}，黄色实线代表${comparison.name}。真实均值见平均数据表。`)
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
  const candidates = index.players.filter(player => player.id !== selectedId);
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
  byId('comparison-heading').textContent = comparison.name;
  const rows = index.metrics.map(metric => {
    const row = element('tr');
    row.append(element('td', '', metric.label), element('td', '', format(player.averages[metric.key])), element('td', '', format(comparison.averages[metric.key])));
    return row;
  });
  byId('averages').replaceChildren(...rows);
  drawRadar(player, comparison);
}

function selectPlayer(player) {
  selectedId = player.id;
  document.querySelectorAll('.player-button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.id === selectedId)));
  byId('player-name').textContent = player.id;
  byId('player-legend').textContent = player.id;
  byId('average-rank').textContent = format(player.averages.rank);
  byId('match-count').textContent = player.matchCount;
  renderComparisonOptions();
  renderComparison(player);
  byId('player-content').hidden = false;
  byId('player-status').textContent = '';
}

function mergeEvents(summaries) {
  const metrics = summaries[0].metrics;
  const fields = ['rank', ...metrics.map(metric => metric.key)];
  const combined = new Map();
  for (const summary of summaries) {
    for (const entry of summary.players) {
      if (!entry.totals) throw new Error('请重新运行“生成数据.bat”更新赛事数据');
      if (!combined.has(entry.id)) combined.set(entry.id, {
        id: entry.id, matchCount: 0, totals: Object.fromEntries(fields.map(key => [key, 0])),
      });
      const player = combined.get(entry.id);
      player.matchCount += entry.matchCount;
      for (const key of fields) player.totals[key] += entry.totals[key];
    }
  }
  const players = [...combined.values()];
  for (const player of players) {
    player.averages = Object.fromEntries(fields.map(key => [key, player.totals[key] / player.matchCount]));
    player.averageRank = player.averages.rank;
  }
  players.sort((a, b) => a.averageRank - b.averageRank || b.matchCount - a.matchCount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    players,
    overall: Object.fromEntries(fields.map(key => [key, players.reduce((sum, player) => sum + player.averages[key], 0) / players.length])),
    metrics: metrics.map(metric => ({...metric, max: players.reduce((max, player) => Math.max(max, player.averages[metric.key]), 1)})),
  };
}

async function selectEvents() {
  const currentRequest = ++eventRequestNumber;
  const options = [...byId('event-options').querySelectorAll('input')];
  const files = options.filter(option => option.checked).map(option => option.value);
  byId('event-all').checked = files.length > 0 && files.length === options.length;
  byId('event-all').indeterminate = files.length > 0 && files.length < options.length;
  index = null;
  byId('player-list').replaceChildren();
  byId('no-results').hidden = true;
  byId('search').disabled = true;
  byId('player-content').hidden = true;
  byId('player-status').textContent = '正在读取赛事数据…';
  document.querySelector('.detail-panel').setAttribute('aria-busy', 'true');
  try {
    if (!files.length) {
      byId('player-status').textContent = '请勾选至少一个赛事。';
      return;
    }
    const summaries = files.length === options.length
      ? [allEvents]
      : await Promise.all(files.map(file => readJson(`data/${file}`)));
    if (currentRequest !== eventRequestNumber) return;
    index = mergeEvents(summaries);
    if (!index.players.length) throw new Error('所选赛事没有玩家记录');
    const player = index.players.find(entry => entry.id === selectedId) || index.players[0];
    selectedId = player.id;
    byId('search').value = '';
    renderPlayers();
    selectPlayer(player);
  } catch (error) {
    if (currentRequest !== eventRequestNumber) return;
    byId('player-status').textContent = `无法读取赛事数据（${error.message}）。请重新选择赛事或刷新页面。`;
  } finally {
    if (currentRequest === eventRequestNumber) {
      byId('search').disabled = !index;
      document.querySelector('.detail-panel').setAttribute('aria-busy', 'false');
    }
  }
}

async function init() {
  try {
    allEvents = await readJson('data/index.json');
    if (!allEvents.players?.length) throw new Error('没有玩家记录');
    if (!allEvents.events?.length) throw new Error('请重新运行“生成数据.bat”更新赛事数据');
    for (const event of allEvents.events || []) {
      const label = element('label', 'event-option');
      const option = element('input');
      option.type = 'checkbox';
      option.value = event.file;
      option.checked = true;
      label.append(option, element('span', '', event.name));
      byId('event-options').append(label);
    }
    byId('dashboard').hidden = false;
    byId('event-options').addEventListener('change', selectEvents);
    byId('event-all').addEventListener('change', () => {
      byId('event-options').querySelectorAll('input').forEach(option => { option.checked = byId('event-all').checked; });
      selectEvents();
    });
    byId('search').addEventListener('input', renderPlayers);
    byId('comparison-target').addEventListener('change', () => {
      if (!index) return;
      comparisonId = byId('comparison-target').value;
      renderComparison(index.players.find(player => player.id === selectedId));
    });
    await selectEvents();
  } catch (error) {
    byId('status').hidden = false;
    byId('status').textContent = location.protocol === 'file:'
      ? '请通过网站或本地开发服务器打开此页，直接双击 HTML 无法读取 JSON 数据。'
      : `无法加载对局数据（${error.message}）。请将 data.xlsx 放入 wxq 文件夹，双击“生成数据.bat”后刷新页面。`;
  }
}

init();
