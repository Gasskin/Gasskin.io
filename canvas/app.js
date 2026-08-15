"use strict";

const NODE_WIDTH = 800;
const NODE_HEIGHT = NODE_WIDTH * 9 / 16;
const CONNECTION_SNAP_RADIUS = 44;
const MIN_SCALE = 0.05;
const MAX_SCALE = 32;
const ZOOM_STEP = 1.2;
const MAX_IMAGE_EDGE = 3840;
const MAX_IMAGE_PIXELS = 3840 * 2160;
const IMAGE_SIZE_MULTIPLE = 16;
const IMAGE_TIER_PIXELS = {
  "0.5k": 512 * 512,
  "1k": 1024 * 1024,
  "2k": 2048 * 2048,
  "4k": MAX_IMAGE_PIXELS,
};
const AICOMING_SETTINGS_STORAGE_KEY = "canvas:aicoming-settings:v1";
const RETIRED_SETTINGS_STORAGE_KEYS = Object.freeze([
  "canvas:maolao-settings:v1",
  "canvas:gpt-settings:v1",
  "canvas:apimart-settings:v1",
]);
const AICOMING_GENERATE_PATH = "v1/images/generations";
const AICOMING_POLL_INTERVAL_MS = 2000;
const AICOMING_TASK_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_AICOMING_SETTINGS = Object.freeze({
  baseUrl: "https://api.aicoming.top",
  apiKey: "",
});
const IMAGE2_NODE_SPECS = Object.freeze({
  aicoming: Object.freeze({
    label: "AIComing",
    model: "gpt-image-2",
    modelOptions: Object.freeze([
      Object.freeze({ value: "gpt-image-2", label: "gpt-image-2" }),
      Object.freeze({ value: "gpt-image-2-official", label: "gpt-image-2-official" }),
    ]),
    maxCount: 1,
    maxReferenceImages: 16,
    resolutions: ["1k", "2k", "4k"],
    ratios: ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21"],
  }),
});

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
const createAicomingNodeButton = document.getElementById("createAicomingNodeButton");
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
const settingsNavItems = Array.from(document.querySelectorAll("[data-settings-section]"));
const settingsPanels = Array.from(document.querySelectorAll("[data-settings-panel]"));
const aicomingBaseUrl = document.getElementById("aicomingBaseUrl");
const aicomingApiKey = document.getElementById("aicomingApiKey");
const aicomingApiKeyClear = document.getElementById("aicomingApiKeyClear");
const settingsMessage = document.getElementById("settingsMessage");
const generationDetailsDialog = document.getElementById("generationDetailsDialog");
const generationDetailsProvider = document.getElementById("generationDetailsProvider");
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
let contextScreenPoint = { x: 0, y: 0 };
let dragDepth = 0;
let aicomingSettings = { ...DEFAULT_AICOMING_SETTINGS };
const supportsCssZoom = typeof CSS !== "undefined" && CSS.supports("zoom", "2");

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function joinApiUrl(baseUrl, path) {
  const base = cleanBaseUrl(baseUrl);
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  const joinedPath = base.endsWith("/v1") && normalizedPath.startsWith("v1/")
    ? normalizedPath.slice(3)
    : normalizedPath;
  return `${base}/${joinedPath}`;
}

