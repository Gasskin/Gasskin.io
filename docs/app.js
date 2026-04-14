const API_BASE = (() => {
  const g = typeof window !== "undefined" ? window : {};
  const o = g.__SEEDANCE_API_BASE__;
  if (o) return String(o).replace(/\/$/, "");
  return "https://ark.cn-beijing.volces.com/api/v3";
})();
const MAX_IMAGES_REF = 9;
const MAX_VIDEOS = 3;
const MAX_AUDIOS = 3;
const POLL_MS = 2500;

const $ = (id) => document.getElementById(id);

const els = {
  images: $("images"),
  videoUrls: $("videoUrls"),
  audios: $("audios"),
  fileList: $("fileList"),
  prompt: $("prompt"),
  modelId: $("modelId"),
  imageMode: $("imageMode"),
  duration: $("duration"),
  resolution: $("resolution"),
  ratio: $("ratio"),
  generateAudio: $("generateAudio"),
  watermark: $("watermark"),
  returnLastFrame: $("returnLastFrame"),
  seed: $("seed"),
  apiKey: $("apiKey"),
  btnGenerate: $("btnGenerate"),
  btnStop: $("btnStop"),
  statusLog: $("statusLog"),
  resultEmpty: $("resultEmpty"),
  resultVideo: $("resultVideo"),
  resultLink: $("resultLink"),
  videoUrl: $("videoUrl"),
};

let pollAbort = null;
/** 本次点击「生成」进入主流程后的起始时间（performance.now），用于「总计用时」 */
let statusRunStart = null;

function fmtElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "0.0 秒";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} 秒`;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m} 分 ${r < 10 ? r.toFixed(1) : Math.round(r)} 秒`;
}

function setStatus(text, isError = false) {
  const msg = String(text ?? "");
  const elapsed = statusRunStart != null ? performance.now() - statusRunStart : null;
  const line =
    elapsed != null ? `${msg}　｜　总计用时：${fmtElapsed(elapsed)}` : msg;
  els.statusLog.textContent = line;
  els.statusLog.classList.toggle("stat-err", isError);
  if (line.length > 180) els.statusLog.title = line;
  else els.statusLog.removeAttribute("title");
}

function clearStatus() {
  statusRunStart = null;
  els.statusLog.textContent = "";
  els.statusLog.classList.remove("stat-err");
  els.statusLog.removeAttribute("title");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readFiles(input) {
  return Array.from(input?.files ?? []);
}

function parseVideoUrlLines() {
  const raw = (els.videoUrls?.value ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return raw.slice(0, MAX_VIDEOS);
}

function isAllowedReferenceVideoUrl(u) {
  const s = String(u).trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (lower.startsWith("https://") || lower.startsWith("http://")) return true;
  if (lower.startsWith("asset://")) return true;
  return false;
}

function updateFileList() {
  const parts = [];
  for (const f of readFiles(els.images)) parts.push(`图: ${f.name} (${fmtSize(f.size)})`);
  for (const u of parseVideoUrlLines()) parts.push(`视频 URL: ${u.slice(0, 120)}${u.length > 120 ? "…" : ""}`);
  for (const f of readFiles(els.audios)) parts.push(`音频: ${f.name} (${fmtSize(f.size)})`);
  els.fileList.innerHTML = parts.length ? parts.map((p) => `<li>${escapeHtml(p)}</li>`).join("") : "<li>未选择文件 / 未填写视频 URL</li>";
}

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function parseApiError(res, bodyText) {
  let msg = `${res.status} ${res.statusText}`;
  try {
    const j = JSON.parse(bodyText);
    if (j.error) {
      const c = j.error.code ?? "";
      const m = j.error.message ?? "";
      msg = [msg, c && `code: ${c}`, m && `message: ${m}`].filter(Boolean).join(" | ");
    }
  } catch {
    if (bodyText) msg += ` | ${bodyText.slice(0, 500)}`;
  }
  return msg;
}

function validateInputs({ imageFiles, videoUrlList, audioFiles, mode }) {
  if (audioFiles.length && !imageFiles.length && !videoUrlList.length) {
    return "参考音频不可单独使用：请至少上传一张图片或填写一条参考视频 URL。";
  }
  if (audioFiles.length > MAX_AUDIOS) return `参考音频最多 ${MAX_AUDIOS} 段。`;
  if (videoUrlList.length > MAX_VIDEOS) return `参考视频 URL 最多 ${MAX_VIDEOS} 条。`;
  for (const u of videoUrlList) {
    if (!isAllowedReferenceVideoUrl(u)) {
      return `参考视频须为 http(s) 公网 URL 或 asset:// 素材 ID，当前行不合法：${u.slice(0, 80)}`;
    }
  }

  if (mode === "first") {
    if (imageFiles.length !== 1) return "「首帧」模式需要且仅需 1 张图片。";
  } else if (mode === "first_last") {
    if (imageFiles.length !== 2) return "「首尾帧」模式需要且仅需 2 张图片。";
  } else {
    if (imageFiles.length > MAX_IMAGES_REF) return `多模态参考图最多 ${MAX_IMAGES_REF} 张。`;
  }
  return null;
}

async function buildContent(imageFiles, videoUrlList, audioFiles, mode, text) {
  const content = [];
  if (text.trim()) {
    content.push({ type: "text", text: text.trim() });
  }
  if (mode === "first" && imageFiles.length === 1) {
    const url = await fileToDataUrl(imageFiles[0]);
    content.push({ type: "image_url", image_url: { url }, role: "first_frame" });
  } else if (mode === "first_last" && imageFiles.length === 2) {
    const u0 = await fileToDataUrl(imageFiles[0]);
    const u1 = await fileToDataUrl(imageFiles[1]);
    content.push({ type: "image_url", image_url: { url: u0 }, role: "first_frame" });
    content.push({ type: "image_url", image_url: { url: u1 }, role: "last_frame" });
  } else {
    for (const f of imageFiles) {
      const url = await fileToDataUrl(f);
      content.push({ type: "image_url", image_url: { url }, role: "reference_image" });
    }
  }
  for (const url of videoUrlList) {
    content.push({ type: "video_url", video_url: { url }, role: "reference_video" });
  }
  for (const f of audioFiles) {
    const url = await fileToDataUrl(f);
    content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" });
  }
  if (!content.length) {
    throw new Error("请填写提示词或上传至少一类素材。");
  }
  return content;
}

function buildRequestBody(content) {
  const durationVal = parseInt(els.duration.value, 10);
  const seedVal = parseInt(els.seed.value, 10);
  const body = {
    model: els.modelId.value,
    content,
    generate_audio: els.generateAudio.checked,
    watermark: els.watermark.checked,
    resolution: els.resolution.value,
    ratio: els.ratio.value,
    duration: Number.isFinite(durationVal) ? durationVal : 5,
  };
  if (els.returnLastFrame.checked) body.return_last_frame = true;
  if (Number.isFinite(seedVal)) body.seed = seedVal;
  return body;
}

function resetResult() {
  els.resultEmpty.classList.remove("hidden");
  els.resultVideo.classList.add("hidden");
  els.resultLink.classList.add("hidden");
  els.resultVideo.removeAttribute("src");
}

function showResultVideo(url) {
  els.resultEmpty.classList.add("hidden");
  els.resultVideo.classList.remove("hidden");
  els.resultLink.classList.remove("hidden");
  els.resultVideo.src = url;
  els.videoUrl.href = url;
}

async function apiFetch(path, apiKey, opts = {}) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    ...opts.headers,
  };
  if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  const text = await res.text();
  return { res, text };
}

