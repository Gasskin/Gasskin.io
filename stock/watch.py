#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Watch ETF prices from Tushare.

Default files are resolved from this script directory:
- key.txt: Tushare token, first non-empty non-comment line
- etf.txt: one ETF/security code per line, ignoring blank lines and lines
  beginning with '#'
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any


PRICE_FIELDS = "ts_code,trade_date,open,high,low,close"
HIGH_LOOKBACK = 21
LOW_LOOKBACK = 11
NEEDED_BARS = HIGH_LOOKBACK + 1
EPSILON = 1e-8


@dataclass
class FetchResult:
    data: Any
    source: str
    start_date: str
    errors: list[str]


@dataclass
class CodeResult:
    code: str
    ok: bool
    summary: str


def script_dir() -> Path:
    return Path(__file__).resolve().parent


def configure_output_encoding() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")


def parse_yyyymmdd(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y%m%d").date()
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"日期必须是 YYYYMMDD 格式: {value}") from exc


def yyyymmdd(value: date) -> str:
    return value.strftime("%Y%m%d")


def display_date(value: str) -> str:
    try:
        return datetime.strptime(str(value), "%Y%m%d").strftime("%Y-%m-%d")
    except ValueError:
        return str(value)


def read_token(key_file: Path) -> str:
    if not key_file.exists():
        raise FileNotFoundError(f"找不到 Tushare key 文件: {key_file}")

    for line in key_file.read_text(encoding="utf-8-sig").splitlines():
        text = line.strip()
        if not text or text.startswith("#"):
            continue
        if "=" in text:
            text = text.split("=", 1)[1].strip()
        token = text.strip().strip('"').strip("'")
        if token:
            return token

    raise ValueError(f"{key_file} 中没有找到有效 token")


def normalize_ts_code(code: str) -> str:
    text = code.strip().upper()
    if not text:
        return text

    if "." in text:
        symbol, exchange = text.split(".", 1)
        return f"{symbol.strip()}.{exchange.strip()}"

    if len(text) == 6 and text.isdigit():
        if text.startswith(("5", "6", "9")):
            return f"{text}.SH"
        if text.startswith(("0", "1", "2", "3")):
            return f"{text}.SZ"
        if text.startswith(("4", "8")):
            return f"{text}.BJ"

    return text


def read_codes(etf_file: Path) -> list[str]:
    if not etf_file.exists():
        raise FileNotFoundError(f"找不到 ETF 列表文件: {etf_file}")

    codes: list[str] = []
    seen: set[str] = set()
    for line_no, line in enumerate(etf_file.read_text(encoding="utf-8-sig").splitlines(), start=1):
        text = line.strip()
        if not text or text.startswith("#"):
            continue

        text = text.split("#", 1)[0].strip()
        if not text:
            continue

        code = normalize_ts_code(text.split()[0])
        if not code:
            continue
        if code in seen:
            print(f"提示: {etf_file.name} 第 {line_no} 行重复代码 {code}，已忽略。")
            continue
        seen.add(code)
        codes.append(code)

    return codes


def import_tushare() -> Any:
    try:
        import tushare as ts
    except ImportError as exc:
        raise RuntimeError(
            "当前 Python 环境未安装 tushare，请先安装: pip install tushare"
        ) from exc
    return ts


def build_pro_client(token: str) -> Any:
    ts = import_tushare()
    if hasattr(ts, "set_token"):
        ts.set_token(token)
    return ts.pro_api(token)


def get_previous_trade_date(pro: Any, as_of: date) -> str:
    end_date = yyyymmdd(as_of)
    start_date = yyyymmdd(as_of - timedelta(days=120))

    cal = pro.trade_cal(
        exchange="",
        start_date=start_date,
        end_date=end_date,
        fields="cal_date,is_open",
    )
    if cal is None or cal.empty:
        raise RuntimeError(f"无法从 Tushare 获取交易日历: {start_date} - {end_date}")

    cal = cal.copy()
    cal["cal_date"] = cal["cal_date"].astype(str)
    open_days = cal[(cal["is_open"].astype(str) == "1") & (cal["cal_date"] < end_date)]
    if open_days.empty:
        raise RuntimeError(f"{display_date(end_date)} 之前 120 天内未找到开市交易日")

    return str(open_days.sort_values("cal_date").iloc[-1]["cal_date"])


def normalize_price_frame(frame: Any, end_date: str) -> Any:
    import pandas as pd

    if frame is None or frame.empty:
        return pd.DataFrame(columns=["ts_code", "trade_date", "open", "high", "low", "close"])

    missing = [field for field in ["trade_date", "open", "high", "low", "close"] if field not in frame.columns]
    if missing:
        raise ValueError(f"Tushare 返回字段缺失: {', '.join(missing)}")

    data = frame.copy()
    data["trade_date"] = data["trade_date"].astype(str)
    data = data[data["trade_date"] <= end_date]

    for column in ["open", "high", "low", "close"]:
        data[column] = pd.to_numeric(data[column], errors="coerce")

    data = data.dropna(subset=["trade_date", "open", "high", "low", "close"])
    data = data.drop_duplicates(subset=["trade_date"], keep="first")
    return data.sort_values("trade_date", ascending=False).reset_index(drop=True)