function createIdempotencyKey() {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `canvas-${uuid || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function isImage2GenerationNode(node) {
  return Boolean(IMAGE2_NODE_SPECS[node?.type]);
}

function updateSettingsButtonState() {
  const aicomingConfigured = isValidHttpUrl(aicomingSettings.baseUrl) && Boolean(aicomingSettings.apiKey);
  settingsButton.classList.toggle("configured", aicomingConfigured);
  settingsButton.title = aicomingConfigured
    ? "设置（已配置：AIComing）"
    : "设置（图片生成 API 尚未配置）";
}

function loadAicomingSettings() {
  let loaded = { ...DEFAULT_AICOMING_SETTINGS };
  try {
    const stored = window.localStorage.getItem(AICOMING_SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      loaded = {
        baseUrl: cleanBaseUrl(parsed?.baseUrl) || DEFAULT_AICOMING_SETTINGS.baseUrl,
        apiKey: String(parsed?.apiKey || "").trim(),
      };
    }
  } catch {
    // Ignore malformed or unavailable browser storage and keep the defaults.
  }
  aicomingSettings = loaded;
  updateSettingsButtonState();
}

function removeRetiredSettings() {
  try {
    RETIRED_SETTINGS_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Ignore unavailable browser storage; retired settings are never read again.
  }
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

function getConnectedImageNodes(targetNode) {
  const seen = new Set();
  return Array.from(connections.values())
    .filter((connection) => connection.toNodeId === targetNode.id)
    .map((connection) => nodes.get(connection.fromNodeId))
    .filter((node) => {
      const usableSource = node?.file || /^https?:\/\//i.test(node?.objectUrl || "") || /^data:image\//i.test(node?.objectUrl || "");
      if (node?.type !== "image" || !node.objectUrl || !usableSource || seen.has(node.id)) return false;
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

function describeImage2Inputs(imageSources, textSources) {
  const imageSummary = imageSources.length
    ? `已连接 ${imageSources.length} 张输入图片`
    : "未连接图片";
  const textSummary = textSources.length
    ? `已连接 ${textSources.length} 个文本节点`
    : "未连接文本节点";
  return `${imageSummary} · ${textSummary} · ${imageSources.length ? "图生图模式" : "文生图模式"}`;
}

function syncImage2PromptFromTextNodes(node, textSources) {
  if (!node.prompt) return;
  const hasTextSources = textSources.length > 0;
  if (hasTextSources) {
    if (!node.prompt.readOnly) node.localPromptValue = node.prompt.value;
    node.prompt.value = textSources.map((source) => source.textInput.value).join("\n\n");
  } else if (node.prompt.readOnly) {
    node.prompt.value = node.localPromptValue || "";
  }
  node.prompt.readOnly = hasTextSources;
  node.prompt.classList.toggle("linked-text", hasTextSources);
  node.prompt.setAttribute("aria-readonly", String(hasTextSources));
  node.prompt.placeholder = hasTextSources
    ? "提示词由已连接的文本节点提供，请在文本节点中输入内容。"
    : "描述要生成的图片；连接文本节点后会在生成时同步文本，连接图片后进行图生图…";
  node.prompt.title = hasTextSources
    ? "当前提示词跟随已连接的文本节点，不能在此编辑。"
    : "";
}

function refreshImage2Input(node) {
  if (!isImage2GenerationNode(node) || !node.inputPreview) return;
  const sources = getConnectedImageNodes(node);
  const textSources = getConnectedTextNodes(node);
  node.inputSourceIds = sources.map((source) => source.id);
  node.textInputSourceIds = textSources.map((source) => source.id);
  syncImage2PromptFromTextNodes(node, textSources);
  node.inputPreview.replaceChildren();
  node.inputPreview.classList.toggle("has-image", sources.length > 0);

  if (sources.length) {
    sources.forEach((source, index) => {
      const thumbnail = document.createElement("button");
      thumbnail.type = "button";
      thumbnail.className = "image2-input-thumb";
      thumbnail.title = `点击预览：${source.name}`;
      thumbnail.setAttribute("aria-label", `预览输入图片 ${index + 1}：${source.name}`);
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
    node.inputPreview.title = "";
  } else {
    const empty = document.createElement("span");
    empty.className = "image2-input-empty";
    empty.innerHTML = "<span>↦</span><strong>可直接文生图</strong><small>可连接图片或文本节点作为输入</small>";
    node.inputPreview.title = "未连接图片时使用文生图模式";
    node.inputPreview.appendChild(empty);
  }
  if (!node.generateButton.disabled) setImage2Status(node, describeImage2Inputs(sources, textSources));
  if (!node.hasRun) {
    node.detailsButton.textContent = "调用预览";
    setImage2RunActions(node, { details: sources.length > 0 });
  }
}

function refreshNodeInput(nodeId) {
  const node = nodes.get(nodeId);
  if (isImage2GenerationNode(node)) refreshImage2Input(node);
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
  const batchSourceIds = node.type === "image"
    ? new Set(Array.from(selectedNodeIds).filter((id) => {
      const candidate = nodes.get(id);
      return candidate?.type === "image" && Boolean(candidate.objectUrl);
    }))
    : new Set([node.id]);
  if (!batchSourceIds.size) batchSourceIds.add(node.id);
  const start = getPortPoint(node, "output");
  nodes.forEach((candidate) => {
    if (!batchSourceIds.has(candidate.id)) candidate.inputPort?.classList.add("compatible");
  });

  const onMove = (moveEvent) => {
    nodes.forEach((candidate) => candidate.inputPort?.classList.remove("snap-target"));
    const target = findConnectionTarget(moveEvent.clientX, moveEvent.clientY, batchSourceIds);
    if (target) target.node.inputPort?.classList.add("snap-target");
    const end = target?.point || screenToCanvas(moveEvent.clientX, moveEvent.clientY);
    connectionDraft.setAttribute("d", makeConnectionPath(start, end));
  };
  const onUp = (upEvent) => {
    const target = findConnectionTarget(upEvent.clientX, upEvent.clientY, batchSourceIds);
    const targetNodeId = target?.node.id;
    if (targetNodeId) {
      if (batchSourceIds.size > 1 && isImage2GenerationNode(target.node)) {
        batchSourceIds.forEach((sourceNodeId) => connectNodes(sourceNodeId, targetNodeId));
      } else {
        connectNodes(node.id, targetNodeId);
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
  (node.generatedObjectUrls || []).forEach((url) => URL.revokeObjectURL(url));
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

function roundImageDimension(value) {
  return Math.max(IMAGE_SIZE_MULTIPLE, Math.round(value / IMAGE_SIZE_MULTIPLE) * IMAGE_SIZE_MULTIPLE);
}

function floorImageDimension(value) {
  return Math.max(IMAGE_SIZE_MULTIPLE, Math.floor(value / IMAGE_SIZE_MULTIPLE) * IMAGE_SIZE_MULTIPLE);
}

function calculateImage2Size(tier, ratioValue) {
  if (ratioValue === "auto") return "服务端自动选择";
  const [ratioWidth, ratioHeight] = String(ratioValue).split(":").map(Number);
  const ratio = ratioWidth / ratioHeight || 1;
  const targetPixels = IMAGE_TIER_PIXELS[String(tier).toLowerCase()] || IMAGE_TIER_PIXELS["1k"];
  let width = Math.sqrt(targetPixels * ratio);
  let height = width / ratio;

  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE) {
    const scale = MAX_IMAGE_EDGE / Math.max(width, height);
    width *= scale;
    height *= scale;
  }

  width = roundImageDimension(width);
  height = roundImageDimension(width / ratio);
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) {
    const scale = Math.min(
      MAX_IMAGE_EDGE / width,
      MAX_IMAGE_EDGE / height,
      Math.sqrt(MAX_IMAGE_PIXELS / (width * height)),
    );
    width = floorImageDimension(width * scale);
    height = floorImageDimension(width / ratio);
  }
  return `${width}x${height}`;
}

function setImage2Status(node, message, state = "") {
  node.status.textContent = message;
  node.status.title = message;
  node.status.className = `image2-status${state ? ` ${state}` : ""}`;
}

function updateImage2NodeSize(node) {
  node.finalSize.value = calculateImage2Size(node.resolution.value, node.aspectRatio.value);
}

function formatGenerationElapsed(milliseconds) {
  return `${Math.floor(Math.max(0, milliseconds) / 1000)} 秒`;
}

function quoteShellArgument(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function buildGenerationCurl(callDetails) {
  if (!callDetails?.endpoint) return "暂无调用信息";
  const method = String(callDetails.method || "POST").toUpperCase();
  const parts = [
    `curl -X ${method} ${quoteShellArgument(callDetails.endpoint)}`,
    `  -H ${quoteShellArgument("Authorization: Bearer ***")}`,
  ];
  const idempotencyKey = callDetails.headers?.["Idempotency-Key"];
  if (idempotencyKey) parts.push(`  -H ${quoteShellArgument(`Idempotency-Key: ${idempotencyKey}`)}`);

  if (callDetails.multipart) {
    Object.entries(callDetails.body || {}).forEach(([key, value]) => {
      const values = Array.isArray(value) ? value : [value];
      values.forEach((entry) => parts.push(`  -F ${quoteShellArgument(`${key}=${entry}`)}`));
    });
  } else {
    parts.push(`  -H ${quoteShellArgument("Content-Type: application/json")}`);
    parts.push(`  --data-raw ${quoteShellArgument(JSON.stringify(callDetails.body || {}, null, 2))}`);
  }

  return parts.join(" \\\n");
}

function buildAicomingCallPreview(node) {
  const sources = getConnectedImageNodes(node);
  const textSources = getConnectedTextNodes(node);
  const linkedPromptParts = textSources
    .map((source) => source.textInput.value.trim())
    .filter(Boolean);
  const prompt = textSources.length
    ? linkedPromptParts.join("\n\n")
    : node.prompt.value.trim();
  const outputSize = node.finalSize.value === "服务端自动选择"
    ? calculateImage2Size(node.resolution.value, "1:1")
    : node.finalSize.value;
  const body = {
    model: node.model.value,
    prompt,
    size: outputSize,
    quality: "high",
    n: 1,
  };
  if (node.asyncMode.value === "true") body.async = true;
  if (sources.length) {
    const imageDetails = sources.map((source, index) => (
      source.file || String(source.objectUrl || "").startsWith("blob:")
        ? `[参考图 ${index + 1}：base64 data URI]`
        : source.objectUrl
    ));
    body.image = imageDetails.length === 1 ? imageDetails[0] : imageDetails;
  }
  return {
    configuration: {
      provider: "AIComing",
      node: node.spec.label,
      model: node.model.value,
      base_url: aicomingSettings.baseUrl,
    },
    text_inputs: textSources.map((source) => ({ node: source.name, text: source.textInput.value })),
    mode: sources.length ? "image-to-image" : "text-to-image",
    endpoint: joinApiUrl(aicomingSettings.baseUrl, AICOMING_GENERATE_PATH),
    method: "POST",
    headers: {
      Authorization: "Bearer ***",
      "Content-Type": "application/json",
      "Idempotency-Key": "<生成时自动创建>",
    },
    body,
  };
}

function openGenerationDetails(node, errorOnly = false, { preview = false } = {}) {
  const callDetails = preview ? buildAicomingCallPreview(node) : node.callDetails;
  generationDetailsProvider.textContent = `${node.spec?.label || "Image"} image generation`;
  generationDetailsTitle.textContent = errorOnly ? "错误信息" : preview ? "调用预览" : "生成详情";
  generationDetailsCodeLabel.textContent = errorOnly ? "错误内容" : "cURL";
  generationDetailsSummary.hidden = !errorOnly;
  generationDetailsTokenNote.hidden = errorOnly;
  generationDetailsDialog.classList.toggle("curl-only", !errorOnly);
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

function setImage2RunActions(node, { details = false, error = false } = {}) {
  node.detailsButton.classList.toggle("hidden", !details);
  node.errorButton.classList.toggle("hidden", !error);
}

function stopImage2Timer(node) {
  if (node.timerId) window.clearInterval(node.timerId);
  node.timerId = null;
  node.elapsedMs = performance.now() - node.startedAt;
}

function createImage2Results(node, results) {
  results.forEach((result, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const imageNode = createImageNode({
      x: node.x + node.width + 140 + column * (NODE_WIDTH + 100),
      y: node.y + row * (NODE_HEIGHT + 70),
      source: {
        src: result.src,
        name: `生成图片 ${index + 1}`,
        file: result.file || null,
        revokeOnRemove: Boolean(result.revokeOnRemove),
      },
    });
    connectNodes(node.id, imageNode.id);
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error(`无法读取图片：${file.name}`)), { once: true });
    reader.readAsDataURL(file);
  });
}

async function waitForAicomingPoll(signal) {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  await new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, AICOMING_POLL_INTERVAL_MS);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchImageApiJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok || payload?.error || (Number(payload?.code) >= 400)) {
    throw new Error(payload?.error?.message || payload?.message || text || `${response.status} ${response.statusText}`);
  }
  return payload;
}

function extractAicomingResults(payload) {
  const images = Array.isArray(payload?.data) ? payload.data : [];
  return images.flatMap((image, index) => {
    const src = image?.url || (image?.b64_json ? `data:image/png;base64,${image.b64_json}` : "");
    if (!src) return [];
    return [{
      src,
      name: `AIComing 生成图片 ${index + 1}`,
      responseDetails: {
        index: index + 1,
        url: image?.url || null,
        output_format: image?.url ? "url" : "b64_json",
      },
    }];
  });
}

async function pollAicomingTask(node, taskId, requestConfig) {
  const queryEndpoint = `${joinApiUrl(requestConfig.baseUrl, AICOMING_GENERATE_PATH)}/${encodeURIComponent(taskId)}`;
  const deadline = Date.now() + AICOMING_TASK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await waitForAicomingPoll(node.abortController.signal);
    const payload = await fetchImageApiJson(queryEndpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${requestConfig.apiKey}` },
      signal: node.abortController.signal,
    });
    const status = String(payload?.status || "unknown");
    const progressValue = Number(payload?.progress);
    const progress = Number.isFinite(progressValue) ? ` ${progressValue}%` : "";
    node.progressLabel = status === "processing" ? `处理中${progress}` : `任务 ${status}${progress}`;
    node.callDetails.task = {
      id: taskId,
      status,
      progress: payload?.progress ?? null,
      query_endpoint: queryEndpoint,
    };

    if (status === "completed") return { payload, results: extractAicomingResults(payload) };
    if (status === "failed") {
      throw new Error(payload?.error?.message || payload?.error || "AIComing 图片生成任务失败。");
    }
  }
  throw new Error("AIComing 任务查询超时（10 分钟）。");
}

