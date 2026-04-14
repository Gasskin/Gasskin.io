#!/usr/bin/env python3
"""将 static/ 同步到 docs/，供 GitHub Pages 发布。"""
from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "static"
DST = ROOT / "docs"
ASSETS = ("index.html", "app.js", "style.css")


def main() -> None:
    if not SRC.is_dir():
        raise SystemExit(f"Missing source directory: {SRC}")
    DST.mkdir(parents=True, exist_ok=True)
    for name in ASSETS:
        path = SRC / name
        if not path.is_file():
            raise SystemExit(f"Missing file: {path}")
        shutil.copy2(path, DST / name)
    (DST / ".nojekyll").touch(exist_ok=True)
    print(f"Synced {len(ASSETS)} files + .nojekyll -> {DST}")


if __name__ == "__main__":
    main()
