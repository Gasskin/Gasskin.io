#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
读取 watch.json，为每只股票拉取最近 3 年的日线数据。
脚本使用 Tushare daily + adj_factor 计算前复权行情，再计算 MA20/MA60/MA120、
成交量均值和成交额均值；同时固定查询最近 3 年的 daily_basic，
补充 pe_ttm、pb 以及对应的历史分位值。输出会保留全部拉取记录，方便逐行验算。

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

MA120_TRADING_DAYS = 120
ADJUSTMENT = "qfq"
PRICE_LOOKBACK_YEARS = 3
VALUATION_LOOKBACK_YEARS = 3

_CST = datetime.timezone(datetime.timedelta(hours=8))
TODAY = datetime.datetime.now(_CST).date()
END_DATE = TODAY.strftime("%Y%m%d")


def years_ago(value: datetime.date, years: int) -> datetime.date:
    try:
        return value.replace(year=value.year - years)
    except ValueError:
        return value.replace(month=2, day=28, year=value.year - years)


PRICE_START_DATE = years_ago(TODAY, PRICE_LOOKBACK_YEARS).strftime("%Y%m%d")
VALUATION_START_DATE = years_ago(TODAY, VALUATION_LOOKBACK_YEARS).strftime("%Y%m%d")


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
    # Avoid ts.pro_bar because older tushare releases still call pandas fillna(method=...).
    daily_df = pro.daily(
        ts_code=ts_code,
        start_date=PRICE_START_DATE,
        end_date=END_DATE,
        fields="ts_code,trade_date,open,close,vol,amount",
    )
    if daily_df is None or daily_df.empty:
        raise RuntimeError(f"{ts_code} 无最新前复权日线数据")

    adj_df = pro.adj_factor(
        ts_code=ts_code,
        start_date=PRICE_START_DATE,
        end_date=END_DATE,
        fields="ts_code,trade_date,adj_factor",
    )
    if adj_df is None or adj_df.empty:
        raise RuntimeError(f"{ts_code} 无复权因子数据")

    missing = {"trade_date", "open", "close", "vol", "amount"} - set(daily_df.columns)
    if missing:
        raise RuntimeError(f"{ts_code} 前复权日线数据缺少字段: {', '.join(sorted(missing))}")

    adj_missing = {"trade_date", "adj_factor"} - set(adj_df.columns)
    if adj_missing:
        raise RuntimeError(f"{ts_code} 复权因子数据缺少字段: {', '.join(sorted(adj_missing))}")

    daily_df = (
        daily_df.drop_duplicates(subset=["trade_date"])
        .sort_values("trade_date")
        .reset_index(drop=True)
    )
    adj_df = (
        adj_df.drop_duplicates(subset=["trade_date"])
        .sort_values("trade_date")
        .reset_index(drop=True)
    )

    merged = daily_df.merge(
        adj_df[["trade_date", "adj_factor"]],
        on="trade_date",
        how="left",
    )
    merged["open"] = pd.to_numeric(merged["open"], errors="coerce")
    merged["close"] = pd.to_numeric(merged["close"], errors="coerce")
    merged["vol"] = pd.to_numeric(merged["vol"], errors="coerce")
    merged["amount"] = pd.to_numeric(merged["amount"], errors="coerce")
    merged["adj_factor"] = pd.to_numeric(merged["adj_factor"], errors="coerce").ffill().bfill()

    latest_adj_factor = merged["adj_factor"].iloc[-1] if not merged.empty else pd.NA
    if pd.isna(latest_adj_factor) or float(latest_adj_factor) == 0:
        raise RuntimeError(f"{ts_code} 最新复权因子无效")

    adjustment_ratio = merged["adj_factor"] / float(latest_adj_factor)
    merged["open"] = merged["open"] * adjustment_ratio
    merged["close"] = merged["close"] * adjustment_ratio

    return merged[["trade_date", "open", "close", "vol", "amount"]].reset_index(drop=True)


def build_quantile_series(series: pd.Series) -> pd.Series:
    values = pd.to_numeric(series, errors="coerce")
    quantiles = pd.Series(index=series.index, dtype="float64")
    valid = values.notna()
    if valid.any():
        quantiles.loc[valid] = values.loc[valid].rank(pct=True, method="max")
    return quantiles


