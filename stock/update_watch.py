#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
读取 watch.json，为每只股票拉取最新 1 个交易日 + 前 120 个交易日的数据。
脚本使用 Tushare pro_bar 直接获取前复权行情，再计算 MA20/MA60/MA120、
成交量均值和成交额均值。输出会保留全部拉取记录，方便逐行验算。

使用方法：
  python stock/update_watch.py
  python stock/update_watch.py --code 000333
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import time
from pathlib import Path
from typing import Any

try:
    import pandas as pd
    import tushare as ts
except ImportError:
    raise SystemExit("请先安装依赖：pip install tushare pandas")


SCRIPT_DIR = Path(__file__).resolve().parent
WATCH_FILE = SCRIPT_DIR / "watch.json"
TOKEN_FILE = SCRIPT_DIR / "token.txt"
OUTPUT_DIR = SCRIPT_DIR / "watch_data"

WARMUP_TRADING_DAYS = 120
TOTAL_TRADING_DAYS = WARMUP_TRADING_DAYS + 1
ADJUSTMENT = "qfq"

_CST = datetime.timezone(datetime.timedelta(hours=8))
TODAY = datetime.datetime.now(_CST)
END_DATE = TODAY.strftime("%Y%m%d")


def read_token() -> str:
    token = os.getenv("TUSHARE_TOKEN")
    if token:
        return token.strip()
    if TOKEN_FILE.is_file():
        token = TOKEN_FILE.read_text(encoding="utf-8-sig").strip()
        if token:
            return token
    raise RuntimeError("未找到 Tushare token，请设置 TUSHARE_TOKEN 或填写 stock/token.txt")


def to_ts_code(code: str) -> str:
    code = code.strip()
    if "." in code:
        return code.upper()
    if code.startswith(("6", "5")):
        return f"{code}.SH"
    if code.startswith(("4", "8")):
        return f"{code}.BJ"
    return f"{code}.SZ"


def load_watchlist() -> list[dict[str, Any]]:
    if not WATCH_FILE.is_file():
        raise FileNotFoundError(f"找不到 {WATCH_FILE}")

    data = json.loads(WATCH_FILE.read_text(encoding="utf-8-sig"))
    if not isinstance(data, list):
        raise ValueError("watch.json 顶层结构应为数组")

    items: list[dict[str, Any]] = []
    for index, item in enumerate(data, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"watch.json 第 {index} 项不是对象")
        code = str(item.get("code", "")).strip()
        if not code:
            raise ValueError(f"watch.json 第 {index} 项缺少 code")
        items.append(item)
    return items


def fetch_daily(pro: Any, ts_code: str) -> pd.DataFrame:
    df = ts.pro_bar(
        ts_code=ts_code,
        api=pro,
        adj=ADJUSTMENT,
        end_date=END_DATE,
        limit=TOTAL_TRADING_DAYS,
        fields="ts_code,trade_date,open,close,vol,amount",
    )
    if df is None or df.empty:
        raise RuntimeError(f"{ts_code} 无最新前复权日线数据")

    missing = {"trade_date", "open", "close", "vol", "amount"} - set(df.columns)
    if missing:
        raise RuntimeError(f"{ts_code} 前复权日线数据缺少字段: {', '.join(sorted(missing))}")

    return (
        df.drop_duplicates(subset=["trade_date"])
        .sort_values("trade_date")
        .reset_index(drop=True)
    )


def round_or_none(value: Any, digits: int = 3) -> float | None:
    if pd.isna(value):
        return None
    return round(float(value), digits)


