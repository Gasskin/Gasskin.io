// GitHub Pages 是静态托管，不能直接替目标 API 响应 CORS 预检。
// 部署 image2/openai-proxy-worker.js 后，把这里改成你的 Worker 地址，例如：
// window.IMAGE2_PROXY_BASE = "https://your-image-proxy.your-name.workers.dev";
window.IMAGE2_PROXY_BASE = "https://green-cherry-a115.q415753928.workers.dev";

// 兼容旧配置名；新配置建议使用 IMAGE2_PROXY_BASE。
window.IMAGE2_API_BASE = window.IMAGE2_PROXY_BASE;
