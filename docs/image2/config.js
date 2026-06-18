// GitHub Pages 是静态托管，不能直接替 OpenAI 响应 CORS 预检。
// 部署 image2/openai-proxy-worker.js 后，把这里改成你的 Worker 地址，例如：
// window.IMAGE2_API_BASE = "https://your-openai-proxy.your-name.workers.dev";
window.IMAGE2_API_BASE = "";
