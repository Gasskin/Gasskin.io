#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path


STOCK_DIR = Path(__file__).resolve().parent
REPO_ROOT = STOCK_DIR.parent
EXPORT_SCRIPT = STOCK_DIR / "momentum-strategy" / "scripts" / "export_momentum_scores.py"
OUTPUT_DIR = STOCK_DIR / "momentum-output"
MANIFEST_NAME = "index.json"
DEFAULT_TOKEN_FILE = STOCK_DIR / "token.txt"
FALLBACK_TOKEN_FILE = REPO_ROOT / "token.txt"
DEFAULT_TS_CODE = "588000.SH"
DEFAULT_START_DATE = "2024-01-01"
FALLBACK_NAMES = {
    "588000.SH": "??50ETF",
    "159995.SZ": "??ETF",
    "159915.SZ": "???ETF",
}


def today_shanghai() -> str:
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime("%Y-%m-%d")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export 588000.SH momentum data.")
    parser.add_argument("--ts-code", default=DEFAULT_TS_CODE)
    parser.add_argument("--start-date", default=DEFAULT_START_DATE)
    parser.add_argument("--end-date", default=today_shanghai())
    parser.add_argument("--output-dir", default=str(OUTPUT_DIR))
    parser.add_argument("--output-name", default="data588000.json")
    parser.add_argument("--token", help="Optional Tushare token. Otherwise use TUSHARE_TOKEN or saved token.")
    parser.add_argument("--token-file", default=str(DEFAULT_TOKEN_FILE), help="Path to a file containing a Tushare token.")
    return parser.parse_args()


def resolve_token(args: argparse.Namespace) -> tuple[str | None, str]:
    if args.token:
        return args.token.strip(), "argument"

    token_file = Path(args.token_file)
    if token_file.is_file():
        token = token_file.read_text(encoding="utf-8-sig").strip()
        if token:
            return token, str(token_file.resolve())

    if token_file.resolve() != FALLBACK_TOKEN_FILE.resolve() and FALLBACK_TOKEN_FILE.is_file():
        token = FALLBACK_TOKEN_FILE.read_text(encoding="utf-8-sig").strip()
        if token:
            return token, str(FALLBACK_TOKEN_FILE.resolve())

    return None, "environment_or_saved"


def write_manifest(output_dir: Path, ts_code: str, file_name: str) -> None:
    payload = {
        "generated_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(),
        "files": [{"ts_code": ts_code, "name": FALLBACK_NAMES.get(ts_code, ts_code), "file": file_name}],
    }
    (output_dir / MANIFEST_NAME).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    token, token_source = resolve_token(args)
    output_name = args.output_name

    command = [
        sys.executable,
        str(EXPORT_SCRIPT),
        "--ts-code",
        args.ts_code,
        "--start-date",
        args.start_date,
        "--end-date",
        args.end_date,
        "--asset-type",
        "fund",
        "--output",
        str(output_dir / output_name),
    ]

    env = os.environ.copy()
    if token:
        env["TUSHARE_TOKEN"] = token

    print("Token source:", token_source)
    print("Running:", " ".join(command))
    return_code = subprocess.run(command, cwd=STOCK_DIR, env=env).returncode
    if return_code == 0:
        write_manifest(output_dir, args.ts_code, output_name)
    return return_code


if __name__ == "__main__":
    raise SystemExit(main())
