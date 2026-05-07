#!/usr/bin/env python3
"""
将根目录 Home 页面和各插件目录的 static/ 合并构建到 docs/，供 GitHub Pages 发布。

目录结构约定：
  index.html, pages.json  → docs/            （Home 页面，放在项目根目录）
  seedance/                → docs/seedance/   （Seedance 插件页面）
  xxx/                     → docs/xxx/        （未来新插件）

每个插件目录下直接放前端文件（index.html 等），不再嵌套 static/ 子目录。
含 index.html 的根级目录自动识别为插件。
"""
from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DST = ROOT / "docs"

# Home 页面文件（根目录下）
HOME_FILES = ("index.html", "pages.json")

# 排除的目录
EXCLUDE_DIRS = {"docs", ".git", "__pycache__", "node_modules"}



def discover_plugins() -> list[Path]:
    """扫描根目录下所有含 index.html 的文件夹作为插件。"""
    plugins = []
    for d in sorted(ROOT.iterdir()):
        if not d.is_dir() or d.name in EXCLUDE_DIRS or d.name.startswith("."):
            continue
        if (d / "index.html").is_file():
            plugins.append(d)
    return plugins


def main() -> None:
    # 检查 Home 页面文件
    for name in HOME_FILES:
        if not (ROOT / name).is_file():
            raise SystemExit(f"Missing home file: {ROOT / name}")

    # 清理旧 docs
    if DST.exists():
        shutil.rmtree(DST)
    DST.mkdir(parents=True)

    # 1. 复制 Home 页面文件
    for name in HOME_FILES:
        shutil.copy2(ROOT / name, DST / name)

    # 2. 复制各插件目录到 docs/<plugin_name>/（排除非前端文件）
    # 跳过目录名
    SKIP_NAMES = {"Readme", "__pycache__", "tushare-data", "scripts", "references"}
    # 跳过文件扩展名（脚本、文档等不需要发布到 GitHub Pages）
    SKIP_SUFFIXES = {".py", ".md", ".txt"}

    plugins = discover_plugins()
    for plugin_dir in plugins:
        dst = DST / plugin_dir.name
        dst.mkdir(parents=True, exist_ok=True)
        for item in plugin_dir.iterdir():
            if item.name in SKIP_NAMES or item.name.startswith("."):
                continue
            if item.is_file() and item.suffix.lower() in SKIP_SUFFIXES:
                continue
            dest = dst / item.name
            if item.is_dir():
                shutil.copytree(item, dest)
            else:
                shutil.copy2(item, dest)
        print(f"  Plugin: {plugin_dir.name}/ -> docs/{plugin_dir.name}/")

    # 3. GitHub Pages 标记
    (DST / ".nojekyll").touch(exist_ok=True)

    count = sum(1 for f in DST.rglob("*") if f.is_file())
    print(f"Synced {count} files + .nojekyll -> {DST}")
    print(f"Plugins found: {[p.name for p in plugins]}")


if __name__ == "__main__":
    main()
