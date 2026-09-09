"use strict";

const promptList = document.getElementById("promptList");
const loadStatus = document.getElementById("loadStatus");
const copyStatus = document.getElementById("copyStatus");
const retryButton = document.getElementById("retryButton");

async function copyPrompt(content, button, title) {
  button.disabled = true;
  copyStatus.textContent = "";
  try {
    let copied = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(content);
        copied = true;
      } catch { /* Fall back when clipboard permission is unavailable. */ }
    }
    if (!copied) {
      const input = document.createElement("textarea");
      input.value = content;
      input.className = "copy-fallback";
      document.body.appendChild(input);
      try {
        input.focus();
        input.select();
        copied = document.execCommand("copy");
      } finally {
        input.remove();
        button.focus();
      }
    }
    if (!copied) throw new Error("Clipboard unavailable");
    copyStatus.textContent = `已复制「${title}」的内容。`;
    if (window.parent !== window) {
      window.parent.postMessage({ type: "prompt-guide:close" }, location.origin);
    }
  } catch {
    copyStatus.textContent = "复制失败，请选中提示词正文后手动复制。";
  } finally {
    button.disabled = false;
  }
}

async function loadPrompts() {
  retryButton.hidden = true;
  promptList.replaceChildren();
  copyStatus.textContent = "";
  loadStatus.textContent = "正在读取提示词…";
  try {
    const response = await fetch("prompt-guide.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = await response.json();
    if (config?.version !== 1 || !Array.isArray(config.prompts)
        || config.prompts.some((item) => !item || typeof item.title !== "string" || !item.title.trim()
          || typeof item.content !== "string" || !item.content.trim())) {
      throw new Error("需要 version: 1 和 prompts 数组，每项必须含非空 title、content。");
    }
    for (const item of config.prompts) {
      const card = document.createElement("article");
      card.className = "prompt-card";
      const header = document.createElement("header");
      const title = document.createElement("h2");
      title.textContent = item.title;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "复制内容";
      button.setAttribute("aria-label", `复制 ${item.title} 的内容`);
      button.addEventListener("click", () => copyPrompt(item.content, button, item.title));
      const createButton = document.createElement("button");
      createButton.type = "button";
      createButton.textContent = "创建 TEXT 节点";
      createButton.setAttribute("aria-label", `使用 ${item.title} 创建 TEXT 节点`);
      createButton.disabled = window.parent === window;
      if (createButton.disabled) createButton.title = "请从画布中的提示词指南打开此页面，以创建节点。";
      createButton.addEventListener("click", () => {
        createButton.disabled = true;
        window.parent.postMessage({ type: "prompt-guide:create-text", content: item.content }, location.origin);
      });
      const actions = document.createElement("div");
      actions.className = "prompt-actions";
      actions.append(button, createButton);
      const content = document.createElement("p");
      content.className = "prompt-content";
      content.textContent = item.content;
      header.append(title, actions);
      card.append(header, content);
      promptList.appendChild(card);
    }
    loadStatus.textContent = config.prompts.length ? `共 ${config.prompts.length} 组提示词` : "暂无提示词，请在 canvas/prompt-guide.json 中添加。";
  } catch (error) {
    loadStatus.textContent = `提示词加载失败：${error.message} 请检查 canvas/prompt-guide.json。`;
    retryButton.hidden = false;
  }
}

retryButton.addEventListener("click", loadPrompts);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && window.parent !== window) {
    window.parent.postMessage({ type: "prompt-guide:close" }, location.origin);
  }
});
loadPrompts();
