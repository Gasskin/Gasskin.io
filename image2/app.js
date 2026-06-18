const DEFAULT_UPSTREAM_BASE_URL = "https://api.openai.com";
const PAGE_PARAMS = new URLSearchParams(window.location.search);
const CONFIGURED_PROXY_BASE_URL =
  PAGE_PARAMS.get("proxyBase") ||
  PAGE_PARAMS.get("apiBase") ||
  window.IMAGE2_PROXY_BASE ||
  window.IMAGE2_API_BASE ||
  "";
const WHITELIST_PATH = "api-whitelist.txt";
const GENERATE_PATH = "/v1/images/generations";
const EDIT_PATH = "/v1/images/edits";
const DEFAULT_ALLOWED_BASE_URLS = [
  "https://api.openai.com",
  "https://flux.infpro.me",
  "https://ai.input.im",
];
const MAX_EDGE = 3840;
const MAX_PIXELS = 3840 * 2160;
const MULTIPLE = 16;
const TIER_PIXELS = {
  "1k": 1024 * 1024,
  "2k": 2048 * 2048,
  "4k": MAX_PIXELS,
};

const $ = (id) => document.getElementById(id);

const els = {
  baseUrl: $("baseUrl"),
  token: $("token"),
  referenceDropzone: $("referenceDropzone"),
  referenceImages: $("referenceImages"),
  referenceList: $("referenceList"),
  prompt: $("prompt"),
  model: $("model"),
  sizeTier: $("sizeTier"),
  aspectRatio: $("aspectRatio"),
  finalSize: $("finalSize"),
  quality: $("quality"),
  outputFormat: $("outputFormat"),
  outputCompression: $("outputCompression"),
  background: $("background"),
  count: $("count"),
  countMinus: $("countMinus"),
  countPlus: $("countPlus"),
  imageList: $("imageList"),
  generateBtn: $("generateBtn"),
  tokenClear: $("tokenClear"),
  pagination: $("pagination"),
  pagePrev: $("pagePrev"),
  pageNext: $("pageNext"),
  pageInfo: $("pageInfo"),
};

let activeAbort = null;
let runSeq = 0;
let previewModal = null;
let referenceSeq = 0;
const referenceImages = [];
let allowedBaseUrls = DEFAULT_ALLOWED_BASE_URLS;
let runItems = [];
let currentPage = 1;
let pageSize = 4;

function cleanBaseUrl(value) {
  return (value || "").trim().replace(/\/+$/, "");
}

function normalizeBaseUrl(value) {
  return cleanBaseUrl(value) || DEFAULT_UPSTREAM_BASE_URL;
}

