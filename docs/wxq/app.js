const byId = id => document.getElementById(id);
const format = value => Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let index;
let selectedId;
let requestNumber = 0;

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

function drawRadar(player) {
  const chart = byId('radar');
  chart.replaceChildren(
    svgNode('title', { id: 'radar-title' }, `${player.id}与所有玩家的平均数据对比`),
    svgNode('desc', { id: 'radar-description' }, '绿色实线代表该玩家，黄色实线代表所有玩家。真实均值见平均数据表。')
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
    [index.overall, '#f5d45c', '所有玩家'],
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

async function selectPlayer(entry) {
  selectedId = entry.id;
  const currentRequest = ++requestNumber;
  document.querySelectorAll('.player-button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.id === selectedId)));
  const panel = document.querySelector('.detail-panel');
  panel.setAttribute('aria-busy', 'true');
  byId('player-content').hidden = true;
  byId('player-status').textContent = `正在读取 ${entry.id} 的数据…`;
  try {
    const player = await readJson(`data/${entry.file}`);
    if (currentRequest !== requestNumber) return;
    byId('player-name').textContent = player.id;
    byId('average-rank').textContent = format(player.averages.rank);
    byId('match-count').textContent = player.matchCount;
    const rows = index.metrics.map(metric => {
      const row = element('tr');
      row.append(element('td', '', metric.label), element('td', '', format(player.averages[metric.key])), element('td', '', format(index.overall[metric.key])));
      return row;
    });
    byId('averages').replaceChildren(...rows);
    drawRadar(player);
    byId('player-content').hidden = false;
    byId('player-status').textContent = '';
  } catch (error) {
    if (currentRequest !== requestNumber) return;
    byId('player-status').textContent = `无法读取该玩家的数据（${error.message}）。请重新生成数据，或点击该玩家重试。`;
  } finally {
    if (currentRequest === requestNumber) panel.setAttribute('aria-busy', 'false');
  }
}

async function init() {
  try {
    index = await readJson('data/index.json');
    if (!index.players?.length) throw new Error('没有玩家记录');
    byId('dashboard').hidden = false;
    selectedId = index.players[0].id;
    renderPlayers();
    byId('search').addEventListener('input', renderPlayers);
    await selectPlayer(index.players[0]);
  } catch (error) {
    byId('status').hidden = false;
    byId('status').textContent = location.protocol === 'file:'
      ? '请通过网站或本地开发服务器打开此页，直接双击 HTML 无法读取 JSON 数据。'
      : `无法加载对局数据（${error.message}）。请将 data.xlsx 放入 wxq 文件夹，双击“生成数据.bat”后刷新页面。`;
  }
}

init();
