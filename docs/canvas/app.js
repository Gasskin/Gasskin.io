"use strict";

const NODE_WIDTH = 800;
const NODE_HEIGHT = NODE_WIDTH * 9 / 16;
const CONNECTION_SNAP_RADIUS = 44;
const MIN_SCALE = 0.05;
const MAX_SCALE = 32;
const ZOOM_STEP = 1.2;
const KIE_SETTINGS_STORAGE_KEY = "canvas:kie-settings:v1";
const KIE_DEFAULT_BASE_URL = "https://api.kie.ai";
const KIE_CREATE_TASK_PATH = "api/v1/jobs/createTask";
const KIE_TASK_DETAILS_PATH = "api/v1/jobs/recordInfo";
const KIE_POLL_INTERVAL_MS = 2000;
const KIE_POLL_TIMEOUT_MS = 15 * 60 * 1000;
const KIE_TEXT_MODEL = "gpt-image-2-text-to-image";
const KIE_IMAGE_MODEL = "gpt-image-2-image-to-image";
const KIE_RATIOS = Object.freeze([
  "auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5",
  "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21",
]);
const KIE_RESOLUTIONS = Object.freeze(["1K", "2K", "4K"]);

const viewport = document.getElementById("canvasViewport");
const panLayer = document.getElementById("canvasPanLayer");
const surface = document.getElementById("canvasSurface");
const emptyGuide = document.getElementById("emptyGuide");
const connectionLayer = document.getElementById("connectionLayer");
const connectionList = document.getElementById("connectionList");
const connectionDraft = document.getElementById("connectionDraft");
const selectionMarquee = document.getElementById("selectionMarquee");
const contextMenu = document.getElementById("contextMenu");
const createImageNodeButton = document.getElementById("createImageNodeButton");
const createTextNodeButton = document.getElementById("createTextNodeButton");
const createKieNodeButton = document.getElementById("createKieNodeButton");
const fitButton = document.getElementById("fitButton");
const settingsButton = document.getElementById("settingsButton");
const zoomOutButton = document.getElementById("zoomOutButton");
const zoomInButton = document.getElementById("zoomInButton");
const zoomResetButton = document.getElementById("zoomResetButton");
const dropOverlay = document.getElementById("dropOverlay");
const previewDialog = document.getElementById("previewDialog");
const previewImage = document.getElementById("previewImage");
const previewCaption = document.getElementById("previewCaption");
const previewCloseButton = document.getElementById("previewCloseButton");
const settingsDialog = document.getElementById("settingsDialog");
const settingsCloseButton = document.getElementById("settingsCloseButton");
const settingsCancelButton = document.getElementById("settingsCancelButton");
const settingsSaveButton = document.getElementById("settingsSaveButton");
const kieBaseUrl = document.getElementById("kieBaseUrl");
const kieApiKey = document.getElementById("kieApiKey");
const kieApiKeyClear = document.getElementById("kieApiKeyClear");
const settingsMessage = document.getElementById("settingsMessage");
const generationDetailsDialog = document.getElementById("generationDetailsDialog");
const generationDetailsTitle = document.getElementById("generationDetailsTitle");
const generationDetailsClose = document.getElementById("generationDetailsClose");
const generationDetailsSummary = document.getElementById("generationDetailsSummary");
const generationDetailsStatus = document.getElementById("generationDetailsStatus");
const generationDetailsElapsed = document.getElementById("generationDetailsElapsed");
const generationDetailsCodeLabel = document.getElementById("generationDetailsCodeLabel");
const generationDetailsTokenNote = document.getElementById("generationDetailsTokenNote");
const generationDetailsCode = document.getElementById("generationDetailsCode");

const view = { x: 0, y: 0, scale: 1 };
const nodes = new Map();
const connections = new Map();
let nodeSequence = 0;
let connectionSequence = 0;
let highestLayer = 1;
let selectedNodeId = null;
const selectedNodeIds = new Set();
let selectedConnectionId = null;
let contextCanvasPoint = { x: 0, y: 0 };
let dragDepth = 0;
let kieSettings = { baseUrl: KIE_DEFAULT_BASE_URL, apiKey: "" };
const supportsCssZoom = typeof CSS !== "undefined" && CSS.supports("zoom", "2");

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function joinApiUrl(baseUrl, path) {
  return `${cleanBaseUrl(baseUrl)}/${String(path || "").replace(/^\/+/, "")}`;
}

function updateSettingsButtonState() {
  settingsButton.classList.toggle("configured", Boolean(kieSettings.apiKey));
  settingsButton.title = kieSettings.apiKey ? "KIE 设置（已配置）" : "KIE 设置（尚未配置 API Key）";
}

function loadKieSettings() {
  try {
    const stored = window.localStorage.getItem(KIE_SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      kieSettings = {
        baseUrl: cleanBaseUrl(parsed?.baseUrl || KIE_DEFAULT_BASE_URL),
        apiKey: String(parsed?.apiKey || "").trim(),
      };
    }
  } catch {
    // Keep defaults when browser storage is unavailable or malformed.
  }
  updateSettingsButtonState();
}

function screenToCanvas(clientX, clientY) {
  const rect = viewport.getBoundingClientRect();
  return {
    x: (clientX - rect.left - view.x) / view.scale,
    y: (clientY - rect.top - view.y) / view.scale,
  };
}