def fetch_from_endpoint(pro: Any, endpoint: str, ts_code: str, start_date: str, end_date: str) -> Any:
    method = getattr(pro, endpoint)
    return method(
        ts_code=ts_code,
        start_date=start_date,
        end_date=end_date,
        fields=PRICE_FIELDS,
    )


def fetch_price_data(pro: Any, ts_code: str, end_date: str, initial_days: int) -> FetchResult:
    end_day = datetime.strptime(end_date, "%Y%m%d").date()
    max_days = 730
    days = min(max(initial_days, 45), max_days)
    errors: list[str] = []
    best_fetch: FetchResult | None = None

    while True:
        start_date = yyyymmdd(end_day - timedelta(days=days))
        last_empty_source = ""

        for endpoint, source_name in (("fund_daily", "fund_daily(ETF日线)"), ("daily", "daily(股票日线)")):
            try:
                raw = fetch_from_endpoint(pro, endpoint, ts_code, start_date, end_date)
                data = normalize_price_frame(raw, end_date)
            except Exception as exc:  # noqa: BLE001 - surface API errors in output
                errors.append(f"{source_name}: {exc}")
                continue

            if not data.empty:
                current_fetch = FetchResult(data=data, source=source_name, start_date=start_date, errors=errors)
                if best_fetch is None or len(data) > len(best_fetch.data):
                    best_fetch = current_fetch
                if len(data) >= NEEDED_BARS or days >= max_days:
                    return current_fetch
                last_empty_source = source_name
                break

            last_empty_source = source_name

        if last_empty_source:
            errors.append(f"{last_empty_source}: {start_date} - {end_date} 数据不足或为空")

        if days >= max_days:
            break
        days = min(days * 2, max_days)

    if best_fetch is not None:
        return best_fetch

    import pandas as pd

    return FetchResult(
        data=pd.DataFrame(columns=["ts_code", "trade_date", "open", "high", "low", "close"]),
        source="无可用数据",
        start_date=yyyymmdd(end_day - timedelta(days=max_days)),
        errors=errors,
    )


def fmt_price(value: Any) -> str:
    number = float(value)
    text = f"{number:.4f}".rstrip("0").rstrip(".")
    return text if text else "0"


def fmt_signed(value: float) -> str:
    sign = "+" if value > EPSILON else ""
    return f"{sign}{fmt_price(value)}"


def fmt_pct(value: float | None) -> str:
    if value is None:
        return "N/A"
    sign = "+" if value > EPSILON else ""
    return f"{sign}{value:.2f}%"


def relation(close_price: float, ref_price: float) -> tuple[str, float, float | None]:
    diff = close_price - ref_price
    pct = None if abs(ref_price) <= EPSILON else diff / ref_price * 100
    if diff > EPSILON:
        op = ">"
    elif diff < -EPSILON:
        op = "<"
    else:
        op = "="
    return op, diff, pct


def date_list(frame: Any, price_column: str, price_value: float) -> str:
    matched = frame[abs(frame[price_column] - price_value) <= EPSILON]["trade_date"].astype(str).tolist()
    return ", ".join(display_date(day) for day in matched)


def date_range(frame: Any) -> str:
    if frame is None or frame.empty:
        return "无可用日期"
    dates = frame["trade_date"].astype(str).tolist()
    return f"{display_date(min(dates))} 至 {display_date(max(dates))}"


def print_error_block(code: str, message: str, details: list[str] | None = None) -> CodeResult:
    print("=" * 72)
    print(f"代码: {code}")
    print(f"状态: 失败")
    print(f"原因: {message}")
    if details:
        print("调试信息:")
        for item in details[-5:]:
            print(f"  - {item}")
    return CodeResult(code=code, ok=False, summary=message)


