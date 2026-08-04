"use strict";

const NODE_WIDTH = 360;
const NODE_HEIGHT = NODE_WIDTH * 9 / 16;
const IMAGE2_NODE_WIDTH = 800;
const IMAGE2_NODE_HEIGHT = IMAGE2_NODE_WIDTH * 9 / 16;
const CONNECTION_SNAP_RADIUS = 44;
const MIN_SCALE = 0.05;
const MAX_SCALE = 32;
const ZOOM_STEP = 1.2;
const MAX_IMAGE_EDGE = 3840;
const MAX_IMAGE_PIXELS = 3840 * 2160;
const IMAGE_SIZE_MULTIPLE = 16;
const IMAGE_TIER_PIXELS = {
  "1k": 1024 * 1024,
  "2k": 2048 * 2048,
  "4k": MAX_IMAGE_PIXELS,
};
const IMAGE2_SETTINGS_STORAGE_KEY = "canvas:image2-settings:v1";
const DEFAULT_IMAGE2_PROFILES = [
  {
    id: "image2-ai-input",
    name: "AI Input",
    model: "gpt-image-2",
    baseUrl: "https://ai.input.im",
    token: "",
  },
  {
    id: "image2-tokenshengsheng",
    name: "Token 生生",
    model: "gpt-image-2",
    baseUrl: "https://tokenshengsheng.com",
    token: "",
  },
];

const viewport = document.getElementById("canvasViewport");
const panLayer = document.getElementById("canvasPanLayer");
const surface = document.getElementById("canvasSurface");
const emptyGuide = document.getElementById("emptyGuide");
const connectionList = document.getElementById("connectionList");
const connectionDraft = document.getElementById("connectionDraft");
const contextMenu = document.getElementById("contextMenu");
const createImageNodeButton = document.getElementById("createImageNodeButton");
const createImage2NodeButton = document.getElementById("createImage2NodeButton");
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
const addImage2ProfileButton = document.getElementById("addImage2ProfileButton");
const image2ProfilesList = document.getElementById("image2ProfilesList");
const image2ProfileTemplate = document.getElementById("image2ProfileTemplate");
const settingsMessage = document.getElementById("settingsMessage");
const generationDetailsDialog = document.getElementById("generationDetailsDialog");
const generationDetailsTitle = document.getElementById("generationDetailsTitle");
const generationDetailsClose = document.getElementById("generationDetailsClose");
const generationDetailsStatus = document.getElementById("generationDetailsStatus");
const generationDetailsElapsed = document.getElementById("generationDetailsElapsed");
const generationDetailsCodeLabel = document.getElementById("generationDetailsCodeLabel");
const generationDetailsCode = document.getElementById("generationDetailsCode");

const view = { x: 0, y: 0, scale: 1 };
const nodes = new Map();
const connections = new Map();
let nodeSequence = 0;
let connectionSequence = 0;
let highestLayer = 1;
let selectedNodeId = null;
let selectedConnectionId = null;
let contextCanvasPoint = { x: 0, y: 0 };
let contextScreenPoint = { x: 0, y: 0 };
let isSpacePressed = false;
let dragDepth = 0;
let profileSequence = 0;
let image2Profiles = DEFAULT_IMAGE2_PROFILES.map((profile) => ({ ...profile }));
const supportsCssZoom = typeof CSS !== "undefined" && CSS.supports("zoom", "2");

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function makeImage2ProfileId() {
  profileSequence += 1;
  return `image2-profile-${Date.now()}-${profileSequence}`;
}

function normalizeImage2Profiles(value) {
  const source = Array.isArray(value) ? value : value?.profiles;
  if (!Array.isArray(source)) return [];
  const usedIds = new Set();
  return source.map((profile, index) => {
    let id = String(profile?.id || `image2-profile-${index + 1}`).trim();
    if (!id || usedIds.has(id)) id = makeImage2ProfileId();
    usedIds.add(id);
    return {
      id,
      name: String(profile?.name || "").trim(),
      model: String(profile?.model || "").trim(),
      baseUrl: cleanBaseUrl(profile?.baseUrl),
      token: String(profile?.token || "").trim(),
    };
  });
}