function canvasCenter() {
  const rect = viewport.getBoundingClientRect();
  return screenToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function applyView() {
  panLayer.style.transform = `translate(${view.x}px, ${view.y}px)`;
  if (supportsCssZoom) {
    surface.style.zoom = String(view.scale);
    surface.style.transform = "none";
  } else {
    surface.style.zoom = "1";
    surface.style.transform = `scale(${view.scale})`;
  }
  viewport.style.setProperty("--grid-x", `${view.x}px`);
  viewport.style.setProperty("--grid-y", `${view.y}px`);
  viewport.style.setProperty("--grid-size", `${24 * view.scale}px`);
  zoomResetButton.textContent = `${Math.round(view.scale * 100)}%`;
}

function setScale(nextScale, clientX, clientY) {
  const rect = viewport.getBoundingClientRect();
  const anchorX = clientX ?? rect.left + rect.width / 2;
  const anchorY = clientY ?? rect.top + rect.height / 2;
  const canvasPoint = screenToCanvas(anchorX, anchorY);

  view.scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  view.x = anchorX - rect.left - canvasPoint.x * view.scale;
  view.y = anchorY - rect.top - canvasPoint.y * view.scale;
  applyView();
}

function resetView() {
  const rect = viewport.getBoundingClientRect();
  view.scale = 1;
  view.x = rect.width / 2;
  view.y = rect.height / 2;
  applyView();
}

function updateEmptyState() {
  emptyGuide.classList.toggle("hidden", nodes.size > 0);
}

function setSelectedNodes(ids, primaryId = null) {
  selectedNodeIds.clear();
  ids.forEach((id) => {
    if (nodes.has(id)) selectedNodeIds.add(id);
  });
  selectedNodeId = primaryId && selectedNodeIds.has(primaryId)
    ? primaryId
    : (selectedNodeIds.values().next().value || null);
  selectedConnectionId = null;
  connections.forEach((connection) => connection.group.classList.remove("selected"));
  nodes.forEach((node, nodeId) => {
    node.element.classList.toggle("selected", selectedNodeIds.has(nodeId));
  });
}

function selectNode(id, { additive = false, toggle = false } = {}) {
  const nextIds = additive ? new Set(selectedNodeIds) : new Set();
  if (id && nodes.has(id)) {
    if (toggle && nextIds.has(id)) nextIds.delete(id);
    else nextIds.add(id);
  }
  setSelectedNodes(nextIds, nextIds.has(id) ? id : null);
  if (id && selectedNodeIds.has(id)) {
    highestLayer += 1;
    nodes.get(id).element.style.zIndex = String(highestLayer);
  }
}

function selectConnection(id) {
  selectedConnectionId = id;
  selectedNodeId = null;
  selectedNodeIds.clear();
  nodes.forEach((node) => node.element.classList.remove("selected"));
  connections.forEach((connection, connectionId) => {
    connection.group.classList.toggle("selected", connectionId === id);
  });
}

function getPortPoint(node, side) {
  return {
    x: side === "input" ? node.x : node.x + node.width,
    y: node.y + node.height / 2,
  };
}

function makeConnectionPath(start, end) {
  const bend = Math.max(80, Math.abs(end.x - start.x) * 0.46);
  return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`;
}

function updateConnection(connection) {
  const source = nodes.get(connection.fromNodeId);
  const target = nodes.get(connection.toNodeId);
  if (!source || !target) return;
  const path = makeConnectionPath(getPortPoint(source, "output"), getPortPoint(target, "input"));
  connection.line.setAttribute("d", path);
  connection.hit.setAttribute("d", path);
}

function updateConnectionsForNode(nodeId) {
  connections.forEach((connection) => {
    if (connection.fromNodeId === nodeId || connection.toNodeId === nodeId) updateConnection(connection);
  });
}

function refreshPortStates() {
  nodes.forEach((node) => {
    node.inputPort?.classList.toggle(
      "connected",
      Array.from(connections.values()).some((connection) => connection.toNodeId === node.id),
    );
    node.outputPort?.classList.toggle(
      "connected",
      Array.from(connections.values()).some((connection) => connection.fromNodeId === node.id),
    );
  });
}

function isKieNode(node) {
  return node?.type === "kie";
}

function getConnectedImageNodes(targetNode) {
  const seen = new Set();
  return Array.from(connections.values())
    .filter((connection) => connection.toNodeId === targetNode.id)
    .map((connection) => nodes.get(connection.fromNodeId))
    .filter((node) => {
      if (node?.type !== "image" || !node.objectUrl || seen.has(node.id)) return false;
      seen.add(node.id);
      return true;
    });
}

function getConnectedTextNodes(targetNode) {
  const seen = new Set();
  return Array.from(connections.values())
    .filter((connection) => connection.toNodeId === targetNode.id)
    .map((connection) => nodes.get(connection.fromNodeId))
    .filter((node) => {
      if (node?.type !== "text" || !node.textInput || seen.has(node.id)) return false;
      seen.add(node.id);
      return true;
    });
}

function syncKiePromptFromTextNodes(node, textSources) {
  const linked = textSources.length > 0;
  if (linked) {
    if (!node.prompt.readOnly) node.localPromptValue = node.prompt.value;
    node.prompt.value = textSources.map((source) => source.textInput.value).join("\n\n");
  } else if (node.prompt.readOnly) {
    node.prompt.value = node.localPromptValue || "";
  }
  node.prompt.readOnly = linked;
  node.prompt.classList.toggle("linked-text", linked);
  node.prompt.placeholder = linked
    ? "提示词由已连接的文本节点提供。"
    : "输入图片生成提示词；连接图片后自动切换为图生图。";
}

function setKieStatus(node, message, state = "") {
  node.status.textContent = message;
  node.status.title = message;
  node.status.className = `kie-status${state ? ` ${state}` : ""}`;
}

function refreshKieInput(node) {
  if (!isKieNode(node)) return;
  const imageSources = getConnectedImageNodes(node);
  const textSources = getConnectedTextNodes(node);
  syncKiePromptFromTextNodes(node, textSources);
  node.model.value = imageSources.length ? KIE_IMAGE_MODEL : KIE_TEXT_MODEL;
  node.inputPreview.replaceChildren();

  if (imageSources.length) {
    imageSources.forEach((source, index) => {
      const thumbnail = document.createElement("button");
      thumbnail.type = "button";
      thumbnail.className = "kie-input-thumb";
      thumbnail.title = `输入图片 ${index + 1}：${source.name}`;
      const image = document.createElement("img");
      image.src = source.objectUrl;
      image.alt = source.name;
      image.draggable = false;
      const number = document.createElement("span");
      number.textContent = String(index + 1);
      thumbnail.append(image, number);
      thumbnail.addEventListener("click", (event) => {
        event.stopPropagation();
        openPreview(source);
      });
      node.inputPreview.appendChild(thumbnail);
    });
  } else {
    const empty = document.createElement("span");
    empty.className = "kie-input-empty";
    empty.innerHTML = "<span>↦</span><strong>文生图模式</strong><small>连接图片后切换为图生图</small>";
    node.inputPreview.appendChild(empty);
  }

  if (!node.generateButton.disabled) {
    const mode = imageSources.length ? `图生图 · ${imageSources.length} 张图片` : "文生图";
    const textInfo = textSources.length ? ` · ${textSources.length} 个文本节点` : "";
    const hasLocalImage = imageSources.some((source) => !/^https?:\/\//i.test(source.objectUrl || ""));
    setKieStatus(
      node,
      `${mode}${textInfo}${hasLocalImage ? " · 含无法提交的本地图片" : ""}`,
      hasLocalImage ? "error" : "",
    );
  }
}

function refreshNodeInput(nodeId) {
  const node = nodes.get(nodeId);
  if (isKieNode(node)) refreshKieInput(node);
}

function refreshConsumers(sourceNodeId) {
  connections.forEach((connection) => {
    if (connection.fromNodeId === sourceNodeId) refreshNodeInput(connection.toNodeId);
  });
}

function removeConnection(id) {
  const connection = connections.get(id);
  if (!connection) return;
  connection.group.remove();
  connections.delete(id);
  if (selectedConnectionId === id) selectedConnectionId = null;
  refreshPortStates();
  refreshNodeInput(connection.toNodeId);
}

function connectNodes(fromNodeId, toNodeId) {
  if (fromNodeId === toNodeId || !nodes.has(fromNodeId) || !nodes.has(toNodeId)) return;
  const duplicate = Array.from(connections.values()).some(
    (connection) => connection.fromNodeId === fromNodeId && connection.toNodeId === toNodeId,
  );
  if (duplicate) return;

  connectionSequence += 1;
  const id = `connection-${connectionSequence}`;
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.classList.add("connection-group");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
  line.classList.add("connection-line");
  const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
  hit.classList.add("connection-hit");
  hit.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    selectConnection(id);
  });
  group.append(line, hit);
  connectionList.appendChild(group);

  const connection = { id, fromNodeId, toNodeId, group, line, hit };
  connections.set(id, connection);
  updateConnection(connection);
  refreshPortStates();
  refreshNodeInput(toNodeId);
}

function findConnectionTarget(clientX, clientY, sourceNodeIds) {
  const rect = viewport.getBoundingClientRect();
  const excludedIds = sourceNodeIds instanceof Set ? sourceNodeIds : new Set([sourceNodeIds]);
  let nearest = null;
  let nearestDistance = CONNECTION_SNAP_RADIUS;

  nodes.forEach((candidate) => {
    if (excludedIds.has(candidate.id)) return;
    const point = getPortPoint(candidate, "input");
    const screenX = rect.left + view.x + point.x * view.scale;
    const screenY = rect.top + view.y + point.y * view.scale;
    const distance = Math.hypot(clientX - screenX, clientY - screenY);
    if (distance <= nearestDistance) {
      nearestDistance = distance;
      nearest = { node: candidate, point };
    }
  });
  return nearest;
}

function startConnectionDrag(node, event) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  if (!selectedNodeIds.has(node.id)) selectNode(node.id);
  const sourceNodeIds = node.type === "image"
    ? new Set(Array.from(selectedNodeIds).filter((id) => nodes.get(id)?.type === "image"))
    : new Set([node.id]);
  if (!sourceNodeIds.size) sourceNodeIds.add(node.id);
  const start = getPortPoint(node, "output");
  nodes.forEach((candidate) => {
    if (!sourceNodeIds.has(candidate.id)) candidate.inputPort?.classList.add("compatible");
  });

  const onMove = (moveEvent) => {
    nodes.forEach((candidate) => candidate.inputPort?.classList.remove("snap-target"));
    const target = findConnectionTarget(moveEvent.clientX, moveEvent.clientY, sourceNodeIds);
    if (target) target.node.inputPort?.classList.add("snap-target");
    const end = target?.point || screenToCanvas(moveEvent.clientX, moveEvent.clientY);
    connectionDraft.setAttribute("d", makeConnectionPath(start, end));
  };
  const onUp = (upEvent) => {
    const target = findConnectionTarget(upEvent.clientX, upEvent.clientY, sourceNodeIds);
    if (target) {
      if (sourceNodeIds.size > 1 && isKieNode(target.node)) {
        sourceNodeIds.forEach((sourceNodeId) => connectNodes(sourceNodeId, target.node.id));
      } else {
        connectNodes(node.id, target.node.id);
      }
    }
    connectionDraft.setAttribute("d", "");
    nodes.forEach((candidate) => candidate.inputPort?.classList.remove("compatible", "snap-target"));
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

function attachConnectionPorts(node) {
  const input = document.createElement("button");
  input.type = "button";
  input.className = "node-port input";
  input.dataset.nodeId = node.id;
  input.title = "输入连接点";
  input.setAttribute("aria-label", `${node.name}输入连接点`);

  const output = document.createElement("button");
  output.type = "button";
  output.className = "node-port output";
  output.dataset.nodeId = node.id;
  output.title = "拖动以连接到其他节点";
  output.setAttribute("aria-label", `${node.name}输出连接点`);
  output.addEventListener("pointerdown", (event) => startConnectionDrag(node, event));

  node.inputPort = input;
  node.outputPort = output;
  node.element.append(input, output);
}

function removeNode(id) {
  const node = nodes.get(id);
  if (!node) return;
  Array.from(connections.values())
    .filter((connection) => connection.fromNodeId === id || connection.toNodeId === id)
    .forEach((connection) => removeConnection(connection.id));
  if (node.objectUrl && node.revokeObjectUrl) URL.revokeObjectURL(node.objectUrl);
  if (node.timerId) window.clearInterval(node.timerId);
  node.abortController?.abort();
  node.element.remove();
  nodes.delete(id);
  selectedNodeIds.delete(id);
  if (selectedNodeId === id) selectedNodeId = selectedNodeIds.values().next().value || null;
  updateEmptyState();
}

function removeNodeOrSelection(id) {
  const ids = selectedNodeIds.has(id) && selectedNodeIds.size > 1
    ? Array.from(selectedNodeIds)
    : [id];
  ids.forEach((nodeId) => removeNode(nodeId));
}

function openPreviewSource(src, name) {
  if (!src) return;
  previewImage.src = src;
  previewImage.alt = `${name} 预览`;
  previewCaption.textContent = name;
  previewDialog.showModal();
}

function openPreview(node) {
  openPreviewSource(node.objectUrl, node.name);
}

function setNodeImageSource(node, { src, name, file = null, revokeOnRemove = false }) {
  if (!src) return;
  if (node.objectUrl && node.revokeObjectUrl) URL.revokeObjectURL(node.objectUrl);

  node.file = file;
  node.objectUrl = src;
  node.revokeObjectUrl = revokeOnRemove;
  node.name = name || file?.name || "未命名图片";
  node.title.textContent = node.name;
  node.body.replaceChildren();

  const image = document.createElement("img");
  image.className = "node-image";
  image.src = node.objectUrl;
  image.alt = node.name;
  image.draggable = false;
  image.title = "点击预览图片";
  image.addEventListener("click", (event) => {
    event.stopPropagation();
    if (node.wasDragged) return;
    selectNode(node.id);
    openPreview(node);
  });
  node.body.appendChild(image);
  refreshConsumers(node.id);
}

function setNodeImage(node, file) {
  if (!file || !file.type.startsWith("image/")) return;
  setNodeImageSource(node, {
    src: URL.createObjectURL(file),
    name: file.name,
    file,
    revokeOnRemove: true,
  });
}

function attachNodeDrag(node) {
  node.element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button, input, textarea, select, option")) return;
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey) {
      selectNode(node.id, { additive: true, toggle: true });
      if (!selectedNodeIds.has(node.id)) return;
    } else if (event.shiftKey) {
      selectNode(node.id, { additive: true });
    } else if (!selectedNodeIds.has(node.id)) {
      selectNode(node.id);
    }

    const start = screenToCanvas(event.clientX, event.clientY);
    const draggedNodes = Array.from(selectedNodeIds).map((id) => nodes.get(id)).filter(Boolean);
    const origins = new Map(draggedNodes.map((selectedNode) => (
      [selectedNode.id, { x: selectedNode.x, y: selectedNode.y }]
    )));
    let moved = false;

    const onMove = (moveEvent) => {
      if (!moved && Math.hypot(moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY) > 3) {
        moved = true;
        node.wasDragged = true;
        draggedNodes.forEach((selectedNode) => selectedNode.element.classList.add("dragging"));
      }
      if (!moved) return;
      moveEvent.preventDefault();
      const point = screenToCanvas(moveEvent.clientX, moveEvent.clientY);
      const deltaX = point.x - start.x;
      const deltaY = point.y - start.y;
      draggedNodes.forEach((selectedNode) => {
        const origin = origins.get(selectedNode.id);
        selectedNode.x = origin.x + deltaX;
        selectedNode.y = origin.y + deltaY;
        selectedNode.element.style.left = `${selectedNode.x}px`;
        selectedNode.element.style.top = `${selectedNode.y}px`;
        updateConnectionsForNode(selectedNode.id);
      });
    };

    const onUp = () => {
      draggedNodes.forEach((selectedNode) => selectedNode.element.classList.remove("dragging"));
      window.setTimeout(() => { node.wasDragged = false; }, 0);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
}

function createImageNode({ x, y, file = null, source = null, openPicker = false } = {}) {
  nodeSequence += 1;
  const id = `image-${nodeSequence}`;
  const center = canvasCenter();
  const node = {
    id,
    type: "image",
    x: Number.isFinite(x) ? x : center.x - NODE_WIDTH / 2,
    y: Number.isFinite(y) ? y : center.y - NODE_HEIGHT / 2,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    name: source?.name || file?.name || `图片节点 ${nodeSequence}`,
    file: null,
    objectUrl: null,
    revokeObjectUrl: false,
    wasDragged: false,
    element: document.createElement("article"),
    title: document.createElement("span"),
    body: document.createElement("div"),
  };

  node.element.className = "canvas-node image-node";
  node.element.dataset.nodeId = id;
  node.element.style.left = `${node.x}px`;
  node.element.style.top = `${node.y}px`;
  node.element.style.zIndex = String(++highestLayer);
  node.element.setAttribute("aria-label", node.name);

  const header = document.createElement("header");
  header.className = "node-header";
  const titleWrap = document.createElement("div");
  titleWrap.className = "node-title";
  const typeDot = document.createElement("span");
  typeDot.className = "node-type-dot";
  node.title.className = "node-title-text";
  node.title.textContent = node.name;
  titleWrap.append(typeDot, node.title);

  const deleteButton = document.createElement("button");
  deleteButton.className = "node-delete";
  deleteButton.type = "button";
  deleteButton.textContent = "×";
  deleteButton.title = "删除节点（多选时批量删除）";
  deleteButton.setAttribute("aria-label", `删除${node.name}`);
  deleteButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    removeNodeOrSelection(id);
  });

  const headerActions = document.createElement("div");
  headerActions.className = "node-header-actions";
  headerActions.appendChild(deleteButton);
  header.append(titleWrap, headerActions);

  node.body.className = "node-body";
  const placeholder = document.createElement("button");
  placeholder.className = "node-placeholder";
  placeholder.type = "button";
  placeholder.innerHTML = `
    <span class="placeholder-icon" aria-hidden="true">＋</span>
    <strong>点击上传图片</strong>
    <small>图片将按原始比例完整显示</small>
  `;

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.hidden = true;
  input.addEventListener("change", () => {
    const selectedFile = input.files?.[0];
    if (selectedFile) setNodeImage(node, selectedFile);
    input.value = "";
  });
  placeholder.addEventListener("click", (event) => {
    event.stopPropagation();
    selectNode(id);
    input.click();
  });
  node.body.append(placeholder, input);
  node.element.append(header, node.body);
  attachConnectionPorts(node);
  attachNodeDrag(node);
  surface.appendChild(node.element);
  nodes.set(id, node);
  selectNode(id);
  updateEmptyState();

  if (file) setNodeImage(node, file);
  if (source) setNodeImageSource(node, source);
  if (openPicker) window.setTimeout(() => input.click(), 0);
  return node;
}

function createTextNode({ x, y, text = "" } = {}) {
  nodeSequence += 1;
  const id = `text-${nodeSequence}`;
  const center = canvasCenter();
  const node = {
    id,
    type: "text",
    x: Number.isFinite(x) ? x : center.x - NODE_WIDTH / 2,
    y: Number.isFinite(y) ? y : center.y - NODE_HEIGHT / 2,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    name: `文本节点 ${nodeSequence}`,
    wasDragged: false,
    element: document.createElement("article"),
    title: document.createElement("span"),
    body: document.createElement("div"),
  };

  node.element.className = "canvas-node text-node";
  node.element.dataset.nodeId = id;
  node.element.style.left = `${node.x}px`;
  node.element.style.top = `${node.y}px`;
  node.element.style.zIndex = String(++highestLayer);
  node.element.setAttribute("aria-label", node.name);

  const header = document.createElement("header");
  header.className = "node-header";
  const titleWrap = document.createElement("div");
  titleWrap.className = "node-title";
  const typeDot = document.createElement("span");
  typeDot.className = "node-type-dot";
  node.title.className = "node-title-text";
  node.title.textContent = node.name;
  titleWrap.append(typeDot, node.title);

  const deleteButton = document.createElement("button");
  deleteButton.className = "node-delete";
  deleteButton.type = "button";
  deleteButton.textContent = "×";
  deleteButton.title = "删除节点（多选时批量删除）";
  deleteButton.setAttribute("aria-label", `删除${node.name}`);
  deleteButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    removeNodeOrSelection(id);
  });

  const headerActions = document.createElement("div");
  headerActions.className = "node-header-actions";
  headerActions.appendChild(deleteButton);
  header.append(titleWrap, headerActions);

  node.body.className = "node-body text-node-body";
  const contentHeader = document.createElement("div");
  contentHeader.className = "text-node-content-header";
  const contentTitle = document.createElement("strong");
  contentTitle.textContent = "文本内容";
  const dragHint = document.createElement("span");
  dragHint.textContent = "拖动此处移动节点";
  contentHeader.append(contentTitle, dragHint);
  node.textInput = document.createElement("textarea");
  node.textInput.className = "text-node-input";
  node.textInput.value = text;
  node.textInput.placeholder = "在这里输入文本。连接到生图节点后，文本会作为生成提示词的一部分。";
  node.textInput.setAttribute("aria-label", `${node.name}文本内容`);
  node.textInput.spellcheck = true;
  node.textInput.addEventListener("pointerdown", () => {
    if (!selectedNodeIds.has(id)) selectNode(id);
  });
  node.textInput.addEventListener("input", () => refreshConsumers(id));
  node.textInput.addEventListener("wheel", (event) => event.stopPropagation());
  node.body.append(contentHeader, node.textInput);

  node.element.append(header, node.body);
  attachConnectionPorts(node);
  attachNodeDrag(node);
  surface.appendChild(node.element);
  nodes.set(id, node);
  selectNode(id);
  updateEmptyState();
  window.setTimeout(() => node.textInput.focus(), 0);
  return node;
}

function formatGenerationElapsed(milliseconds) {
  return `${Math.floor(Math.max(0, milliseconds) / 1000)} 秒`;
}

function quoteShellArgument(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function buildGenerationCurl(callDetails) {
  if (!callDetails?.endpoint) return "暂无调用信息";
  return [
    `curl -X POST ${quoteShellArgument(callDetails.endpoint)}`,
    `  -H ${quoteShellArgument("Authorization: Bearer ***")}`,
    `  -H ${quoteShellArgument("Content-Type: application/json")}`,
    `  --data-raw ${quoteShellArgument(JSON.stringify(callDetails.body || {}, null, 2))}`,
  ].join(" \\\n");
}

function getKiePrompt(node, textSources) {
  return textSources.length
    ? textSources.map((source) => source.textInput.value.trim()).filter(Boolean).join("\n\n")
    : node.prompt.value.trim();
}

function buildKieRequest(node, imageSources, textSources) {
  const isImageToImage = imageSources.length > 0;
  const input = {
    prompt: getKiePrompt(node, textSources),
    aspect_ratio: node.aspectRatio.value,
    resolution: node.resolution.value,
  };
  if (isImageToImage) input.input_urls = imageSources.map((source) => source.objectUrl);
  return {
    model: isImageToImage ? KIE_IMAGE_MODEL : KIE_TEXT_MODEL,
    input,
  };
}

function buildKieCallPreview(node) {
  const imageSources = getConnectedImageNodes(node);
  const textSources = getConnectedTextNodes(node);
  return {
    endpoint: joinApiUrl(kieSettings.baseUrl, KIE_CREATE_TASK_PATH),
    body: buildKieRequest(node, imageSources, textSources),
  };
}

function openGenerationDetails(node, errorOnly = false, preview = false) {
  const callDetails = preview ? buildKieCallPreview(node) : node.callDetails;
  generationDetailsTitle.textContent = errorOnly ? "错误信息" : preview ? "调用预览" : "调用详情";
  generationDetailsCodeLabel.textContent = errorOnly ? "错误内容" : "cURL";
  generationDetailsSummary.hidden = preview;
  generationDetailsTokenNote.hidden = errorOnly;
  generationDetailsStatus.textContent = preview ? "尚未调用" : (node.callStatus || "—");
  generationDetailsElapsed.textContent = preview
    ? "—"
    : node.elapsedMs == null
      ? formatGenerationElapsed(performance.now() - node.startedAt)
      : formatGenerationElapsed(node.elapsedMs);
  generationDetailsCode.textContent = errorOnly
    ? (node.lastError || "无错误信息")
    : buildGenerationCurl(callDetails);
  generationDetailsDialog.showModal();
}

function setKieRunActions(node, { details = false, error = false } = {}) {
  node.detailsButton.classList.toggle("hidden", !details);
  node.errorButton.classList.toggle("hidden", !error);
}

function stopKieTimer(node) {
  if (node.timerId) window.clearInterval(node.timerId);
  node.timerId = null;
  node.elapsedMs = performance.now() - node.startedAt;
}

function createKieResults(node, urls) {
  urls.forEach((url, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const imageNode = createImageNode({
      x: node.x + node.width + 140 + column * (NODE_WIDTH + 100),
      y: node.y + row * (NODE_HEIGHT + 70),
      source: {
        src: url,
        name: `KIE 生成图片 ${index + 1}`,
        file: null,
        revokeOnRemove: false,
      },
    });
    connectNodes(node.id, imageNode.id);
  });
}

async function waitForKiePoll(signal) {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  await new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, KIE_POLL_INTERVAL_MS);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchKieJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  const apiFailed = Number.isFinite(Number(payload?.code))
    && Number(payload.code) !== 200
    && !(String(payload?.msg || "").toLowerCase() === "success" && payload?.data);
  if (!response.ok || apiFailed) {
    throw new Error(payload?.msg || text || `${response.status} ${response.statusText}`);
  }
  return payload;
}

function extractKieTaskId(payload) {
  return String(payload?.data?.taskId || payload?.taskId || "").trim();
}

function extractKieResultUrls(payload) {
  let result = payload?.data?.resultJson;
  if (typeof result === "string") {
    try { result = JSON.parse(result); } catch { result = null; }
  }
  return Array.isArray(result?.resultUrls)
    ? result.resultUrls.map((url) => String(url || "").trim()).filter(Boolean)
    : [];
}

async function pollKieTask(node, taskId, requestConfig) {
  const endpoint = joinApiUrl(requestConfig.baseUrl, KIE_TASK_DETAILS_PATH);
  const queryEndpoint = `${endpoint}?taskId=${encodeURIComponent(taskId)}`;

  while (true) {
    if (performance.now() - node.startedAt > KIE_POLL_TIMEOUT_MS) {
      throw new Error("任务查询超时，请稍后通过任务 ID 查询结果。");
    }
    const payload = await fetchKieJson(queryEndpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${requestConfig.apiKey}` },
      signal: node.abortController.signal,
    });
    const state = String(payload?.data?.state || "unknown").toLowerCase();
    node.progressLabel = state === "generating" ? "生成中" : `任务 ${state}`;
    node.callDetails.task = { id: taskId, state, query_endpoint: queryEndpoint };

    if (state === "success") return { payload, urls: extractKieResultUrls(payload) };
    if (state === "fail") {
      throw new Error(payload?.data?.failMsg || payload?.msg || "KIE 图片生成任务失败。");
    }
    await waitForKiePoll(node.abortController.signal);
  }
}