async function generateWithAicoming(node) {
  const sources = getConnectedImageNodes(node);
  const textSources = getConnectedTextNodes(node);
  const linkedPromptParts = textSources
    .map((source) => source.textInput.value.trim())
    .filter(Boolean);
  const prompt = textSources.length
    ? linkedPromptParts.join("\n\n")
    : node.prompt.value.trim();
  const count = Math.max(1, Math.min(node.spec.maxCount, Number.parseInt(node.count.value, 10) || 1));
  const selectedModel = node.model.value;

  if (!prompt) {
    setImage2Status(node, "请在本节点或已连接的文本节点中填写提示词。", "error");
    const emptyTextSource = textSources.find((source) => !source.textInput.value.trim());
    (emptyTextSource?.textInput || node.prompt).focus();
    return;
  }
  if (sources.length > node.spec.maxReferenceImages) {
    setImage2Status(node, `${node.spec.label} 最多支持 ${node.spec.maxReferenceImages} 张参考图。`, "error");
    return;
  }
  if (!isValidHttpUrl(aicomingSettings.baseUrl) || !aicomingSettings.apiKey) {
    setImage2Status(node, "请先在设置中配置 AIComing API 地址和 API Key。", "error");
    openSettings("aicoming");
    return;
  }

  node.count.value = String(count);
  node.generateButton.disabled = true;
  node.abortController?.abort();
  node.abortController = new AbortController();

  const requestConfig = { ...aicomingSettings };
  const endpoint = joinApiUrl(requestConfig.baseUrl, AICOMING_GENERATE_PATH);
  const idempotencyKey = createIdempotencyKey();
  const useAsync = node.asyncMode.value === "true";
  const outputSize = node.finalSize.value === "服务端自动选择"
    ? calculateImage2Size(node.resolution.value, "1:1")
    : node.finalSize.value;
  const requestBody = {
    model: selectedModel,
    prompt,
    size: outputSize,
    quality: "high",
    n: 1,
  };
  if (useAsync) requestBody.async = true;
  node.startedAt = performance.now();
  node.elapsedMs = null;
  node.callStatus = "提交中";
  node.lastError = "";
  node.progressLabel = "提交中";
  node.callDetails = {
    configuration: {
      provider: "AIComing",
      node: node.spec.label,
      model: selectedModel,
      base_url: requestConfig.baseUrl,
    },
    text_inputs: textSources.map((source) => ({ node: source.name, text: source.textInput.value })),
    mode: sources.length ? "image-to-image" : "text-to-image",
    endpoint,
    method: "POST",
    headers: {
      Authorization: "Bearer ***",
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: { ...requestBody },
  };
  node.hasRun = true;
  node.detailsButton.textContent = "调用详情";
  setImage2RunActions(node, { details: true });
  setImage2Status(node, "提交中 · 0 秒");
  node.timerId = window.setInterval(() => {
    setImage2Status(node, `${node.progressLabel} · ${formatGenerationElapsed(performance.now() - node.startedAt)}`);
  }, 250);

  try {
    if (sources.length) {
      node.progressLabel = "正在读取参考图";
      const images = await Promise.all(sources.map((source) => (
        source.file ? fileToDataUrl(source.file) : source.objectUrl
      )));
      requestBody.image = images.length === 1 ? images[0] : images;
      const imageDetails = images.map((url, index) => (
        url.startsWith("data:") ? `[参考图 ${index + 1}：base64 data URI]` : url
      ));
      node.callDetails.body.image = images.length === 1 ? imageDetails[0] : imageDetails;
    }
    const submitOptions = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requestConfig.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(requestBody),
      signal: node.abortController.signal,
    };
    let submitPayload;
    try {
      submitPayload = await fetchImageApiJson(endpoint, submitOptions);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      node.progressLabel = "连接中断，正在安全重试";
      submitPayload = await fetchImageApiJson(endpoint, submitOptions);
      node.callDetails.network_retry = true;
    }
    let resultPayload = submitPayload;
    let results;
    if (useAsync) {
      const taskId = submitPayload?.id;
      if (!taskId) throw new Error("AIComing 异步接口未返回任务 id。");
      node.callDetails.submit_response = submitPayload;
      node.progressLabel = "任务已提交";
      node.callStatus = "查询中";
      const polled = await pollAicomingTask(node, taskId, requestConfig);
      resultPayload = polled.payload;
      results = polled.results;
    } else {
      results = extractAicomingResults(submitPayload);
    }
    if (!results.length) throw new Error("AIComing 接口返回成功，但没有找到生成图片。");

    stopImage2Timer(node);
    node.callStatus = "生成成功";
    node.callDetails = {
      ...node.callDetails,
      response: {
        id: resultPayload?.id || null,
        status: resultPayload?.status || (useAsync ? null : "completed"),
        created: resultPayload?.created || null,
        completed: resultPayload?.completed || null,
        image_count: results.length,
        images: results.map((result) => result.responseDetails),
      },
    };
    setImage2Status(node, `生成完成 · ${formatGenerationElapsed(node.elapsedMs)}`, "done");
    setImage2RunActions(node, { details: true });
    if (nodes.has(node.id)) createImage2Results(node, results);
  } catch (error) {
    stopImage2Timer(node);
    let failureMessage;
    if (error?.name === "AbortError") {
      failureMessage = "生成已停止。";
    } else if (error instanceof TypeError) {
      failureMessage = "请求失败，请检查网络、网址或 CORS 设置。";
    } else {
      failureMessage = error.message || String(error);
    }
    node.callStatus = "生成失败";
    node.lastError = failureMessage;
    node.callDetails = { ...node.callDetails, error: failureMessage };
    setImage2Status(node, `生成失败 · ${formatGenerationElapsed(node.elapsedMs)}`, "error");
    setImage2RunActions(node, { details: true, error: true });
  } finally {
    node.generateButton.disabled = false;
    node.abortController = null;
  }
}