function getImage2Profile(profileId) {
  return image2Profiles.find((profile) => profile.id === profileId) || null;
}

function isCompleteImage2Profile(profile) {
  return Boolean(
    profile?.name
    && profile?.model
    && profile?.baseUrl
    && profile?.token
    && isValidHttpUrl(profile.baseUrl),
  );
}

function renderImage2ModelOptions(node, preferredProfileId = node.model?.value) {
  if (!node.model) return;
  node.model.replaceChildren();
  if (!image2Profiles.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "请先在设置中新增配置";
    node.model.appendChild(option);
    node.model.disabled = true;
    return;
  }

  image2Profiles.forEach((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${profile.name || "未命名配置"} · ${profile.model || "未配置模型"}`;
    node.model.appendChild(option);
  });
  node.model.disabled = false;
  node.model.value = image2Profiles.some((profile) => profile.id === preferredProfileId)
    ? preferredProfileId
    : image2Profiles[0].id;
}

function refreshImage2ModelOptions() {
  nodes.forEach((node) => {
    if (node.type === "image2") renderImage2ModelOptions(node);
  });
}

function updateSettingsButtonState() {
  const completeCount = image2Profiles.filter(isCompleteImage2Profile).length;
  settingsButton.classList.toggle("configured", completeCount > 0);
  settingsButton.title = completeCount > 0
    ? `Image2 已配置 ${completeCount} 组模型`
    : "设置（Image2 配置尚未完成）";
}

function loadImage2Settings() {
  let loadedProfiles = DEFAULT_IMAGE2_PROFILES.map((profile) => ({ ...profile }));
  try {
    const stored = window.localStorage.getItem(IMAGE2_SETTINGS_STORAGE_KEY);
    if (stored) {
      const profiles = normalizeImage2Profiles(JSON.parse(stored));
      if (profiles.length) loadedProfiles = profiles;
    }
  } catch {
    // Ignore malformed or unavailable browser storage and use the file defaults.
  }

  image2Profiles = loadedProfiles;
  refreshImage2ModelOptions();
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

function selectNode(id) {
  selectedNodeId = id;
  selectedConnectionId = null;
  connections.forEach((connection) => connection.group.classList.remove("selected"));
  nodes.forEach((node, nodeId) => {
    node.element.classList.toggle("selected", nodeId === id);
  });
  if (id && nodes.has(id)) {
    highestLayer += 1;
    nodes.get(id).element.style.zIndex = String(highestLayer);
  }
}

function selectConnection(id) {
  selectedConnectionId = id;
  selectedNodeId = null;
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
      if (node?.type !== "image" || !node.objectUrl || !node.file || seen.has(node.id)) return false;
      seen.add(node.id);
      return true;
    });
}

function refreshImage2Input(node) {
  if (node.type !== "image2" || !node.inputPreview) return;
  const sources = getConnectedImageNodes(node);
  node.inputSourceIds = sources.map((source) => source.id);
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
    if (!node.generateButton.disabled) setImage2Status(node, `已连接 ${sources.length} 张输入图片 · 图生图模式`);
  } else {
    const empty = document.createElement("span");
    empty.className = "image2-input-empty";
    empty.innerHTML = "<span>↦</span><strong>可直接文生图</strong><small>连接图片后切换为图生图</small>";
    node.inputPreview.title = "未连接图片时使用文生图模式";
    node.inputPreview.appendChild(empty);
    if (!node.generateButton.disabled) setImage2Status(node, "未连接图片 · 文生图模式");
  }
}

function refreshNodeInput(nodeId) {
  const node = nodes.get(nodeId);
  if (node?.type === "image2") refreshImage2Input(node);
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

function findConnectionTarget(clientX, clientY, sourceNodeId) {
  const rect = viewport.getBoundingClientRect();
  let nearest = null;
  let nearestDistance = CONNECTION_SNAP_RADIUS;

  nodes.forEach((candidate) => {
    if (candidate.id === sourceNodeId) return;
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
  selectNode(node.id);
  const start = getPortPoint(node, "output");
  nodes.forEach((candidate) => {
    if (candidate.id !== node.id) candidate.inputPort?.classList.add("compatible");
  });

  const onMove = (moveEvent) => {
    nodes.forEach((candidate) => candidate.inputPort?.classList.remove("snap-target"));
    const target = findConnectionTarget(moveEvent.clientX, moveEvent.clientY, node.id);
    if (target) target.node.inputPort?.classList.add("snap-target");
    const end = target?.point || screenToCanvas(moveEvent.clientX, moveEvent.clientY);
    connectionDraft.setAttribute("d", makeConnectionPath(start, end));
  };
  const onUp = (upEvent) => {
    const target = findConnectionTarget(upEvent.clientX, upEvent.clientY, node.id);
    const targetNodeId = target?.node.id;
    if (targetNodeId && targetNodeId !== node.id) connectNodes(node.id, targetNodeId);
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
  if (selectedNodeId === id) selectedNodeId = null;
  updateEmptyState();
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
    if (event.button !== 0 || isSpacePressed) return;
    if (event.target instanceof Element && event.target.closest("button, input, textarea, select, option")) return;
    event.stopPropagation();
    selectNode(node.id);

    const start = screenToCanvas(event.clientX, event.clientY);
    const origin = { x: node.x, y: node.y };
    let moved = false;

    const onMove = (moveEvent) => {
      if (!moved && Math.hypot(moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY) > 3) {
        moved = true;
        node.wasDragged = true;
        node.element.classList.add("dragging");
      }
      if (!moved) return;
      moveEvent.preventDefault();
      const point = screenToCanvas(moveEvent.clientX, moveEvent.clientY);
      node.x = origin.x + point.x - start.x;
      node.y = origin.y + point.y - start.y;
      node.element.style.left = `${node.x}px`;
      node.element.style.top = `${node.y}px`;
      updateConnectionsForNode(node.id);
    };

    const onUp = () => {
      node.element.classList.remove("dragging");
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
  deleteButton.title = "删除节点";
  deleteButton.setAttribute("aria-label", `删除${node.name}`);
  deleteButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    removeNode(id);
  });
  header.append(titleWrap, deleteButton);

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

function roundImageDimension(value) {
  return Math.max(IMAGE_SIZE_MULTIPLE, Math.round(value / IMAGE_SIZE_MULTIPLE) * IMAGE_SIZE_MULTIPLE);
}

function floorImageDimension(value) {
  return Math.max(IMAGE_SIZE_MULTIPLE, Math.floor(value / IMAGE_SIZE_MULTIPLE) * IMAGE_SIZE_MULTIPLE);
}

function calculateImage2Size(tier, ratioValue) {
  const [ratioWidth, ratioHeight] = String(ratioValue).split(":").map(Number);
  const ratio = ratioWidth / ratioHeight || 1;
  const targetPixels = IMAGE_TIER_PIXELS[tier] || IMAGE_TIER_PIXELS["1k"];
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

function buildImage2RequestUrl(baseUrl, isEdit) {
  const base = cleanBaseUrl(baseUrl);
  const path = isEdit ? "images/edits" : "images/generations";
  return base.endsWith("/v1") ? `${base}/${path}` : `${base}/v1/${path}`;
}

function setImage2Status(node, message, state = "") {
  node.status.textContent = message;
  node.status.title = message;
  node.status.className = `image2-status${state ? ` ${state}` : ""}`;
}

function updateImage2NodeSize(node) {
  node.finalSize.value = calculateImage2Size(node.sizeTier.value, node.aspectRatio.value);
}

function formatGenerationElapsed(milliseconds) {
  return `${Math.floor(Math.max(0, milliseconds) / 1000)} 秒`;
}

function validateImage2Size(value) {
  const match = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/.exec(String(value || ""));
  if (!match) {
    return { error: "最终尺寸格式错误，请使用“宽x高”，例如 1920x1080。" };
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    return { error: "最终尺寸的宽和高必须是大于 0 的整数。" };
  }
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE) {
    return { error: `最终尺寸 ${width}x${height} 超出限制，单边最大为 ${MAX_IMAGE_EDGE}px。` };
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    return { error: `最终尺寸 ${width}x${height} 超出最大总像素，不能超过 3840x2160（${MAX_IMAGE_PIXELS.toLocaleString("zh-CN")} 像素）。` };
  }
  return { value: `${width}x${height}` };
}

function openGenerationDetails(node, errorOnly = false) {
  generationDetailsTitle.textContent = errorOnly ? "错误信息" : "生成详情";
  generationDetailsCodeLabel.textContent = errorOnly ? "错误内容" : "本次调用";
  generationDetailsStatus.textContent = node.callStatus || "—";
  generationDetailsElapsed.textContent = node.elapsedMs == null
    ? formatGenerationElapsed(performance.now() - node.startedAt)
    : formatGenerationElapsed(node.elapsedMs);
  generationDetailsCode.textContent = errorOnly
    ? (node.lastError || "无错误信息")
    : JSON.stringify(node.callDetails || {}, null, 2);
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
        revokeOnRemove: false,
      },
    });
    connectNodes(node.id, imageNode.id);
  });
}

function base64ImageToFile(base64, index) {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], `image2-${Date.now()}-${index + 1}.png`, { type: "image/png" });
  } catch {
    return null;
  }
}

async function generateWithImage2(node) {
  const sources = getConnectedImageNodes(node);
  const isEdit = sources.length > 0;
  const prompt = node.prompt.value.trim();
  const profile = getImage2Profile(node.model.value);
  const sizeValidation = validateImage2Size(node.finalSize.value);
  const count = Math.max(1, Math.min(10, Number.parseInt(node.count.value, 10) || 1));

  if (!prompt) {
    setImage2Status(node, "请填写提示词。", "error");
    node.prompt.focus();
    return;
  }
  if (!profile) {
    setImage2Status(node, "请先在设置中新增并选择 Image2 配置。", "error");
    openSettings("image2");
    return;
  }
  if (sizeValidation.error) {
    setImage2Status(node, sizeValidation.error, "error");
    node.finalSize.focus();
    return;
  }
  if (!isCompleteImage2Profile(profile)) {
    setImage2Status(node, `配置“${profile.name || "未命名配置"}”不完整，请补全模型、网址和 Token。`, "error");
    openSettings("image2");
    return;
  }

  const model = profile.model;
  const finalSize = sizeValidation.value;
  node.finalSize.value = finalSize;
  node.count.value = String(count);
  node.generateButton.disabled = true;
  node.abortController?.abort();
  node.abortController = new AbortController();

  const endpoint = buildImage2RequestUrl(profile.baseUrl, isEdit);
  const requestBody = {
    model,
    prompt,
    size: finalSize,
    quality: "high",
    output_format: "png",
    background: "auto",
    n: count,
  };
  if (isEdit) requestBody["image[]"] = sources.map((source) => source.file.name);
  node.startedAt = performance.now();
  node.elapsedMs = null;
  node.callStatus = "生成中";
  node.lastError = "";
  node.callDetails = {
    configuration: {
      name: profile.name,
      model: profile.model,
      base_url: profile.baseUrl,
    },
    mode: isEdit ? "edit" : "generate",
    endpoint,
    method: "POST",
    headers: isEdit
      ? { Authorization: "Bearer ***" }
      : { Authorization: "Bearer ***", "Content-Type": "application/json" },
    body: requestBody,
  };
  setImage2RunActions(node);
  setImage2Status(node, "生成中 · 0 秒");
  node.timerId = window.setInterval(() => {
    setImage2Status(node, `生成中 · ${formatGenerationElapsed(performance.now() - node.startedAt)}`);
  }, 250);

  let body;
  const headers = { Authorization: `Bearer ${profile.token}` };
  if (isEdit) {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("size", finalSize);
    form.append("quality", "high");
    form.append("output_format", "png");
    form.append("background", "auto");
    form.append("n", String(count));
    sources.forEach((source) => form.append("image[]", source.file, source.file.name));
    body = form;
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(requestBody);
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body,
      signal: node.abortController.signal,
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.message || text || `${response.status} ${response.statusText}`);
    }

    const images = Array.isArray(payload?.data) ? payload.data : [];
    const results = images
      .map((image, index) => {
        const responseDetails = {
          index: index + 1,
          revised_prompt: image?.revised_prompt || null,
          url: image?.url || null,
          has_b64_json: Boolean(image?.b64_json),
        };
        if (image?.b64_json) return {
          src: `data:image/png;base64,${image.b64_json}`,
          name: `生成图片 ${index + 1}`,
          file: base64ImageToFile(image.b64_json, index),
          responseDetails,
        };
        if (image?.url) return { src: image.url, name: `生成图片 ${index + 1}`, responseDetails };
        return null;
      })
      .filter(Boolean);
    if (!results.length) throw new Error("接口返回成功，但没有找到生成图片。");

    stopImage2Timer(node);
    node.callStatus = "生成成功";
    node.callDetails = {
      ...node.callDetails,
      response: {
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
    if (error.name === "AbortError") {
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

function createImage2Node({ x, y } = {}) {
  nodeSequence += 1;
  const id = `image2-${nodeSequence}`;
  const center = canvasCenter();
  const node = {
    id,
    type: "image2",
    x: Number.isFinite(x) ? x : center.x - IMAGE2_NODE_WIDTH / 2,
    y: Number.isFinite(y) ? y : center.y - IMAGE2_NODE_HEIGHT / 2,
    width: IMAGE2_NODE_WIDTH,
    height: IMAGE2_NODE_HEIGHT,
    name: `生图 (Image2) ${nodeSequence}`,
    wasDragged: false,
    element: document.createElement("article"),
    title: document.createElement("span"),
    body: document.createElement("div"),
  };

  node.element.className = "canvas-node image2-node";
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
  deleteButton.title = "删除节点";
  deleteButton.setAttribute("aria-label", `删除${node.name}`);
  deleteButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    removeNode(id);
  });
  header.append(titleWrap, deleteButton);

  node.body.className = "node-body image2-body";
  node.body.innerHTML = `
    <div class="image2-input-preview" aria-label="输入图片预览"></div>
    <textarea class="image2-prompt" placeholder="描述要生成的图片；连接图片后可基于输入图编辑…" aria-label="Image2 提示词"></textarea>
    <div class="image2-config">
      <label class="image2-field wide">配置模型<select class="image2-model" aria-label="选择 Image2 配置模型"></select></label>
      <label class="image2-field">尺寸档位<select class="image2-size-tier"><option value="1k" selected>1K</option><option value="2k">2K</option><option value="4k">4K</option></select></label>
      <label class="image2-field">图片比例<select class="image2-aspect"><option value="1:1">1:1</option><option value="3:2">3:2</option><option value="2:3">2:3</option><option value="4:3">4:3</option><option value="3:4">3:4</option><option value="16:9" selected>16:9</option><option value="9:16">9:16</option><option value="21:9">21:9</option><option value="9:21">9:21</option></select></label>
      <label class="image2-field">最终尺寸<input class="image2-final-size" type="text" placeholder="例如 1360x768" title="可自定义；修改尺寸档位或图片比例后会自动重置" /></label>
      <label class="image2-field">图片数量<input class="image2-count" type="number" min="1" max="10" value="1" /></label>
      <label class="image2-field">质量<input type="text" value="high" disabled /></label>
      <label class="image2-field">输出格式<input type="text" value="png" disabled /></label>
      <label class="image2-field">背景<input type="text" value="auto" disabled /></label>
      <label class="image2-field">输出压缩<input type="text" value="PNG 不适用" disabled /></label>
    </div>
    <div class="image2-generate-row">
      <div class="image2-run-summary">
        <span class="image2-status">未连接图片 · 文生图模式</span>
        <div class="image2-run-actions">
          <button class="image2-run-action image2-details hidden" type="button">调用详情</button>
          <button class="image2-run-action image2-error-info hidden" type="button">错误信息</button>
        </div>
      </div>
      <button class="image2-generate" type="button">生成图片</button>
    </div>
  `;

  node.inputPreview = node.body.querySelector(".image2-input-preview");
  node.prompt = node.body.querySelector(".image2-prompt");
  node.model = node.body.querySelector(".image2-model");
  node.sizeTier = node.body.querySelector(".image2-size-tier");
  node.aspectRatio = node.body.querySelector(".image2-aspect");
  node.finalSize = node.body.querySelector(".image2-final-size");
  node.count = node.body.querySelector(".image2-count");
  node.status = node.body.querySelector(".image2-status");
  node.detailsButton = node.body.querySelector(".image2-details");
  node.errorButton = node.body.querySelector(".image2-error-info");
  node.generateButton = node.body.querySelector(".image2-generate");

  renderImage2ModelOptions(node);
  node.sizeTier.addEventListener("change", () => updateImage2NodeSize(node));
  node.aspectRatio.addEventListener("change", () => updateImage2NodeSize(node));
  node.count.addEventListener("change", () => {
    node.count.value = String(Math.max(1, Math.min(10, Number.parseInt(node.count.value, 10) || 1)));
  });
  node.detailsButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openGenerationDetails(node);
  });
  node.errorButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openGenerationDetails(node, true);
  });
  node.generateButton.addEventListener("click", () => void generateWithImage2(node));

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

function renumberImage2ProfileCards() {
  Array.from(image2ProfilesList.children).forEach((card, index) => {
    card.querySelector(".settings-profile-index").textContent = `配置 ${index + 1}`;
  });
}

function createImage2ProfileCard(profile) {
  const card = image2ProfileTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.profileId = profile.id || makeImage2ProfileId();
  const nameInput = card.querySelector('[data-profile-field="name"]');
  const modelInput = card.querySelector('[data-profile-field="model"]');
  const baseUrlInput = card.querySelector('[data-profile-field="baseUrl"]');
  const tokenInput = card.querySelector('[data-profile-field="token"]');
  const title = card.querySelector(".settings-profile-title");
  const deleteButton = card.querySelector(".settings-profile-delete");
  const clearButton = card.querySelector(".settings-token-clear");

  nameInput.value = profile.name || "";
  modelInput.value = profile.model || "";
  baseUrlInput.value = profile.baseUrl || "";
  tokenInput.value = profile.token || "";
  title.textContent = profile.name || "未命名配置";

  nameInput.addEventListener("input", () => {
    title.textContent = nameInput.value.trim() || "未命名配置";
  });
  clearButton.addEventListener("click", () => {
    tokenInput.value = "";
    tokenInput.focus();
  });
  deleteButton.addEventListener("click", () => {
    card.remove();
    renumberImage2ProfileCards();
    settingsMessage.textContent = "";
  });
  return card;
}

function renderImage2ProfileEditor() {
  image2ProfilesList.replaceChildren();
  image2Profiles.forEach((profile) => {
    image2ProfilesList.appendChild(createImage2ProfileCard(profile));
  });
  renumberImage2ProfileCards();
}

function collectImage2Profiles() {
  return Array.from(image2ProfilesList.children).map((card) => ({
    id: card.dataset.profileId || makeImage2ProfileId(),
    name: card.querySelector('[data-profile-field="name"]').value.trim(),
    model: card.querySelector('[data-profile-field="model"]').value.trim(),
    baseUrl: cleanBaseUrl(card.querySelector('[data-profile-field="baseUrl"]').value),
    token: card.querySelector('[data-profile-field="token"]').value.trim(),
  }));
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function openSettings(section = "image2") {
  renderImage2ProfileEditor();
  settingsMessage.textContent = "";
  showSettingsSection(section);
  settingsDialog.showModal();
}

function closeSettings() {
  settingsDialog.close();
}

function saveSettings() {
  const profiles = collectImage2Profiles();
  if (!profiles.length) {
    showSettingsSection("image2");
    settingsMessage.textContent = "请至少保留一组 Image2 配置。";
    return;
  }

  const names = new Set();
  for (let index = 0; index < profiles.length; index += 1) {
    const profile = profiles[index];
    const card = image2ProfilesList.children[index];
    if (!profile.name || !profile.model || !profile.baseUrl || !profile.token) {
      showSettingsSection("image2");
      settingsMessage.textContent = `请补全配置 ${index + 1} 的名称、模型、请求网址和 Token。`;
      card.querySelector("input:placeholder-shown")?.focus();
      return;
    }
    if (!isValidHttpUrl(profile.baseUrl)) {
      showSettingsSection("image2");
      settingsMessage.textContent = `配置“${profile.name}”的请求网址无效。`;
      card.querySelector('[data-profile-field="baseUrl"]').focus();
      return;
    }
    const normalizedName = profile.name.toLocaleLowerCase("zh-CN");
    if (names.has(normalizedName)) {
      showSettingsSection("image2");
      settingsMessage.textContent = `配置名称“${profile.name}”重复，请使用不同名称。`;
      card.querySelector('[data-profile-field="name"]').focus();
      return;
    }
    names.add(normalizedName);
  }

  try {
    window.localStorage.setItem(IMAGE2_SETTINGS_STORAGE_KEY, JSON.stringify({
      version: 1,
      nodeType: "image2",
      profiles,
    }));
  } catch {
    showSettingsSection("image2");
    settingsMessage.textContent = "浏览器本地存储不可用，设置未能保存。";
    return;
  }

  image2Profiles = profiles;
  refreshImage2ModelOptions();
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
  if (event.target instanceof Element && event.target.closest(".image2-prompt")) return;
  event.preventDefault();
  hideContextMenu();
  const factor = Math.exp(-event.deltaY * 0.0012);
  setScale(view.scale * factor, event.clientX, event.clientY);
}, { passive: false });

viewport.addEventListener("pointerdown", (event) => {
  const shouldPan = event.button === 1 || (event.button === 0 && (isSpacePressed || event.target === viewport || event.target === panLayer || event.target === surface));
  if (!shouldPan) return;
  event.preventDefault();
  event.stopPropagation();
  hideContextMenu();
  selectNode(null);
  viewport.classList.add("panning");

  const start = { x: event.clientX, y: event.clientY };
  const origin = { x: view.x, y: view.y };

  const onMove = (moveEvent) => {
    view.x = origin.x + moveEvent.clientX - start.x;
    view.y = origin.y + moveEvent.clientY - start.y;
    applyView();
  };

  const onUp = () => {
    viewport.classList.remove("panning");
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
  showContextMenu(event.clientX, event.clientY);
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

createImage2NodeButton.addEventListener("click", () => {
  createImage2Node({
    x: contextCanvasPoint.x - IMAGE2_NODE_WIDTH / 2,
    y: contextCanvasPoint.y - IMAGE2_NODE_HEIGHT / 2,
  });
  hideContextMenu();
});

zoomInButton.addEventListener("click", () => setScale(view.scale * ZOOM_STEP));
zoomOutButton.addEventListener("click", () => setScale(view.scale / ZOOM_STEP));
zoomResetButton.addEventListener("click", () => setScale(1));
fitButton.addEventListener("click", fitToNodes);
settingsButton.addEventListener("click", () => openSettings("image2"));
settingsCloseButton.addEventListener("click", closeSettings);
settingsCancelButton.addEventListener("click", closeSettings);
settingsSaveButton.addEventListener("click", saveSettings);
settingsNavItems.forEach((item) => {
  item.addEventListener("click", () => showSettingsSection(item.dataset.settingsSection));
});
addImage2ProfileButton.addEventListener("click", () => {
  const card = createImage2ProfileCard({
    id: makeImage2ProfileId(),
    name: `Image2 配置 ${image2ProfilesList.children.length + 1}`,
    model: "gpt-image-2",
    baseUrl: "https://ai.input.im",
    token: "",
  });
  image2ProfilesList.appendChild(card);
  renumberImage2ProfileCards();
  settingsMessage.textContent = "";
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  card.querySelector('[data-profile-field="name"]').select();
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
  if (event.code === "Space" && !editable) {
    event.preventDefault();
    isSpacePressed = true;
    viewport.classList.add("space-ready");
  }
  if ((event.key === "Delete" || event.key === "Backspace") && selectedNodeId && !editable && !previewDialog.open) {
    event.preventDefault();
    removeNode(selectedNodeId);
  }
  if ((event.key === "Delete" || event.key === "Backspace") && selectedConnectionId && !editable) {
    event.preventDefault();
    removeConnection(selectedConnectionId);
  }
  if (event.key === "Escape") {
    hideContextMenu();
    if (previewDialog.open) previewDialog.close();
  }
});

document.addEventListener("keyup", (event) => {
  if (event.code === "Space") {
    isSpacePressed = false;
    viewport.classList.remove("space-ready");
  }
});

window.addEventListener("blur", () => {
  isSpacePressed = false;
  viewport.classList.remove("space-ready");
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
loadImage2Settings();