function validateKieRequest(node, imageSources, prompt) {
  if (!prompt) return "请在本节点或已连接的文本节点中填写提示词。";
  if (prompt.length > 20000) return "提示词不能超过 20,000 个字符。";
  if (imageSources.length > 16) return "KIE 图生图最多支持 16 张输入图片。";
  if (imageSources.some((source) => !/^https?:\/\//i.test(source.objectUrl || ""))) {
    return "KIE 图生图只接受公网图片 URL；本地上传图片无法直接提交。";
  }

  const ratio = node.aspectRatio.value;
  const resolution = node.resolution.value;
  if (ratio === "auto" && resolution !== "1K") return "自动比例仅支持 1K 分辨率。";
  if (ratio === "1:1" && resolution === "4K") return "1:1 比例不支持 4K 分辨率。";
  if (imageSources.length && ["5:4", "4:5"].includes(ratio) && resolution !== "1K") {
    return `${ratio} 图生图仅支持 1K 分辨率。`;
  }
  if (!imageSources.length && resolution !== "1K" && ["5:4", "4:5", "3:1", "1:3", "9:21"].includes(ratio)) {
    return `${ratio} 文生图不支持 ${resolution} 分辨率。`;
  }
  return "";
}

async function generateWithKie(node) {
  const imageSources = getConnectedImageNodes(node);
  const textSources = getConnectedTextNodes(node);
  const prompt = getKiePrompt(node, textSources);
  const validationError = validateKieRequest(node, imageSources, prompt);
  if (validationError) {
    setKieStatus(node, validationError, "error");
    return;
  }
  if (!kieSettings.apiKey) {
    setKieStatus(node, "请先配置 KIE API Key。", "error");
    openSettings();
    return;
  }

  node.generateButton.disabled = true;
  node.abortController?.abort();
  node.abortController = new AbortController();
  const requestConfig = { ...kieSettings };
  const endpoint = joinApiUrl(requestConfig.baseUrl, KIE_CREATE_TASK_PATH);
  const requestBody = buildKieRequest(node, imageSources, textSources);

  node.startedAt = performance.now();
  node.elapsedMs = null;
  node.callStatus = "提交中";
  node.lastError = "";
  node.progressLabel = "正在提交任务";
  node.callDetails = { endpoint, body: requestBody };
  node.hasRun = true;
  node.detailsButton.textContent = "调用详情";
  setKieRunActions(node, { details: true });
  setKieStatus(node, "正在提交任务 · 0 秒");
  node.timerId = window.setInterval(() => {
    setKieStatus(node, `${node.progressLabel} · ${formatGenerationElapsed(performance.now() - node.startedAt)}`);
  }, 250);

  try {
    const submitPayload = await fetchKieJson(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requestConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: node.abortController.signal,
    });
    const taskId = extractKieTaskId(submitPayload);
    if (!taskId) throw new Error("KIE 创建任务接口未返回 taskId。");

    node.callDetails.submit_response = submitPayload;
    node.callStatus = "查询中";
    node.progressLabel = "任务已提交";
    const { payload, urls } = await pollKieTask(node, taskId, requestConfig);
    if (!urls.length) throw new Error("KIE 任务成功，但未返回图片 URL。");

    stopKieTimer(node);
    node.callStatus = "生成成功";
    node.callDetails.response = {
      state: payload?.data?.state || null,
      costTime: payload?.data?.costTime || null,
      creditsConsumed: payload?.data?.creditsConsumed || null,
      resultUrls: urls,
    };
    setKieStatus(node, `生成完成 · ${formatGenerationElapsed(node.elapsedMs)}`, "done");
    setKieRunActions(node, { details: true });
    if (nodes.has(node.id)) createKieResults(node, urls);
  } catch (error) {
    stopKieTimer(node);
    const failureMessage = error?.name === "AbortError"
      ? "生成已停止。"
      : error instanceof TypeError
        ? "请求失败，请检查网络、Base URL 或 CORS 设置。"
        : (error.message || String(error));
    node.callStatus = "生成失败";
    node.lastError = failureMessage;
    node.callDetails = { ...node.callDetails, error: failureMessage };
    setKieStatus(node, `生成失败 · ${formatGenerationElapsed(node.elapsedMs)}`, "error");
    setKieRunActions(node, { details: true, error: true });
  } finally {
    node.generateButton.disabled = false;
    node.abortController = null;
  }
}