function cloneImage2GenerationNode(node) {
  if (!isImage2GenerationNode(node)) return null;
  const inputSourceIds = Array.from(connections.values())
    .filter((connection) => {
      const sourceType = nodes.get(connection.fromNodeId)?.type;
      return connection.toNodeId === node.id && (sourceType === "image" || sourceType === "text");
    })
    .map((connection) => connection.fromNodeId);
  const clone = createImage2GenerationNode(node.type, {
    x: node.x + 52,
    y: node.y + 52,
  });
  if (!clone) return null;

  clone.localPromptValue = node.localPromptValue ?? (node.prompt.readOnly ? "" : node.prompt.value);
  clone.prompt.value = clone.localPromptValue;
  clone.model.value = node.model.value;
  clone.resolution.value = node.resolution.value;
  clone.aspectRatio.value = node.aspectRatio.value;
  clone.count.value = node.count.value;
  if (clone.quality && node.quality) clone.quality.value = node.quality.value;
  clone.asyncMode.value = node.asyncMode.value;
  updateImage2NodeSize(clone);
  inputSourceIds.forEach((sourceNodeId) => connectNodes(sourceNodeId, clone.id));
  selectNode(clone.id);
  return clone;
}

function createImage2GenerationNode(type, { x, y } = {}) {
  const spec = IMAGE2_NODE_SPECS[type];
  if (!spec) return null;
  nodeSequence += 1;
  const id = `${type}-${nodeSequence}`;
  const center = canvasCenter();
  const node = {
    id,
    type,
    spec,
    x: Number.isFinite(x) ? x : center.x - NODE_WIDTH / 2,
    y: Number.isFinite(y) ? y : center.y - NODE_HEIGHT / 2,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    name: `${spec.label} ${nodeSequence}`,
    wasDragged: false,
    element: document.createElement("article"),
    title: document.createElement("span"),
    body: document.createElement("div"),
  };

  node.element.className = "canvas-node image2-node aicoming-image";
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

  const cloneButton = document.createElement("button");
  cloneButton.className = "node-tool-button";
  cloneButton.type = "button";
  cloneButton.textContent = "克隆";
  cloneButton.title = "克隆节点并复制输入连接";
  cloneButton.setAttribute("aria-label", `克隆${node.name}`);
  cloneButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  cloneButton.addEventListener("click", (event) => {
    event.stopPropagation();
    cloneImage2GenerationNode(node);
  });

  const headerActions = document.createElement("div");
  headerActions.className = "node-header-actions";
  headerActions.append(cloneButton, deleteButton);
  header.append(titleWrap, headerActions);

  node.body.className = "node-body image2-body";
  const ratioOptions = spec.ratios
    .map((ratio) => `<option value="${ratio}"${ratio === "16:9" ? " selected" : ""}>${ratio}</option>`)
    .join("");
  const resolutionOptions = spec.resolutions
    .map((resolution) => `<option value="${resolution}"${resolution.toLowerCase() === "1k" ? " selected" : ""}>${resolution}</option>`)
    .join("");
  const modelControl = `<select class="image2-model">${spec.modelOptions.map((option) => (
    `<option value="${option.value}"${option.value === spec.model ? " selected" : ""}>${option.label}</option>`
  )).join("")}</select>`;
  node.body.innerHTML = `
    <div class="image2-input-preview" aria-label="输入图片预览"></div>
    <textarea class="image2-prompt" placeholder="描述要生成的图片；连接文本节点后会在生成时同步文本，连接图片后进行图生图…" aria-label="${spec.label} 提示词"></textarea>
    <div class="image2-config">
      <label class="image2-field wide">模型${modelControl}</label>
      <label class="image2-field">分辨率<select class="image2-resolution">${resolutionOptions}</select></label>
      <label class="image2-field">图片比例<select class="image2-aspect">${ratioOptions}</select></label>
      <label class="image2-field">预计输出<input class="image2-final-size" type="text" disabled /></label>
      <label class="image2-field">图片数量<input class="image2-count" type="number" min="1" max="1" value="1" disabled /></label>
      <label class="image2-field">质量<input class="image2-quality" type="text" value="high" disabled /></label>
      <label class="image2-field">异步任务<select class="image2-async"><option value="true" selected>开启</option><option value="false">关闭</option></select></label>
    </div>
    <div class="image2-generate-row">
      <div class="image2-run-summary">
        <span class="image2-status">未连接图片 · 未连接文本节点 · 文生图模式</span>
        <div class="image2-run-actions">
          <button class="image2-run-action image2-details hidden" type="button">调用详情</button>
          <button class="image2-run-action image2-error-info hidden" type="button">错误信息</button>
        </div>
      </div>
      <div class="image2-generate-actions">
        <button class="image2-generate" type="button">生成图片</button>
      </div>
    </div>
  `;

  node.inputPreview = node.body.querySelector(".image2-input-preview");
  node.prompt = node.body.querySelector(".image2-prompt");
  node.localPromptValue = "";
  node.model = node.body.querySelector(".image2-model");
  node.resolution = node.body.querySelector(".image2-resolution");
  node.aspectRatio = node.body.querySelector(".image2-aspect");
  node.finalSize = node.body.querySelector(".image2-final-size");
  node.count = node.body.querySelector(".image2-count");
  node.quality = node.body.querySelector(".image2-quality");
  node.asyncMode = node.body.querySelector(".image2-async");
  node.status = node.body.querySelector(".image2-status");
  node.detailsButton = node.body.querySelector(".image2-details");
  node.errorButton = node.body.querySelector(".image2-error-info");
  node.generateButton = node.body.querySelector(".image2-generate");

  node.prompt.addEventListener("input", () => {
    if (!node.prompt.readOnly) node.localPromptValue = node.prompt.value;
  });

  node.resolution.addEventListener("change", () => updateImage2NodeSize(node));
  node.aspectRatio.addEventListener("change", () => updateImage2NodeSize(node));
  node.count.addEventListener("change", () => {
    node.count.value = String(Math.max(1, Math.min(spec.maxCount, Number.parseInt(node.count.value, 10) || 1)));
  });
  node.detailsButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openGenerationDetails(node, false, { preview: !node.hasRun });
  });
  node.errorButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openGenerationDetails(node, true);
  });
  node.generateButton.addEventListener("click", () => void generateWithAicoming(node));

  node.element.append(header, node.body);
  attachConnectionPorts(node);
  attachNodeDrag(node);
  surface.appendChild(node.element);
  nodes.set(id, node);
  refreshImage2Input(node);
  updateImage2NodeSize(node);
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

