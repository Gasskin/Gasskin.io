---
name: create-page
description: 基于 GitHub Pages 的静态工具集合站，采用插件化架构，每个功能模块独立开发、统一导航。
---





## 项目结构

```
Gasskin.io/
├── index.html              # Home 页面（侧边栏导航）
├── pages.json              # 侧边栏配置：决定哪些插件出现在导航中
├── build.py                # 构建脚本：合并所有文件到 docs/
├── dev_server.py           # 本地开发服务器（静态托管 + API 反向代理）
├── requirements.txt
├── .gitignore
├── .github/workflows/
│   └── main.yml            # GitHub Actions：唯一 workflow，所有自动化任务都在这
├── seedance/               # ← 插件目录示例
│   ├── index.html          #    插件入口页面
│   ├── app.js              #    插件逻辑
│   ├── style.css           #    插件样式
│   └── Readme/             #    插件文档（不会被构建）
└── docs/                   # 构建产物（.gitignore 已忽略）
```

## 核心设计

### 1. 插件自动发现

`build.py` 会扫描项目根目录，**任何包含 `index.html` 的一级子目录**自动识别为插件，构建时复制到 `docs/<插件名>/`。

以下内容**不会**被复制到构建产物：
- `Readme/` 目录
- `__pycache__/` 目录
- 以 `.` 开头的隐藏文件/目录

### 2. 侧边栏配置（pages.json）

根目录的 `pages.json` 控制 Home 页面侧边栏显示哪些插件：

```json
[
  {
    "id": "seedance",
    "title": "Seedance 视频生成",
    "icon": "🎬",
    "description": "基于火山方舟 Seedance 2.0 的视频生成工具",
    "path": "seedance/index.html"
  }
]
```

| 字段 | 说明 |
|------|------|
| `id` | 唯一标识，用于 URL hash（`#seedance`）和 iframe ID |
| `title` | 侧边栏显示名称 |
| `icon` | Emoji 图标 |
| `description` | 鼠标悬停提示 |
| `path` | 相对于站点根目录的入口页面路径 |

### 3. Home 页面

`index.html` 是整站入口，左侧侧边栏 + 右侧 iframe 加载子页面。支持：
- URL hash 定位（如 `https://xxx.github.io/#seedance` 直接打开对应插件）
- 移动端侧边栏收起/展开

### 4. 构建与部署

```bash
# 本地构建
python build.py

# 本地开发（含 API 反向代理）
python dev_server.py
# 浏览器打开 http://127.0.0.1:8765/

# 生产部署
# 推送到 main 分支，GitHub Actions 自动构建部署
```

GitHub 仓库设置：**Settings → Pages → Source** 选择 **"GitHub Actions"**。

### 5. GitHub Actions（.github/workflows/main.yml）

**规则：所有自动化任务都写在 `main.yml` 这一个文件里，不要新建其他 workflow 文件。**

需要新增自动化任务时，在 `main.yml` 的 `steps` 中追加步骤即可。

当前 steps：

| 步骤 | 说明 |
|------|------|
| Checkout | 拉取代码 |
| Set up Python | 准备 Python 3.11 环境 |
| Update stock data | 安装 tushare/pandas 并运行 `stock/gen_data.py` 刷新行情（失败不阻断部署） |
| Build docs | 运行 `build.py`，打包到 `docs/` |
| Deploy to GitHub Pages | 部署 `docs/` 到 GitHub Pages |

**触发条件：**
- `push` 到 `main` 分支
- 手动：GitHub 页面 → Actions → Run workflow
- 定时：每天北京时间 16/17/18/19/20/21/22 点（cron 用 UTC：`0 8,9,10,11,12,13,14 * * *`）自动刷新股票数据并部署

### 6. 本地开发服务器

`dev_server.py` 提供：
- 静态文件托管（`docs/` 目录）
- `/api/v3/*` 反向代理到 `ark.cn-beijing.volces.com`（解决 CORS）
- 自动为插件页面注入 `window.__SEEDANCE_API_BASE__` 变量

## 如何新增插件

1. **创建插件目录**：在项目根目录新建文件夹（如 `my-tool/`）
2. **添加入口页面**：在目录中创建 `index.html`（以及所需的 js、css 等）
3. **注册到侧边栏**：在 `pages.json` 中添加一条配置
4. **构建验证**：运行 `python build.py`，插件会被自动发现并构建

```bash
# 示例：新增一个 "my-tool" 插件
mkdir my-tool
# 在 my-tool/ 中编写 index.html、app.js、style.css ...

# 在 pages.json 中添加：
# { "id": "my-tool", "title": "我的工具", "icon": "🔧", "description": "...", "path": "my-tool/index.html" }

python build.py
# 输出：Plugin: my-tool/ -> docs/my-tool/
```

插件内部的文档（如 `Readme/`）不会被打包，可放心存放开发文档和 API 说明。