function parseWhitelist(text) {
  const urls = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(cleanBaseUrl)
    .filter((line) => {
      try {
        const url = new URL(line);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    });

  return Array.from(new Set(urls));
}

function renderBaseUrlOptions(urls) {
  const selected = normalizeBaseUrl(els.baseUrl.value);
  els.baseUrl.replaceChildren();

  urls.forEach((url) => {
    const option = document.createElement("option");
    option.value = url;
    option.textContent = url;
    els.baseUrl.appendChild(option);
  });

  els.baseUrl.value = urls.includes(selected) ? selected : urls[0] || DEFAULT_UPSTREAM_BASE_URL;
}

async function loadBaseUrlWhitelist() {
  try {
    const response = await fetch(WHITELIST_PATH, { cache: "no-store" });
    if (response.ok) {
      const urls = parseWhitelist(await response.text());
      if (urls.length) allowedBaseUrls = urls;
    }
  } catch {
    // Keep the built-in default if the whitelist file cannot be loaded.
  }

  renderBaseUrlOptions(allowedBaseUrls);
}

function buildApiUrl(path) {
  const upstreamBaseUrl = normalizeBaseUrl(els.baseUrl.value);
  const apiPath = upstreamBaseUrl.endsWith("/v1") && path.startsWith("/v1/") ? path.slice(3) : path;
  const proxyBaseUrl = cleanBaseUrl(CONFIGURED_PROXY_BASE_URL);

  if (!proxyBaseUrl) {
    return `${upstreamBaseUrl}${apiPath}`;
  }

  const url = new URL(`${proxyBaseUrl}${apiPath}`);
  url.searchParams.set("target", upstreamBaseUrl);
  return url.toString();
}

function parseRatio(value) {
  const [w, h] = value.split(":").map(Number);
  return { w, h, ratio: w / h };
}

function roundToMultiple(value) {
  return Math.max(MULTIPLE, Math.round(value / MULTIPLE) * MULTIPLE);
}

function floorToMultiple(value) {
  return Math.max(MULTIPLE, Math.floor(value / MULTIPLE) * MULTIPLE);
}

function calculateFinalSize() {
  const targetPixels = TIER_PIXELS[els.sizeTier.value] || TIER_PIXELS["1k"];
  const { ratio } = parseRatio(els.aspectRatio.value);

  let width = Math.sqrt(targetPixels * ratio);
  let height = width / ratio;

  if (width > MAX_EDGE || height > MAX_EDGE) {
    const scale = MAX_EDGE / Math.max(width, height);
    width *= scale;
    height *= scale;
  }

  width = roundToMultiple(width);
  height = roundToMultiple(width / ratio);

  if (width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) {
    const scale = Math.min(MAX_EDGE / width, MAX_EDGE / height, Math.sqrt(MAX_PIXELS / (width * height)));
    width = floorToMultiple(width * scale);
    height = floorToMultiple(width / ratio);
  }

  return `${width}x${height}`;
}

function updateFinalSize() {
  els.finalSize.value = calculateFinalSize();
}

function getOutputExtension(format) {
  return format === "jpeg" ? "jpg" : format;
}

function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function addReferenceFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    referenceSeq += 1;
    referenceImages.push({
      id: `ref-${referenceSeq}`,
      file,
      url: URL.createObjectURL(file),
    });
  }
  renderReferenceImages();
}

function removeReferenceImage(id) {
  const index = referenceImages.findIndex((item) => item.id === id);
  if (index < 0) return;
  URL.revokeObjectURL(referenceImages[index].url);
  referenceImages.splice(index, 1);
  renderReferenceImages();
}

function renderReferenceImages() {
  els.referenceList.replaceChildren();

  referenceImages.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "reference-item";
    card.innerHTML = `
      <img src="${item.url}" alt="参考图片 ${index + 1}" />
      <span class="reference-index">图 ${index + 1}</span>
      <button type="button" class="reference-remove" aria-label="删除参考图片 ${index + 1}" title="删除">×</button>
      <div class="reference-name" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</div>
    `;
    card.querySelector("img").addEventListener("click", () => showPreview(item.url, `参考图片 ${index + 1}`));
    card.querySelector(".reference-remove").addEventListener("click", () => removeReferenceImage(item.id));
    els.referenceList.appendChild(card);
  });
}

function setEmptyVisible(visible) {
  const empty = els.imageList.querySelector(".empty");
  if (empty) empty.classList.toggle("hidden", !visible);
}

function getResponsivePageSize() {
  const width = els.imageList.clientWidth || window.innerWidth;
  if (width >= 920) return 4;
  if (width >= 640) return 3;
  return 2;
}

function updatePageSize() {
  const nextSize = getResponsivePageSize();
  if (nextSize === pageSize) return;
  const firstVisibleIndex = (currentPage - 1) * pageSize;
  pageSize = nextSize;
  currentPage = Math.floor(firstVisibleIndex / pageSize) + 1;
  renderPagination();
}