function showSettingsSection(section) {
  settingsNavItems.forEach((item) => {
    const active = item.dataset.settingsSection === section;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  settingsPanels.forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== section;
  });
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function openSettings(section = "aicoming") {
  aicomingBaseUrl.value = aicomingSettings.baseUrl;
  aicomingApiKey.value = aicomingSettings.apiKey;
  settingsMessage.textContent = "";
  showSettingsSection(section);
  settingsDialog.showModal();
}

function closeSettings() {
  settingsDialog.close();
}

function saveSettings() {
  const activeSection = settingsNavItems.find((item) => item.classList.contains("active"))?.dataset.settingsSection;
  if (activeSection === "image") {
    closeSettings();
    return;
  }
  const baseUrl = cleanBaseUrl(aicomingBaseUrl.value);
  const apiKey = aicomingApiKey.value.trim();
  if (!isValidHttpUrl(baseUrl)) {
    showSettingsSection("aicoming");
    settingsMessage.textContent = "请输入有效的 AIComing API 基础网址。";
    aicomingBaseUrl.focus();
    return;
  }
  if (!apiKey) {
    showSettingsSection("aicoming");
    settingsMessage.textContent = "请输入 AIComing API Key。";
    aicomingApiKey.focus();
    return;
  }

  try {
    window.localStorage.setItem(AICOMING_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, baseUrl, apiKey }));
  } catch {
    showSettingsSection("aicoming");
    settingsMessage.textContent = "浏览器本地存储不可用，设置未能保存。";
    return;
  }

  aicomingSettings = { baseUrl, apiKey };
  updateSettingsButtonState();
  closeSettings();
}