def analyze_and_print(code: str, fetch: FetchResult, requested_t: str) -> CodeResult:
    data = fetch.data
    if data is None or data.empty:
        return print_error_block(code, "没有获取到可分析的日线数据", fetch.errors)

    if requested_t in set(data["trade_date"].astype(str)):
        anchor_date = requested_t
    else:
        anchor_date = str(data.iloc[0]["trade_date"])

    data = data[data["trade_date"].astype(str) <= anchor_date].sort_values("trade_date", ascending=False)
    window = data.head(NEEDED_BARS).copy()
    if window.empty:
        return print_error_block(code, f"{display_date(anchor_date)} 之前没有日线数据", fetch.errors)

    t_row = window.iloc[0]
    t_close = float(t_row["close"])

    previous_high = data[data["trade_date"].astype(str) < anchor_date].head(HIGH_LOOKBACK).copy()
    previous_low = data[data["trade_date"].astype(str) < anchor_date].head(LOW_LOOKBACK).copy()

    print("=" * 72)
    print(f"代码: {code}")
    print(f"数据源: {fetch.source}")
    if anchor_date != requested_t:
        print(f"注意: Tushare 未返回 {display_date(requested_t)} 的行情，已改用最近可用日期 {display_date(anchor_date)}。")
    print()
    print(f"昨日收盘价 {display_date(anchor_date)}")
    print(fmt_price(t_close))

    relation_summaries: list[str] = []

    print()
    print(f"10日线 日期时间: T-1 到 T-11（{date_range(previous_low)}）")
    if previous_low.empty:
        print("最低价：无可用数据 所属日期：无")
        print(f"差价：{fmt_price(t_close)}-N/A = N/A")
        relation_summaries.append("T-1到T-11低点数据不足")
    else:
        low_price = float(previous_low["low"].min())
        low_dates = date_list(previous_low, "low", low_price)
        low_op, low_diff, _ = relation(t_close, low_price)
        print(f"最低价：{fmt_price(low_price)} 所属日期：{low_dates}")
        print(f"差价：{fmt_price(t_close)}-{fmt_price(low_price)} = {fmt_signed(low_diff)}")
        if len(previous_low) < LOW_LOOKBACK:
            print(f"提示：T-1 到 T-11 统计区间可用记录只有 {len(previous_low)} 条，少于目标 {LOW_LOOKBACK} 条。")
        relation_summaries.append(f"收盘价{low_op}T-1到T-11低点")

    print()
    print(f"20日线 日期时间: T-1 到 T-21（{date_range(previous_high)}）")
    if previous_high.empty:
        print("最高价：无可用数据 所属日期：无")
        print(f"差价：{fmt_price(t_close)}-N/A = N/A")
        relation_summaries.append("T-1到T-21高点数据不足")
    else:
        high_price = float(previous_high["high"].max())
        high_dates = date_list(previous_high, "high", high_price)
        high_op, high_diff, _ = relation(t_close, high_price)
        print(f"最高价：{fmt_price(high_price)} 所属日期：{high_dates}")
        print(f"差价：{fmt_price(t_close)}-{fmt_price(high_price)} = {fmt_signed(high_diff)}")
        if len(previous_high) < HIGH_LOOKBACK:
            print(f"提示：T-1 到 T-21 统计区间可用记录只有 {len(previous_high)} 条，少于目标 {HIGH_LOOKBACK} 条。")
        relation_summaries.append(f"收盘价{high_op}T-1到T-21高点")

    return CodeResult(code=code, ok=True, summary="; ".join(relation_summaries))


def parse_args() -> argparse.Namespace:
    default_dir = script_dir()
    parser = argparse.ArgumentParser(
        description="读取 etf.txt 中的代码，通过 Tushare 输出 T 日与近期高低点关系。",
    )
    parser.add_argument(
        "--key-file",
        type=Path,
        default=default_dir / "key.txt",
        help="Tushare token 文件，默认 stock/key.txt。",
    )
    parser.add_argument(
        "--etf-file",
        type=Path,
        default=default_dir / "etf.txt",
        help="ETF 代码列表文件，默认 stock/etf.txt。",
    )
    parser.add_argument(
        "--as-of",
        type=parse_yyyymmdd,
        default=date.today(),
        help="按该日期之前的上一个交易日作为 T，格式 YYYYMMDD，默认今天。",
    )
    parser.add_argument(
        "--fetch-days",
        type=int,
        default=90,
        help="初始回看自然日天数，数据不足时会自动扩大，默认 90。",
    )
    return parser.parse_args()


def main() -> int:
    configure_output_encoding()
    args = parse_args()

    try:
        token = read_token(args.key_file)
        codes = read_codes(args.etf_file)
    except Exception as exc:  # noqa: BLE001 - user-facing script
        print(f"配置读取失败: {exc}", file=sys.stderr)
        return 1

    if not codes:
        print(f"没有可处理的 ETF 代码: {args.etf_file}")
        print("请在 etf.txt 中每行写一个代码，例如 510300.SH 或 159915.SZ；# 开头的行会被忽略。")
        return 1

    try:
        pro = build_pro_client(token)
        t_date = get_previous_trade_date(pro, args.as_of)
    except Exception as exc:  # noqa: BLE001 - user-facing script
        print(f"Tushare 初始化或交易日历读取失败: {exc}", file=sys.stderr)
        return 1

    print(f"ETF 数量: {len(codes)}")
    print(f"判定口径: 以 {display_date(yyyymmdd(args.as_of))} 之前的上一个开市交易日作为 T")
    print(f"T = {display_date(t_date)}")
    print("输出口径: 昨日收盘价；最低价统计 T-1 到 T-11；最高价统计 T-1 到 T-21")

    results: list[CodeResult] = []
    for code in codes:
        try:
            fetch = fetch_price_data(pro, code, t_date, args.fetch_days)
            results.append(analyze_and_print(code, fetch, t_date))
        except Exception as exc:  # noqa: BLE001 - continue processing other codes
            results.append(print_error_block(code, f"处理失败: {exc}"))

    print("=" * 72)
    print("汇总:")
    ok_count = sum(1 for item in results if item.ok)
    print(f"  成功: {ok_count}/{len(results)}")
    for item in results:
        status = "成功" if item.ok else "失败"
        print(f"  - {item.code}: {status}，{item.summary}")

    return 0 if ok_count else 1


if __name__ == "__main__":
    raise SystemExit(main())