function renderPagination() {
  const totalRuns = runItems.length;
  const totalPages = Math.max(1, Math.ceil(totalRuns / pageSize));
  currentPage = Math.min(Math.max(1, currentPage), totalPages);

  runItems.forEach((item, index) => {
    const visible = index >= (currentPage - 1) * pageSize && index < currentPage * pageSize;
    item.classList.toggle("hidden", !visible);
  });

  setEmptyVisible(totalRuns === 0);
  els.pagination.classList.toggle("hidden", totalRuns <= pageSize);
  els.pageInfo.textContent = `第 ${currentPage} / ${totalPages} 页 · 共 ${totalRuns} 条`;
  els.pagePrev.disabled = currentPage <= 1;
  els.pageNext.disabled = currentPage >= totalPages;
}

function changePage(delta) {
  currentPage += delta;
  renderPagination();
}

function createRunItem(payload) {
  runSeq += 1;
  const modeLabel = payload.mode === "edit" ? `图生图 · ${payload.referenceCount} 张参考图` : "文生图";

  const item = document.createElement("article");
  item.className = "run-item";
  item.innerHTML = `
    <div class="run-head">
      <div class="run-title">
        <strong>生成请求 #${runSeq}</strong>
        <span>${escapeHtml(modeLabel)} · ${escapeHtml(payload.size)} · ${escapeHtml(payload.aspectRatio)} · ${escapeHtml(payload.quality)} · ${escapeHtml(payload.output_format)} · ${payload.n} 张</span>
      </div>
      <span class="badge" data-state="running">准备中</span>
    </div>
    <div class="run-body">
      <div class="progress"><span></span></div>
      <div class="run-status">正在准备请求...</div>
      <div class="thumb-grid"></div>
    </div>
  `;
  els.imageList.prepend(item);
  runItems.unshift(item);
  currentPage = 1;
  renderPagination();
  return item;
}

function updateRunItem(item, { state = "running", badge = "生成中", status = "", progress = 0 } = {}) {
  item.querySelector(".badge").textContent = badge;
  item.querySelector(".badge").dataset.state = state;
  item.querySelector(".run-status").textContent = status;
  item.querySelector(".progress span").style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

function showRunError(item, message, state = "error") {
  updateRunItem(item, {
    state,
    badge: state === "stopped" ? "已停止" : "失败",
    status: state === "stopped" ? "请求已停止。" : "请求失败。",
    progress: 100,
  });
  const error = document.createElement("div");
  error.className = "error-text";
  error.textContent = message;
  item.querySelector(".run-body").appendChild(error);
}

function renderImages(item, images, format, prompt) {
  const grid = item.querySelector(".thumb-grid");
  grid.replaceChildren();
  const ext = getOutputExtension(format);
  const baseName = formatTimestamp();

  images.forEach((image, index) => {
    const figure = document.createElement("figure");
    figure.className = "thumb";

    const media = document.createElement("div");
    media.className = "thumb-media";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "thumb-copy";
    copyBtn.title = "复制该图片使用的提示词";
    copyBtn.setAttribute("aria-label", "复制该图片使用的提示词");
    copyBtn.textContent = "⧉";
    copyBtn.addEventListener("click", () => void copyPrompt(copyBtn, prompt));

    const img = document.createElement("img");
    let href = image.url || "";

    if (image.b64_json) {
      href = `data:image/${format};base64,${image.b64_json}`;
    }

    img.src = href;
    img.alt = `生成图片 ${index + 1}`;

    const caption = document.createElement("figcaption");
    const label = document.createElement("span");
    label.textContent = `图片 ${index + 1}`;
    caption.append(label);

    const actions = document.createElement("div");
    actions.className = "thumb-actions";

    const previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.textContent = "预览";
    previewBtn.addEventListener("click", () => showPreview(href, img.alt));

    const download = document.createElement("a");
    download.href = href;
    download.download = images.length > 1 ? `${baseName}_${index + 1}.${ext}` : `${baseName}.${ext}`;
    download.textContent = "下载";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "删除";
    deleteBtn.className = "danger";
    deleteBtn.addEventListener("click", () => deleteImage(figure, item));

    actions.append(previewBtn, download, deleteBtn);
    media.append(img, copyBtn);
    figure.append(media, caption, actions);
    grid.appendChild(figure);
  });
}

function deleteImage(figure, item) {
  figure.remove();
  if (!item.querySelector(".thumb")) {
    item.remove();
    runItems = runItems.filter((runItem) => runItem !== item);
    renderPagination();
  }
}

function showPreview(src, alt) {
  if (!previewModal) {
    previewModal = document.createElement("div");
    previewModal.className = "preview-modal hidden";
    previewModal.innerHTML = `
      <div class="preview-panel" role="dialog" aria-modal="true" aria-label="图片预览">
        <button type="button" class="preview-close" aria-label="关闭预览">×</button>
        <img alt="" />
      </div>
    `;
    previewModal.addEventListener("click", (event) => {
      if (event.target === previewModal || event.target.classList.contains("preview-close")) {
        previewModal.classList.add("hidden");
      }
    });
    document.body.appendChild(previewModal);
  }

  const img = previewModal.querySelector("img");
  img.src = src;
  img.alt = alt;
  previewModal.classList.remove("hidden");
}

async function copyPrompt(button, prompt) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(prompt);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = prompt;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    const oldText = button.textContent;
    button.textContent = "✓";
    window.setTimeout(() => {
      button.textContent = oldText;
    }, 1200);
  } catch {
    button.textContent = "!";
    window.setTimeout(() => {
      button.textContent = "⧉";
    }, 1200);
  }
}

