#!/usr/bin/env python3
"""Build the GitHub Pages site into docs/.

Project layout:
  index.html, pages.json -> docs/
  seedance/              -> docs/seedance/
  stock/                 -> docs/stock/

Plugin directories are discovered by a root-level index.html. The stock page is
published with an explicit allowlist so legacy data files and local scripts do
not leak into GitHub Pages.
"""
from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DST = ROOT / "docs"

HOME_FILES = ("index.html", "pages.json")
EXCLUDE_DIRS = {"docs", ".git", "__pycache__", "node_modules"}
SKIP_NAMES = {"Readme", "__pycache__", "tushare-data", "scripts", "references"}
SKIP_SUFFIXES = {".py", ".pyc", ".md", ".txt"}
STOCK_PUBLISH_ITEMS = {"index.html", "app.js", "style.css", "watch.json", "watch_data"}



def discover_plugins() -> list[Path]:
    """Find root-level directories that contain an index.html."""
    plugins = []
    for d in sorted(ROOT.iterdir()):
        if not d.is_dir() or d.name in EXCLUDE_DIRS or d.name.startswith("."):
            continue
        if (d / "index.html").is_file():
            plugins.append(d)
    return plugins


def should_publish(plugin_dir: Path, item: Path) -> bool:
    if plugin_dir.name == "stock":
        return item.name in STOCK_PUBLISH_ITEMS

    if item.name in SKIP_NAMES or item.name.startswith("."):
        return False
    if item.is_file() and item.suffix.lower() in SKIP_SUFFIXES:
        return False
    return True


def copy_item(src: Path, dest: Path) -> None:
    if src.is_dir():
        shutil.copytree(src, dest)
    else:
        shutil.copy2(src, dest)


def main() -> None:
    for name in HOME_FILES:
        if not (ROOT / name).is_file():
            raise SystemExit(f"Missing home file: {ROOT / name}")

    if DST.exists():
        shutil.rmtree(DST)
    DST.mkdir(parents=True)

    for name in HOME_FILES:
        shutil.copy2(ROOT / name, DST / name)

    plugins = discover_plugins()
    for plugin_dir in plugins:
        dst = DST / plugin_dir.name
        dst.mkdir(parents=True, exist_ok=True)
        for item in plugin_dir.iterdir():
            if not should_publish(plugin_dir, item):
                continue
            copy_item(item, dst / item.name)
        print(f"  Plugin: {plugin_dir.name}/ -> docs/{plugin_dir.name}/")

    (DST / ".nojekyll").touch(exist_ok=True)

    count = sum(1 for f in DST.rglob("*") if f.is_file())
    print(f"Synced {count} files + .nojekyll -> {DST}")
    print(f"Plugins found: {[p.name for p in plugins]}")


if __name__ == "__main__":
    main()