function cloneKieNode(node) {
  const inputSourceIds = Array.from(connections.values())
    .filter((connection) => connection.toNodeId === node.id)
    .map((connection) => connection.fromNodeId);
  const clone = createKieNode({ x: node.x + 52, y: node.y + 52 });
  clone.localPromptValue = node.localPromptValue ?? (node.prompt.readOnly ? "" : node.prompt.value);
  clone.prompt.value = clone.localPromptValue;
  clone.resolution.value = node.resolution.value;
  clone.aspectRatio.value = node.aspectRatio.value;
  inputSourceIds.forEach((sourceNodeId) => connectNodes(sourceNodeId, clone.id));
  selectNode(clone.id);
  return clone;
}

function createKieNode({ x, y } = {}) {
  nodeSequence += 1;
  const id = `kie-${nodeSequence}`;
  const center = canvasCenter();
  const node = {
    id,
    type: "kie",
    x: Number.isFinite(x) ? x : center.x - NODE_WIDTH / 2,
    y: Number.isFinite(y) ? y : center.y - NODE_HEIGHT / 2,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    name: `KIE Image2 ${nodeSequence}`,
    wasDragged: false,
    element: document.createElement("article"),
    title: document.createElement("span"),
    body: document.createElement("div"),
  };

  node.element.className = "canvas-node kie-node";
  node.element.dataset.nodeId = id;
  node.element.style.left = `${node.x}px`;
  node.element.style.top = `${node.y}px`;
  node.element.style.zIndex = String(++highestLayer);
  node.element.setAttribute("aria-label", node.name);

  const header = document.createElement("header");
  header.className = "node-header";
  const titleWrap = document.createElement("div");
  titleWrap.className = "node-title";
  const typeDot = document.createElement("span");
  typeDot.className = "node-type-dot";
  node.title.className = "node-title-text";
  node.title.textContent = node.name;
  titleWrap.append(typeDot, node.title);

  const cloneButton = document.createElement("button");
  cloneButton.className = "node-tool-button";
  cloneButton.type = "button";
  cloneButton.textContent = "克隆";
  cloneButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  cloneButton.addEventListener("click", (event) => {
    event.stopPropagation();
    cloneKieNode(node);
  });
  const deleteButton = document.createElement("button");
  deleteButton.className = "node-delete";
  deleteButton.type = "button";
  deleteButton.textContent = "×";
  deleteButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    removeNodeOrSelection(id);
  });
  const headerActions = document.createElement("div");
  headerActions.className = "node-header-actions";
  headerActions.append(cloneButton, deleteButton);
  header.append(titleWrap, headerActions);

  const ratioOptions = KIE_RATIOS.map((ratio) => `<option value="${ratio}">${ratio}</option>`).join("");
  const resolutionOptions = KIE_RESOLUTIONS.map((resolution) => `<option value="${resolution}">${resolution}</option>`).join("");
  node.body.className = "node-body kie-body";
  node.body.innerHTML = `
    <div class="kie-input-preview" aria-label="输入图片预览"></div>
    <textarea class="kie-prompt" maxlength="20000" placeholder="输入图片生成提示词；连接图片后自动切换为图生图。" aria-label="KIE 提示词"></textarea>
    <div class="kie-config">
      <label class="kie-field wide">模型<input class="kie-model" type="text" disabled /></label>
      <label class="kie-field">分辨率<select class="kie-resolution">${resolutionOptions}</select></label>
      <label class="kie-field">图片比例<select class="kie-aspect">${ratioOptions}</select></label>
    </div>
    <div class="kie-generate-row">
      <div class="kie-run-summary">
        <span class="kie-status">文生图</span>
        <div class="kie-run-actions">
          <button class="kie-run-action kie-details" type="button">调用预览</button>
          <button class="kie-run-action kie-error-info hidden" type="button">错误信息</button>
        </div>
      </div>
      <button class="kie-generate" type="button">生成图片</button>
    </div>
  `;

  node.inputPreview = node.body.querySelector(".kie-input-preview");
  node.prompt = node.body.querySelector(".kie-prompt");
  node.localPromptValue = "";
  node.model = node.body.querySelector(".kie-model");
  node.resolution = node.body.querySelector(".kie-resolution");
  node.aspectRatio = node.body.querySelector(".kie-aspect");
  node.status = node.body.querySelector(".kie-status");
  node.detailsButton = node.body.querySelector(".kie-details");
  node.errorButton = node.body.querySelector(".kie-error-info");
  node.generateButton = node.body.querySelector(".kie-generate");
  node.prompt.addEventListener("input", () => {
    if (!node.prompt.readOnly) node.localPromptValue = node.prompt.value;
  });
  node.detailsButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openGenerationDetails(node, false, !node.hasRun);
  });
  node.errorButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openGenerationDetails(node, true);
  });
  node.generateButton.addEventListener("click", () => void generateWithKie(node));

  node.element.append(header, node.body);
  attachConnectionPorts(node);
  attachNodeDrag(node);
  surface.appendChild(node.element);
  nodes.set(id, node);
  refreshKieInput(node);
  selectNode(id);
  updateEmptyState();
  return node;
}

