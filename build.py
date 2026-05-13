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

import json
import shutil
import datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DST = ROOT / "docs"

# Home 页面文件（根目录下）
HOME_FILES = ("index.html", "pages.json")
FALLBACK_ETF_NAMES = {
    "588000.SH": "??50ETF",
    "159995.SZ": "??ETF",
    "159915.SZ": "???ETF",
}

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


def write_momentum_manifest(dst_plugin_dir: Path) -> None:
    output_dir = dst_plugin_dir / "momentum-output"
    if not output_dir.is_dir():
        return

    existing_names = {}
    existing_manifest = output_dir / "index.json"
    if existing_manifest.is_file():
        try:
            existing = json.loads(existing_manifest.read_text(encoding="utf-8"))
            for item in existing.get("files", []):
                if isinstance(item, dict) and item.get("name"):
                    if item.get("ts_code"):
                        existing_names[item["ts_code"]] = item["name"]
                    if item.get("file"):
                        existing_names[item["file"]] = item["name"]
        except Exception:
            existing_names = {}

    items = []
    for path in sorted(output_dir.glob("data*.json")):
        ts_code = path.stem.removeprefix("data")
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            ts_code = payload.get("metadata", {}).get("ts_code") or ts_code
        except Exception:
            pass
        name = existing_names.get(ts_code) or existing_names.get(path.name) or FALLBACK_ETF_NAMES.get(ts_code, ts_code)
        items.append({"ts_code": ts_code, "name": name, "file": path.name})

    manifest = {
        "generated_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(),
        "files": items,
    }
    (output_dir / "index.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


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
        write_momentum_manifest(dst)
        print(f"  Plugin: {plugin_dir.name}/ -> docs/{plugin_dir.name}/")

    # 3. GitHub Pages 标记
    (DST / ".nojekyll").touch(exist_ok=True)

    count = sum(1 for f in DST.rglob("*") if f.is_file())
    print(f"Synced {count} files + .nojekyll -> {DST}")
    print(f"Plugins found: {[p.name for p in plugins]}")


if __name__ == "__main__":
    main()