def fetch_daily_basic(pro: Any, ts_code: str) -> pd.DataFrame:
    df = pro.daily_basic(
        ts_code=ts_code,
        start_date=VALUATION_START_DATE,
        end_date=END_DATE,
        fields="ts_code,trade_date,pe_ttm,pb",
    )
    if df is None or df.empty:
        return pd.DataFrame(columns=["trade_date", "pe_ttm", "pe_ttm_quantile", "pb", "pb_quantile"])

    missing = {"trade_date", "pe_ttm", "pb"} - set(df.columns)
    if missing:
        raise RuntimeError(f"{ts_code} daily_basic 数据缺少字段: {', '.join(sorted(missing))}")

    df = (
        df.drop_duplicates(subset=["trade_date"])
        .sort_values("trade_date")
        .reset_index(drop=True)
    )
    df["trade_date"] = df["trade_date"].astype(str)
    df["pe_ttm"] = pd.to_numeric(df["pe_ttm"], errors="coerce")
    df["pb"] = pd.to_numeric(df["pb"], errors="coerce")
    df["pe_ttm_quantile"] = build_quantile_series(df["pe_ttm"])
    df["pb_quantile"] = build_quantile_series(df["pb"])
    return df[["trade_date", "pe_ttm", "pe_ttm_quantile", "pb", "pb_quantile"]]


def round_or_none(value: Any, digits: int = 3) -> float | None:
    if pd.isna(value):
        return None
    return round(float(value), digits)


def build_records(df: pd.DataFrame, valuation_df: pd.DataFrame) -> list[dict[str, Any]]:
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
    if valuation_df.empty:
        for column in ("pe_ttm", "pe_ttm_quantile", "pb", "pb_quantile"):
            df[column] = pd.NA
    else:
        df = df.merge(valuation_df, on="trade_date", how="left")

    records: list[dict[str, Any]] = []
    for row in df.itertuples(index=False):
        records.append({
            "trade_date": str(row.trade_date),
            "open": round_or_none(row.open),
            "close": round_or_none(row.close),
            "pe_ttm": round_or_none(row.pe_ttm),
            "pe_ttm_quantile": round_or_none(row.pe_ttm_quantile, 4),
            "pb": round_or_none(row.pb),
            "pb_quantile": round_or_none(row.pb_quantile, 4),
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
    valuation_rows: int,
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
        "fetch_start_date": PRICE_START_DATE,
        "fetched_rows": len(records),
        "adjustment": ADJUSTMENT,
        "source": "tushare",
        "source_interface": "daily+adj_factor",
        "price_lookback_years": PRICE_LOOKBACK_YEARS,
        "valuation_source_interface": "daily_basic",
        "valuation_lookback_years": VALUATION_LOOKBACK_YEARS,
        "valuation_start_date": VALUATION_START_DATE,
        "valuation_rows": valuation_rows,
        "units": {
            "volume": "hand",
            "amount": "thousand_yuan",
        },
        "update_time": datetime.datetime.now(_CST).strftime("%Y-%m-%d %H:%M:%S"),
        "fields": [
            "trade_date",
            "open",
            "close",
            "pe_ttm",
            "pe_ttm_quantile",
            "pb",
            "pb_quantile",
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
    parser = argparse.ArgumentParser(description="更新 watch.json 中股票的最新日线指标和 3 年估值分位")
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
        f"每只股票拉取最近 {PRICE_LOOKBACK_YEARS} 年前复权日线，"
        f"并补充最近 {VALUATION_LOOKBACK_YEARS} 年 PE/PB 分位值"
    )

    failures: list[tuple[str, str]] = []
    for index, item in enumerate(items, start=1):
        code = str(item["code"]).strip()
        ts_code = to_ts_code(code)
        name = item.get("name") or ts_code
        print(f"[{index}/{len(items)}] 拉取 {name}({ts_code}) ...")

        try:
            df = fetch_daily(pro, ts_code)
            if len(df) < MA120_TRADING_DAYS:
                print(f"  [WARN] 仅获取到 {len(df)} 条，MA120 可能为 null")
            valuation_df = fetch_daily_basic(pro, ts_code)
            records = build_records(df, valuation_df)
            output_path = write_stock_file(item, records, len(valuation_df))
            latest = records[-1]
            print(
                f"  [OK] {len(records)} 条，最新交易日 {latest['trade_date']}，"
                f"PE_TTM={latest['pe_ttm']} (Q={latest['pe_ttm_quantile']}), "
                f"PB={latest['pb']} (Q={latest['pb_quantile']})，已写入 {output_path}"
            )
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