function createNodesFromFiles(files, origin) {
  const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
  imageFiles.forEach((file, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    createImageNode({
      x: origin.x + column * 38,
      y: origin.y + row * 38 + column * 24,
      file,
    });
  });
}

function fitToNodes() {
  if (!nodes.size) {
    resetView();
    return;
  }

  const values = Array.from(nodes.values());
  const minX = Math.min(...values.map((node) => node.x));
  const minY = Math.min(...values.map((node) => node.y));
  const maxX = Math.max(...values.map((node) => node.x + node.width));
  const maxY = Math.max(...values.map((node) => node.y + node.height));
  const boundsWidth = Math.max(1, maxX - minX);
  const boundsHeight = Math.max(1, maxY - minY);
  const rect = viewport.getBoundingClientRect();
  const padding = Math.min(180, rect.width * 0.16);

  view.scale = clamp(
    Math.min((rect.width - padding * 2) / boundsWidth, (rect.height - padding * 2) / boundsHeight, 1.5),
    MIN_SCALE,
    MAX_SCALE,
  );
  view.x = rect.width / 2 - ((minX + maxX) / 2) * view.scale;
  view.y = rect.height / 2 - ((minY + maxY) / 2) * view.scale;
  applyView();
}

function openSettings() {
  kieBaseUrl.value = kieSettings.baseUrl;
  kieApiKey.value = kieSettings.apiKey;
  settingsMessage.textContent = "";
  settingsDialog.showModal();
}