async function pollTask(taskId, apiKey, signal) {
  const path = `/contents/generations/tasks/${encodeURIComponent(taskId)}`;
  while (!signal.aborted) {
    const { res, text } = await apiFetch(path, apiKey, { method: "GET", signal });
    if (!res.ok) {
      throw new Error(await parseApiError(res, text));
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`查询任务返回非 JSON：${text.slice(0, 200)}`);
    }
    const st = data.status ?? "";
    setStatus(`当前状态：${st || "（无 status）"}${taskId ? ` · 任务 ${taskId}` : ""}`);

    if (st === "succeeded") {
      const v =
        data.content?.video_url ||
        data.content?.file_url ||
        (typeof data.content === "string" ? null : null);
      if (v) return { data, videoUrl: v };
      const snippet = JSON.stringify(data).slice(0, 400);
      throw new Error(`任务成功但未解析到视频地址。响应片段：${snippet}`);
    }
    if (st === "failed" || st === "cancelled" || st === "expired") {
      const code = data.error?.code ?? "";
      const msg = data.error?.message ?? text;
      throw new Error(`任务结束: ${st}${code ? ` | code: ${code}` : ""}${msg ? ` | ${msg}` : ""}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error("已停止轮询。");
}

async function onGenerate() {
  const apiKey = els.apiKey.value.trim();
  if (!apiKey) {
    clearStatus();
    setStatus("请填写 ARK API Key。", true);
    return;
  }

  const imageFiles = readFiles(els.images);
  const videoUrlList = parseVideoUrlLines();
  const audioFiles = readFiles(els.audios);
  const mode = els.imageMode.value;

  const err = validateInputs({ imageFiles, videoUrlList, audioFiles, mode });
  if (err) {
    clearStatus();
    setStatus(err, true);
    return;
  }

  clearStatus();
  resetResult();
  pollAbort?.abort();
  pollAbort = new AbortController();
  const { signal } = pollAbort;

  els.btnGenerate.disabled = true;
  els.btnStop.disabled = false;

  try {
    statusRunStart = performance.now();
    setStatus("正在读取本地文件并构造请求…");
    const content = await buildContent(imageFiles, videoUrlList, audioFiles, mode, els.prompt.value);
    const body = buildRequestBody(content);
    const json = JSON.stringify(body);
    if (json.length > 62 * 1024 * 1024) {
      setStatus("请求体过大，请减小素材或改用公网 URL / 素材库方式。", true);
      return;
    }
    setStatus("正在创建生成任务…");
    const { res, text } = await apiFetch("/contents/generations/tasks", apiKey, {
      method: "POST",
      body: json,
      signal,
    });
    if (!res.ok) {
      setStatus(await parseApiError(res, text), true);
      return;
    }
    const created = JSON.parse(text);
    const taskId = created.id;
    if (!taskId) {
      setStatus(`创建响应异常: ${text.slice(0, 800)}`, true);
      return;
    }
    setStatus(`任务已创建，正在轮询… · ${taskId}`);
    const { videoUrl } = await pollTask(taskId, apiKey, signal);
    setStatus("生成成功。");
    showResultVideo(videoUrl);
  } catch (e) {
    if (e.name === "AbortError") {
      setStatus("请求已中断。", true);
    } else {
      setStatus(e.message || String(e), true);
    }
  } finally {
    els.btnGenerate.disabled = false;
    els.btnStop.disabled = true;
  }
}

function onStop() {
  pollAbort?.abort();
}

els.images.addEventListener("change", updateFileList);
els.videoUrls.addEventListener("input", updateFileList);
els.audios.addEventListener("change", updateFileList);
els.btnGenerate.addEventListener("click", () => void onGenerate());
els.btnStop.addEventListener("click", onStop);

updateFileList();
