#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


STOCK_DIR = Path(__file__).resolve().parent
REPO_ROOT = STOCK_DIR.parent
EXPORT_SCRIPT = STOCK_DIR / "momentum-strategy" / "scripts" / "export_momentum_scores.py"
WATCH_FILE = STOCK_DIR / "watch_etf.txt"
OUTPUT_DIR = STOCK_DIR / "momentum-output"
MANIFEST_NAME = "index.json"
DEFAULT_TOKEN_FILE = STOCK_DIR / "token.txt"
FALLBACK_TOKEN_FILE = REPO_ROOT / "token.txt"
FALLBACK_NAMES = {
    "588000.SH": "??50ETF",
    "159995.SZ": "??ETF",
    "159915.SZ": "???ETF",
}


def today_shanghai() -> str:
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime("%Y-%m-%d")


def default_start_date() -> str:
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date()
    try:
        start = today.replace(year=today.year - 3)
    except ValueError:
        # Handle Feb 29 -> Feb 28 on non-leap years.
        start = today.replace(month=2, day=28, year=today.year - 3)
    return start.strftime("%Y-%m-%d")


def normalize_ts_code(code: str) -> str:
    normalized = code.strip().upper()
    if "." in normalized:
        return normalized
    if normalized.startswith(("5", "6")):
        return f"{normalized}.SH"
    if normalized.startswith(("4", "8")):
        return f"{normalized}.BJ"
    return f"{normalized}.SZ"


def output_name_for(ts_code: str) -> str:
    bare_code = ts_code.split(".", 1)[0]
    safe_code = "".join(char for char in bare_code if char.isalnum() or char in ("_", "-"))
    return f"data{safe_code}.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export momentum data for ETFs listed in watch_etf.txt.")
    parser.add_argument("--watch-file", default=str(WATCH_FILE))
    parser.add_argument("--start-date", default=default_start_date())
    parser.add_argument("--end-date", default=today_shanghai())
    parser.add_argument("--output-dir", default=str(OUTPUT_DIR))
    parser.add_argument("--asset-type", choices=["auto", "stock", "fund"], default="auto")
    parser.add_argument("--momentum-short-window", type=int, default=5)
    parser.add_argument("--momentum-long-window", type=int, default=10)
    parser.add_argument("--normalization-window", type=int, default=252)
    parser.add_argument("--normalization-min-rows", type=int, default=60)
    parser.add_argument("--token", help="Optional Tushare token. Otherwise use token file, TUSHARE_TOKEN, or saved token.")
    parser.add_argument("--token-file", default=str(DEFAULT_TOKEN_FILE), help="Path to a file containing a Tushare token.")
    parser.add_argument("--stop-on-error", action="store_true", help="Stop immediately when one code fails.")
    return parser.parse_args()


def read_watch_file(path: Path) -> list[str]:
    if not path.is_file():
        raise FileNotFoundError(f"Watch file not found: {path}")

    codes: list[str] = []
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        codes.append(line.split()[0])

    if not codes:
        raise ValueError(f"No ETF code found in {path}")
    return codes


def clear_output_dir(path: Path) -> None:
    output_dir = path.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if output_dir == STOCK_DIR.resolve() or STOCK_DIR.resolve() not in output_dir.parents:
        raise RuntimeError(f"Refusing to clear unsafe output directory: {output_dir}")

    for item in output_dir.iterdir():
        if item.is_dir():
            shutil.rmtree(item)
        else:
            item.unlink()


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


def load_fund_names(token: str | None) -> dict[str, str]:
    try:
        import tushare as ts
    except ImportError:
        return {}

    real_token = token or os.getenv("TUSHARE_TOKEN", "").strip()
    if not real_token:
        try:
            real_token = (ts.get_token() or "").strip()
        except Exception:
            real_token = ""
    if not real_token:
        return {}

    try:
        df = ts.pro_api(real_token).fund_basic(market="E", status="L")
    except Exception:
        return {}
    if df is None or getattr(df, "empty", True):
        return {}

    names: dict[str, str] = {}
    for row in df.to_dict("records"):
        ts_code = str(row.get("ts_code") or "").upper()
        name = row.get("name") or row.get("fund_name")
        if ts_code and name:
            names[ts_code] = str(name)
    return names


def run_export(args: argparse.Namespace, ts_code: str, output_path: Path, env: dict[str, str]) -> int:
    command = [
        sys.executable,
        str(EXPORT_SCRIPT),
        "--ts-code",
        ts_code,
        "--start-date",
        args.start_date,
        "--end-date",
        args.end_date,
        "--asset-type",
        args.asset_type,
        "--momentum-short-window",
        str(args.momentum_short_window),
        "--momentum-long-window",
        str(args.momentum_long_window),
        "--normalization-window",
        str(args.normalization_window),
        "--normalization-min-rows",
        str(args.normalization_min_rows),
        "--output",
        str(output_path),
    ]

    print(f"Exporting {ts_code} -> {output_path}")
    return subprocess.run(command, cwd=STOCK_DIR, env=env).returncode


def write_manifest(output_dir: Path, items: list[dict[str, str]]) -> None:
    payload = {
        "generated_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(),
        "files": items,
    }
    manifest_path = output_dir / MANIFEST_NAME
    manifest_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    watch_file = Path(args.watch_file)
    output_dir = Path(args.output_dir).resolve()
    token, token_source = resolve_token(args)

    clear_output_dir(output_dir)
    codes = read_watch_file(watch_file)

    env = os.environ.copy()
    if token:
        env["TUSHARE_TOKEN"] = token

    print(f"Loaded {len(codes)} code(s) from {watch_file.resolve()}")
    print(f"Output directory: {output_dir}")
    print(f"Token source: {token_source}")
    fund_names = {**FALLBACK_NAMES, **load_fund_names(token)}

    failures: list[tuple[str, int]] = []
    manifest_items: list[dict[str, str]] = []
    for raw_code in codes:
        ts_code = normalize_ts_code(raw_code)
        file_name = output_name_for(ts_code)
        output_path = output_dir / file_name
        return_code = run_export(args, ts_code, output_path, env)
        if return_code != 0:
            failures.append((ts_code, return_code))
            if args.stop_on_error:
                break
        else:
            manifest_items.append({"ts_code": ts_code, "name": fund_names.get(ts_code, ts_code), "file": file_name})

    write_manifest(output_dir, manifest_items)

    if failures:
        print("Failed exports:")
        for ts_code, return_code in failures:
            print(f"  {ts_code}: exit code {return_code}")
        return 1

    print("All exports finished.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