function hideContextMenu() {
  contextMenu.classList.remove("open");
  contextMenu.setAttribute("aria-hidden", "true");
}

function showContextMenu(clientX, clientY) {
  contextCanvasPoint = screenToCanvas(clientX, clientY);
  contextScreenPoint = { x: clientX, y: clientY };
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
  if (event.target instanceof Element && event.target.closest(".image2-prompt, .text-node-input")) return;
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

createAicomingNodeButton.addEventListener("click", () => {
  createImage2GenerationNode("aicoming", {
    x: contextCanvasPoint.x - NODE_WIDTH / 2,
    y: contextCanvasPoint.y - NODE_HEIGHT / 2,
  });
  hideContextMenu();
});

zoomInButton.addEventListener("click", () => setScale(view.scale * ZOOM_STEP));
zoomOutButton.addEventListener("click", () => setScale(view.scale / ZOOM_STEP));
zoomResetButton.addEventListener("click", () => setScale(1));
fitButton.addEventListener("click", fitToNodes);
settingsButton.addEventListener("click", () => openSettings("aicoming"));
settingsCloseButton.addEventListener("click", closeSettings);
settingsCancelButton.addEventListener("click", closeSettings);
settingsSaveButton.addEventListener("click", saveSettings);
settingsNavItems.forEach((item) => {
  item.addEventListener("click", () => showSettingsSection(item.dataset.settingsSection));
});
aicomingApiKeyClear.addEventListener("click", () => {
  aicomingApiKey.value = "";
  aicomingApiKey.focus();
});
settingsDialog.addEventListener("click", (event) => {
  if (event.target === settingsDialog) closeSettings();
});

document.addEventListener("pointerdown", (event) => {
  if (!contextMenu.contains(event.target)) hideContextMenu();
});

document.addEventListener("keydown", (event) => {
  if (settingsDialog.open || previewDialog.open || generationDetailsDialog.open) return;
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
removeRetiredSettings();
loadAicomingSettings();