function closeSettings() {
  settingsDialog.close();
}

function saveSettings() {
  const baseUrl = cleanBaseUrl(kieBaseUrl.value);
  const apiKey = kieApiKey.value.trim();
  if (!baseUrl) {
    settingsMessage.textContent = "请输入 KIE Base URL。";
    kieBaseUrl.focus();
    return;
  }
  if (!apiKey) {
    settingsMessage.textContent = "请输入 KIE API Key。";
    kieApiKey.focus();
    return;
  }
  try {
    window.localStorage.setItem(KIE_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, baseUrl, apiKey }));
  } catch {
    settingsMessage.textContent = "浏览器本地存储不可用，设置未能保存。";
    return;
  }
  kieSettings = { baseUrl, apiKey };
  updateSettingsButtonState();
  closeSettings();
}

function hideContextMenu() {
  contextMenu.classList.remove("open");
  contextMenu.setAttribute("aria-hidden", "true");
}

function showContextMenu(clientX, clientY) {
  contextCanvasPoint = screenToCanvas(clientX, clientY);
  contextMenu.classList.add("open");
  contextMenu.setAttribute("aria-hidden", "false");

  const margin = 10;
  const width = contextMenu.offsetWidth;
  const height = contextMenu.offsetHeight;
  contextMenu.style.left = `${clamp(clientX, margin, window.innerWidth - width - margin)}px`;
  contextMenu.style.top = `${clamp(clientY, margin, window.innerHeight - height - margin)}px`;
  createImageNodeButton.focus();
}