function buildPayload() {
  const prompt = els.prompt.value.trim();
  const model = els.model.value.trim();
  updateFinalSize();
  const size = els.finalSize.value;
  const count = Number.parseInt(els.count.value, 10);
  const compression = Number.parseInt(els.outputCompression.value, 10);

  if (!els.token.value.trim()) throw new Error("请填写 token。");
  if (!prompt) throw new Error("请填写提示词。");
  if (!model) throw new Error("请填写模型。");
  if (!size) throw new Error("请选择或填写尺寸。");
  if (!/^\d+x\d+$/.test(size)) throw new Error("尺寸格式应类似 1024x1024。");
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("图片数量需要在 1 到 10 之间。");

  const payload = {
    model,
    prompt,
    size,
    quality: els.quality.value,
    output_format: els.outputFormat.value,
    background: els.background.value,
    n: count,
  };

  if (payload.output_format !== "png") {
    if (!Number.isInteger(compression) || compression < 0 || compression > 100) {
      throw new Error("输出压缩需要在 0 到 100 之间。");
    }
    payload.output_compression = compression;
  }

  return payload;
}

function buildEditFormData(payload) {
  const form = new FormData();
  form.append("model", payload.model);
  form.append("prompt", payload.prompt);
  form.append("size", payload.size);
  form.append("quality", payload.quality);
  form.append("output_format", payload.output_format);
  form.append("background", payload.background);
  form.append("n", String(payload.n));

  referenceImages.forEach((item) => {
    form.append("image[]", item.file, item.file.name);
  });

  return form;
}

async function parseResponse(res) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { text, data };
}

function getErrorMessage(res, text, data) {
  const apiMessage = data?.error?.message || data?.message;
  return apiMessage || text || `${res.status} ${res.statusText}`;
}