def build_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    df = df.copy()
    df["trade_date"] = df["trade_date"].astype(str)
    for column in ("open", "close", "vol", "amount"):
        df[column] = pd.to_numeric(df[column], errors="coerce")

    df["ma20"] = df["close"].rolling(20).mean()
    df["ma60"] = df["close"].rolling(60).mean()
    df["ma120"] = df["close"].rolling(120).mean()
    df["volume_ma5"] = df["vol"].rolling(5).mean()
    df["volume_ma20"] = df["vol"].rolling(20).mean()
    df["amount_ma5"] = df["amount"].rolling(5).mean()
    df["amount_ma20"] = df["amount"].rolling(20).mean()

    records: list[dict[str, Any]] = []
    for row in df.itertuples(index=False):
        records.append({
            "trade_date": str(row.trade_date),
            "open": round_or_none(row.open),
            "close": round_or_none(row.close),
            "ma20": round_or_none(row.ma20),
            "ma60": round_or_none(row.ma60),
            "ma120": round_or_none(row.ma120),
            "volume": round_or_none(row.vol),
            "volume_ma5": round_or_none(row.volume_ma5),
            "volume_ma20": round_or_none(row.volume_ma20),
            "amount": round_or_none(row.amount),
            "amount_ma5": round_or_none(row.amount_ma5),
            "amount_ma20": round_or_none(row.amount_ma20),
        })
    return records


def write_stock_file(
    item: dict[str, Any],
    records: list[dict[str, Any]],
) -> Path:
    code = str(item["code"]).strip()
    first_record = records[0]
    latest_record = records[-1]
    output = {
        "code": code,
        "ts_code": to_ts_code(code),
        "name": item.get("name", ""),
        "start_date": first_record["trade_date"],
        "end_date": latest_record["trade_date"],
        "fetch_start_date": first_record["trade_date"],
        "warmup_trading_days": WARMUP_TRADING_DAYS,
        "fetched_rows": len(records),
        "adjustment": ADJUSTMENT,
        "source": "tushare",
        "source_interface": "pro_bar",
        "units": {
            "volume": "hand",
            "amount": "thousand_yuan",
        },
        "update_time": datetime.datetime.now(_CST).strftime("%Y-%m-%d %H:%M:%S"),
        "fields": [
            "trade_date",
            "open",
            "close",
            "ma20",
            "ma60",
            "ma120",
            "volume",
            "volume_ma5",
            "volume_ma20",
            "amount",
            "amount_ma5",
            "amount_ma20",
        ],
        "records": records,
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / f"{code}.json"
    output_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    return output_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="更新 watch.json 中股票的最新日线指标")
    parser.add_argument("--code", help="只更新指定股票代码，例如 000333")
    parser.add_argument("--sleep", type=float, default=0.35, help="每只股票之间的等待秒数")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    token = read_token()
    pro = ts.pro_api(token)

    items = load_watchlist()
    if args.code:
        target_code = args.code.strip()
        items = [item for item in items if str(item.get("code", "")).strip() == target_code]
        if not items:
            raise SystemExit(f"watch.json 中找不到股票代码 {target_code}")

    print(
        f"读取 watch.json，共 {len(items)} 只，"
        f"每只股票拉取并输出最近 {TOTAL_TRADING_DAYS} 条前复权日线"
    )

    failures: list[tuple[str, str]] = []
    for index, item in enumerate(items, start=1):
        code = str(item["code"]).strip()
        ts_code = to_ts_code(code)
        name = item.get("name") or ts_code
        print(f"[{index}/{len(items)}] 拉取 {name}({ts_code}) ...")

        try:
            df = fetch_daily(pro, ts_code)
            if len(df) < TOTAL_TRADING_DAYS:
                print(f"  [WARN] 仅获取到 {len(df)} 条，MA120 可能为 null")
            records = build_records(df)
            output_path = write_stock_file(item, records)
            print(f"  [OK] {len(records)} 条，最新交易日 {records[-1]['trade_date']}，已写入 {output_path}")
        except Exception as exc:
            failures.append((ts_code, str(exc)))
            print(f"  [FAIL] {ts_code} 失败: {exc}")

        if index < len(items) and args.sleep > 0:
            time.sleep(args.sleep)

    if failures:
        print("\n部分股票更新失败：")
        for ts_code, error in failures:
            print(f"  - {ts_code}: {error}")
        raise SystemExit(1)

    print("\nwatch_data 更新完成")


if __name__ == "__main__":
    main()