viewport.addEventListener("wheel", (event) => {
  if (event.target instanceof Element && event.target.closest(".text-node-input, .kie-prompt")) return;
  event.preventDefault();
  hideContextMenu();
  const factor = Math.exp(-event.deltaY * 0.0012);
  setScale(view.scale * factor, event.clientX, event.clientY);
}, { passive: false });

viewport.addEventListener("pointerdown", (event) => {
  if (event.button === 1) {
    event.preventDefault();
    event.stopPropagation();
    hideContextMenu();
    const pointerId = event.pointerId;
    const start = { x: event.clientX, y: event.clientY };
    const origin = { x: view.x, y: view.y };
    let moved = false;
    let finished = false;

    try {
      viewport.setPointerCapture(pointerId);
    } catch {
      // Pointer capture is an enhancement; window-level listeners remain as fallback.
    }

    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      if (!moved && Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) > 3) {
        moved = true;
        hideContextMenu();
        viewport.classList.add("panning");
      }
      if (!moved) return;
      view.x = origin.x + moveEvent.clientX - start.x;
      view.y = origin.y + moveEvent.clientY - start.y;
      applyView();
    };

    const finishPan = (endEvent) => {
      if (finished || endEvent.pointerId !== pointerId) return;
      finished = true;
      if (endEvent.cancelable) endEvent.preventDefault();
      endEvent.stopPropagation();
      viewport.classList.remove("panning");
      try {
        if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
      } catch {
        // The browser may already have released capture during cancellation.
      }
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
    };

    const onUp = (upEvent) => finishPan(upEvent);
    const onCancel = (cancelEvent) => finishPan(cancelEvent);

    window.addEventListener("pointermove", onMove, { capture: true, passive: false });
    window.addEventListener("pointerup", onUp, { capture: true, passive: false });
    window.addEventListener("pointercancel", onCancel, { capture: true, passive: false });
    return;
  }

  if (event.button !== 0) return;
  const isBackground = event.target === viewport
    || event.target === panLayer
    || event.target === surface
    || event.target === connectionLayer
    || event.target === connectionList;
  if (!isBackground) return;
  event.preventDefault();
  event.stopPropagation();
  hideContextMenu();

  const viewportRect = viewport.getBoundingClientRect();
  const start = { x: event.clientX, y: event.clientY };
  const initialSelection = (event.shiftKey || event.ctrlKey || event.metaKey)
    ? new Set(selectedNodeIds)
    : new Set();
  let moved = false;

  const onMove = (moveEvent) => {
    moved = moved || Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) > 3;
    const currentX = clamp(moveEvent.clientX, viewportRect.left, viewportRect.right);
    const currentY = clamp(moveEvent.clientY, viewportRect.top, viewportRect.bottom);
    const left = Math.min(start.x, currentX);
    const top = Math.min(start.y, currentY);
    const right = Math.max(start.x, currentX);
    const bottom = Math.max(start.y, currentY);
    selectionMarquee.classList.toggle("active", moved);
    selectionMarquee.style.left = `${left - viewportRect.left}px`;
    selectionMarquee.style.top = `${top - viewportRect.top}px`;
    selectionMarquee.style.width = `${right - left}px`;
    selectionMarquee.style.height = `${bottom - top}px`;

    const nextSelection = new Set(initialSelection);
    if (moved) {
      nodes.forEach((node) => {
        const rect = node.element.getBoundingClientRect();
        const intersects = rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom;
        if (intersects) nextSelection.add(node.id);
      });
    }
    setSelectedNodes(nextSelection);
  };

  const onUp = () => {
    if (!moved) setSelectedNodes(initialSelection);
    selectionMarquee.classList.remove("active");
    selectionMarquee.removeAttribute("style");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}, true);

