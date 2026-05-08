#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
股票数据更新脚本
读取 watch.txt，拉取上证指数 + 自选股日线，计算 MA120 / 水位 / 买入盈亏，
输出 data.json 供前端展示。

使用方法：
  python stock/update_data.py
输出：stock/data.json
"""
from __future__ import annotations

import json, os, time, datetime
from pathlib import Path

try:
    import tushare as ts
    import pandas as pd
except ImportError:
    raise SystemExit("请先安装依赖：pip install tushare pandas")

# ── 认证 ──────────────────────────────────────────────────────────────────────
TOKEN = os.getenv("TUSHARE_TOKEN") or "wwpecc0759164f58b88f05b57d0627629bb1d3c75e30b5683b3ed2f3"
pro = ts.pro_api(TOKEN)

# ── 常量 ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR  = Path(__file__).resolve().parent
WATCH_FILE  = SCRIPT_DIR / "watch.txt"
OUTPUT_FILE = SCRIPT_DIR / "data.json"
INDEX_CODE  = "000001.SH"
INDEX_NAME  = "上证指数"
MA_WINDOW   = 120
today       = datetime.datetime.now()
END_DATE    = today.strftime("%Y%m%d")
START_DATE  = (today - datetime.timedelta(days=730)).strftime("%Y%m%d")


# ── 工具函数 ──────────────────────────────────────────────────────────────────
def to_ts_code(code: str) -> str:
    """将纯数字代码自动补全交易所后缀。"""
    code = code.strip()
    if "." in code:
        return code.upper()
    if code.startswith(("6", "5")):
        return f"{code}.SH"
    if code.startswith(("4", "8")):
        return f"{code}.BJ"
    return f"{code}.SZ"


def get_name(ts_code: str) -> str:
    """从 Tushare 获取证券名称。"""
    for fn in (
        lambda: pro.stock_basic(ts_code=ts_code, fields="ts_code,name"),
        lambda: pro.index_basic(ts_code=ts_code, fields="ts_code,name"),
    ):
        try:
            df = fn()
            if df is not None and not df.empty:
                return str(df.iloc[0]["name"])
        except Exception:
            pass
    return ts_code


def fetch_daily(ts_code: str) -> pd.DataFrame:
    """先尝试股票日线，再尝试指数日线，返回升序排列的 DataFrame。"""
    for fn in (
        lambda: pro.daily(ts_code=ts_code, start_date=START_DATE, end_date=END_DATE),
        lambda: pro.index_daily(ts_code=ts_code, start_date=START_DATE, end_date=END_DATE),
    ):
        try:
            df = fn()
            if df is not None and not df.empty:
                return df.sort_values("trade_date").reset_index(drop=True)
        except Exception:
            pass
    raise RuntimeError(f"无法获取 {ts_code} 行情数据")


def calc_metrics(df: pd.DataFrame, buys: list[float]) -> dict:
    """计算 MA120、水位，以及每笔买入相对当前价格的涨跌幅。"""
    df = df.copy()
    df["ma"] = df["close"].rolling(MA_WINDOW).mean()
    latest = df.iloc[-1]
    prev   = df.iloc[-2] if len(df) >= 2 else latest

    price     = float(latest["close"])
    prev_c    = float(prev["close"])
    ma120_val = float(latest["ma"]) if not pd.isna(latest["ma"]) else None
    change    = round(price - prev_c, 2)
    chg_pct   = round(change / prev_c * 100, 2) if prev_c else 0.0
    water_lvl = round(price / ma120_val * 100, 2) if ma120_val else None

    buy_records = [
        {"price": round(p, 3), "pct": round((price - p) / p * 100, 2)}
        for p in buys
    ]

    return {
        "latest_price": round(price, 2),
        "prev_close":   round(prev_c, 2),
        "change":       change,
        "change_pct":   chg_pct,
        "ma120":        round(ma120_val, 2) if ma120_val else None,
        "water_level":  water_lvl,
        "trade_date":   str(latest["trade_date"]),
        "buys":         buy_records,
    }


# ── 解析 watch.txt ────────────────────────────────────────────────────────────
def parse_watch_file() -> list[dict]:
    """
    格式：
      ---股票名称   ← 块起始（名称供人阅读，解析时忽略）
      股票代码
      备注
      买入价1       ← 第三行起，每行一个买入价（非数字行自动忽略）
      ...
    # 开头的行为注释，空行忽略。
    """
    items = []
    if not WATCH_FILE.is_file():
        return items

    blocks: list[list[str]] = []
    current: list[str] = []

    for raw in WATCH_FILE.read_text(encoding="utf-8-sig").splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue                    # 空行 / 注释行，直接忽略
        if stripped.startswith("---"):
            if current:
                blocks.append(current)
            current = []
        else:
            current.append(stripped)
    if current:
        blocks.append(current)

    for block in blocks:
        if not block:
            continue
        code = block[0]
        note = block[1] if len(block) >= 2 else ""
        buys = []
        for s in block[2:]:
            try:
                buys.append(float(s))
            except ValueError:
                pass                    # 非数字行跳过
        items.append({"code": code, "ts_code": to_ts_code(code), "buys": buys, "note": note})

    return items


# ── 主流程 ────────────────────────────────────────────────────────────────────
def main() -> None:
    # 1. 上证指数
    print(f"拉取上证指数 {INDEX_CODE} ({START_DATE}~{END_DATE}) ...")
    df = fetch_daily(INDEX_CODE)
    idx = {"code": INDEX_CODE, "name": INDEX_NAME, **calc_metrics(df, [])}
    print(f"  最新价: {idx['latest_price']}  MA120: {idx['ma120']}  水位: {idx['water_level']}%")

    # 2. 自选股
    watch_items = parse_watch_file()
    print(f"\n读取 watch.txt，共 {len(watch_items)} 只")
    watchlist = []
    for item in watch_items:
        ts_code = item["ts_code"]
        try:
            time.sleep(0.35)   # 避免触发频率限制
            df2  = fetch_daily(ts_code)
            name = get_name(ts_code)
            time.sleep(0.2)
            stock = {"code": item["code"], "ts_code": ts_code, "name": name,
                     "note": item["note"], **calc_metrics(df2, item["buys"])}
            watchlist.append(stock)
            print(f"  ✓ {name}({ts_code})  当前: {stock['latest_price']}  "
                  f"水位: {stock['water_level']}%")
        except Exception as e:
            print(f"  ✗ {ts_code} 失败: {e}")
            watchlist.append({
                "code": item["code"], "ts_code": ts_code,
                "name": ts_code, "note": item["note"],
                "error": str(e),
                "buys": [{"price": p, "pct": None} for p in item["buys"]],
            })

    output = {
        "update_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "index":       idx,
        "watchlist":   watchlist,
    }
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\n已写入 {OUTPUT_FILE}")


if __name__ == "__main__":
    main()