async function onGenerate() {
  let payload;
  let item;

  try {
    payload = buildPayload();
    item = createRunItem({
      ...payload,
      aspectRatio: els.aspectRatio.value,
      mode: referenceImages.length ? "edit" : "generate",
      referenceCount: referenceImages.length,
    });
  } catch (error) {
    const fallback = createRunItem({
      size: els.finalSize.value || "未计算尺寸",
      aspectRatio: els.aspectRatio.value || "未选择比例",
      quality: els.quality.value,
      output_format: els.outputFormat.value,
      n: els.count.value || 1,
      mode: referenceImages.length ? "edit" : "generate",
      referenceCount: referenceImages.length,
    });
    showRunError(fallback, error.message || String(error));
    return;
  }

  activeAbort?.abort();
  activeAbort = new AbortController();
  els.generateBtn.disabled = true;

  const startedAt = Date.now();
  const waitingTimer = window.setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    updateRunItem(item, {
      badge: "生成中",
      status: `等待接口返回... ${seconds}s`,
      progress: 65,
    });
  }, 1000);

  try {
    const isEdit = referenceImages.length > 0;
    const url = buildApiUrl(isEdit ? EDIT_PATH : GENERATE_PATH);
    updateRunItem(item, { badge: "请求中", status: `正在请求 ${url}`, progress: 20 });

    const res = isEdit
      ? await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${els.token.value.trim()}`,
          },
          body: buildEditFormData(payload),
          signal: activeAbort.signal,
        })
      : await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${els.token.value.trim()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: activeAbort.signal,
        });

    updateRunItem(item, { badge: "解析中", status: "接口已返回，正在解析结果...", progress: 85 });
    const { text, data } = await parseResponse(res);

    if (!res.ok) {
      throw new Error(getErrorMessage(res, text, data));
    }

    const images = Array.isArray(data?.data) ? data.data : [];
    if (!images.length) {
      throw new Error(`接口返回成功，但没有找到 data 图片列表：${text.slice(0, 500)}`);
    }

    renderImages(item, images, payload.output_format, payload.prompt);
    updateRunItem(item, {
      state: "done",
      badge: "完成",
      status: `生成完成，共 ${images.length} 张图片。`,
      progress: 100,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      showRunError(item, "请求已被手动停止。", "stopped");
    } else if (error instanceof TypeError) {
      showRunError(item, `${error.message}\n可能是网络错误、CORS 限制，或请求网址不可访问。`);
    } else {
      showRunError(item, error.message || String(error));
    }
  } finally {
    window.clearInterval(waitingTimer);
    els.generateBtn.disabled = false;
    activeAbort = null;
  }
}

function onFormatChange() {
  const canCompress = els.outputFormat.value !== "png";
  els.outputCompression.disabled = !canCompress;
}

function clampCount(value) {
  const min = Number.parseInt(els.count.min, 10) || 1;
  const max = Number.parseInt(els.count.max, 10) || 10;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function setCount(value) {
  els.count.value = String(clampCount(value));
}

function stepCount(delta) {
  setCount(clampCount(els.count.value) + delta);
}

function hasDraggedFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function onReferenceDragOver(event) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  els.referenceDropzone.classList.add("drag-over");
}

function onReferenceDragLeave(event) {
  if (els.referenceDropzone.contains(event.relatedTarget)) return;
  els.referenceDropzone.classList.remove("drag-over");
}

function onReferenceDrop(event) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  els.referenceDropzone.classList.remove("drag-over");
  addReferenceFiles(Array.from(event.dataTransfer.files || []));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

els.generateBtn.addEventListener("click", () => void onGenerate());
els.tokenClear.addEventListener("click", () => {
  els.token.value = "";
  els.token.focus();
});
els.referenceImages.addEventListener("change", () => {
  addReferenceFiles(Array.from(els.referenceImages.files || []));
  els.referenceImages.value = "";
});
els.referenceDropzone.addEventListener("dragenter", onReferenceDragOver);
els.referenceDropzone.addEventListener("dragover", onReferenceDragOver);
els.referenceDropzone.addEventListener("dragleave", onReferenceDragLeave);
els.referenceDropzone.addEventListener("drop", onReferenceDrop);
els.countMinus.addEventListener("click", () => stepCount(-1));
els.countPlus.addEventListener("click", () => stepCount(1));
els.count.addEventListener("change", () => setCount(els.count.value));
els.sizeTier.addEventListener("change", updateFinalSize);
els.aspectRatio.addEventListener("change", updateFinalSize);
els.outputFormat.addEventListener("change", onFormatChange);
els.pagePrev.addEventListener("click", () => changePage(-1));
els.pageNext.addEventListener("click", () => changePage(1));
window.addEventListener("resize", updatePageSize);

void loadBaseUrlWhitelist();
updateFinalSize();
onFormatChange();
updatePageSize();