viewport.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  event.stopPropagation();
  showContextMenu(event.clientX, event.clientY);
});

viewport.addEventListener("mousedown", (event) => {
  if (event.button === 1) event.preventDefault();
}, true);

viewport.addEventListener("auxclick", (event) => {
  if (event.button !== 1) return;
  event.preventDefault();
  event.stopPropagation();
});

viewport.addEventListener("dragstart", (event) => {
  event.preventDefault();
});

viewport.addEventListener("dragenter", (event) => {
  if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
  event.preventDefault();
  dragDepth += 1;
  dropOverlay.classList.add("visible");
});

viewport.addEventListener("dragover", (event) => {
  if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
});

viewport.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropOverlay.classList.remove("visible");
});

viewport.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.remove("visible");
  const files = event.dataTransfer?.files;
  if (!files?.length) return;
  const point = screenToCanvas(event.clientX, event.clientY);
  createNodesFromFiles(files, { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 });
});

createImageNodeButton.addEventListener("click", () => {
  createImageNode({
    x: contextCanvasPoint.x - NODE_WIDTH / 2,
    y: contextCanvasPoint.y - NODE_HEIGHT / 2,
  });
  hideContextMenu();
});

createTextNodeButton.addEventListener("click", () => {
  createTextNode({
    x: contextCanvasPoint.x - NODE_WIDTH / 2,
    y: contextCanvasPoint.y - NODE_HEIGHT / 2,
  });
  hideContextMenu();
});

createKieNodeButton.addEventListener("click", () => {
  createKieNode({
    x: contextCanvasPoint.x - NODE_WIDTH / 2,
    y: contextCanvasPoint.y - NODE_HEIGHT / 2,
  });
  hideContextMenu();
});

zoomInButton.addEventListener("click", () => setScale(view.scale * ZOOM_STEP));
zoomOutButton.addEventListener("click", () => setScale(view.scale / ZOOM_STEP));
zoomResetButton.addEventListener("click", () => setScale(1));
fitButton.addEventListener("click", fitToNodes);
settingsButton.addEventListener("click", openSettings);
settingsCloseButton.addEventListener("click", closeSettings);
settingsCancelButton.addEventListener("click", closeSettings);
settingsSaveButton.addEventListener("click", saveSettings);
kieApiKeyClear.addEventListener("click", () => {
  kieApiKey.value = "";
  kieApiKey.focus();
});
settingsDialog.addEventListener("click", (event) => {
  if (event.target === settingsDialog) closeSettings();
});

document.addEventListener("pointerdown", (event) => {
  if (!contextMenu.contains(event.target)) hideContextMenu();
});

document.addEventListener("keydown", (event) => {
  if (previewDialog.open || settingsDialog.open || generationDetailsDialog.open) return;
  const editable = event.target instanceof HTMLInputElement
    || event.target instanceof HTMLTextAreaElement
    || event.target instanceof HTMLSelectElement;
  if ((event.key === "Delete" || event.key === "Backspace") && selectedNodeIds.size && !editable && !previewDialog.open) {
    event.preventDefault();
    Array.from(selectedNodeIds).forEach((nodeId) => removeNode(nodeId));
  }
  if ((event.key === "Delete" || event.key === "Backspace") && selectedConnectionId && !editable) {
    event.preventDefault();
    removeConnection(selectedConnectionId);
  }
  if (event.key === "Escape") {
    hideContextMenu();
    selectNode(null);
    if (previewDialog.open) previewDialog.close();
  }
});

previewCloseButton.addEventListener("click", () => previewDialog.close());
previewDialog.addEventListener("click", (event) => {
  if (event.target !== previewImage && !previewCloseButton.contains(event.target)) {
    previewDialog.close();
  }
});
previewDialog.addEventListener("close", () => {
  previewImage.removeAttribute("src");
  previewCaption.textContent = "";
});

generationDetailsClose.addEventListener("click", () => generationDetailsDialog.close());
generationDetailsDialog.addEventListener("click", (event) => {
  if (event.target === generationDetailsDialog) generationDetailsDialog.close();
});

window.addEventListener("resize", hideContextMenu);
window.addEventListener("beforeunload", () => {
  nodes.forEach((node) => {
    if (node.objectUrl && node.revokeObjectUrl) URL.revokeObjectURL(node.objectUrl);
    if (node.timerId) window.clearInterval(node.timerId);
    node.abortController?.abort();
  });
});

resetView();
updateEmptyState();
loadKieSettings();

try {
  window.localStorage.removeItem("canvas:image2-settings:v1");
} catch {
  // Ignore unavailable browser storage while removing the obsolete credentials.
}
