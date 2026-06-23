#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
为 stock.txt 中的每个代码（个股或 ETF）生成最新 21 个交易日的行情数据。

通过 Tushare 拉取日线，为每个代码在 data/ 目录下生成一个 ``<代码>.json``
文件，记录最新 21 个交易日的开盘价、最高价、最低价、收盘价；并生成
``data/index.json`` 清单供前端发现标的。本脚本自包含，不依赖其它模块。

代码可能是个股或 ETF，两者日线接口不同（个股 daily、ETF fund_daily）。脚本
会先用 fund_basic / stock_basic 判定类型，缺失时按代码段猜测，据此选择接口。

默认文件相对脚本目录解析：
- key.txt:   Tushare token，取第一条非空非注释行
- stock.txt: 每行一个代码（可选「代码 买入价格」），忽略空行与 # 开头的行
- data/:     输出目录
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any


PRICE_FIELDS = "ts_code,trade_date,open,high,low,close"
OUTPUT_BARS = 21          # 展示的交易日数量
MA_DELTA = 55             # 副图展示的均线日变化周期
DMI_DI_PERIOD = 14        # DMI(14, 6): DI/DX 计算周期
DMI_ADX_PERIOD = 6        # DMI(14, 6): ADX 移动平均周期
ATR_PERIOD = 14           # ATR 计算周期
# 为了给最旧的展示日也算出指标，需要额外的历史交易日完成平滑初始化。
NEEDED_BARS = max(
    OUTPUT_BARS + MA_DELTA,
    OUTPUT_BARS + DMI_DI_PERIOD + DMI_ADX_PERIOD,
    OUTPUT_BARS + ATR_PERIOD,
)


@dataclass
class FetchResult:
    data: Any
    source: str
    start_date: str
    errors: list[str]


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


def get_trade_date_candidate(pro: Any, as_of: date) -> str:
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
    open_days = cal[(cal["is_open"].astype(str) == "1") & (cal["cal_date"] <= end_date)]
    if open_days.empty:
        raise RuntimeError(f"{display_date(end_date)} 及之前 120 天内未找到开市交易日")

    return str(open_days.sort_values("cal_date").iloc[-1]["cal_date"])


def normalize_price_frame(frame: Any, end_date: str) -> Any:
    import pandas as pd

    columns = ["ts_code", "trade_date", "open", "high", "low", "close"]
    if frame is None or frame.empty:
        return pd.DataFrame(columns=columns)

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


def fetch_price_data(
    pro: Any,
    ts_code: str,
    end_date: str,
    initial_days: int,
    endpoints: list[tuple[str, str]] | None = None,
) -> FetchResult:
    if endpoints is None:
        endpoints = [("fund_daily", "fund_daily(ETF日线)"), ("daily", "daily(股票日线)")]
    end_day = datetime.strptime(end_date, "%Y%m%d").date()
    max_days = 730
    days = min(max(initial_days, 45), max_days)
    errors: list[str] = []
    best_fetch: FetchResult | None = None

    while True:
        start_date = yyyymmdd(end_day - timedelta(days=days))
        last_empty_source = ""

        for endpoint, source_name in endpoints:
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


def build_basic_maps(pro: Any) -> tuple[dict[str, str], dict[str, str]]:
    """构建 ts_code -> 名称 与 ts_code -> 类型(etf/stock) 映射。

    在 fund_basic（场内基金）中出现的判为 etf，在 stock_basic 中出现的判为 stock。
    """
    name_map: dict[str, str] = {}
    type_map: dict[str, str] = {}

    try:
        funds = pro.fund_basic(market="E", fields="ts_code,name")
        if funds is not None and not funds.empty:
            for _, row in funds.iterrows():
                code = str(row["ts_code"]).strip().upper()
                if code:
                    name_map[code] = str(row["name"]).strip()
                    type_map[code] = "etf"
    except Exception as exc:  # noqa: BLE001 - 名称缺失不应中断主流程
        print(f"提示: 读取 fund_basic 失败，部分基金名称/类型可能缺失: {exc}", file=sys.stderr)

    try:
        stocks = pro.stock_basic(exchange="", list_status="L", fields="ts_code,name")
        if stocks is not None and not stocks.empty:
            for _, row in stocks.iterrows():
                code = str(row["ts_code"]).strip().upper()
                if not code:
                    continue
                name_map.setdefault(code, str(row["name"]).strip())
                type_map.setdefault(code, "stock")
    except Exception as exc:  # noqa: BLE001 - 名称缺失不应中断主流程
        print(f"提示: 读取 stock_basic 失败，部分股票名称/类型可能缺失: {exc}", file=sys.stderr)

    return name_map, type_map


def guess_type_by_code(ts_code: str) -> str | None:
    """按 A 股代码段猜测类型；无法判断时返回 None。"""
    symbol = ts_code.split(".", 1)[0]
    if len(symbol) != 6 or not symbol.isdigit():
        return None
    # 上交所 5 开头、深交所 15/16/18 开头为场内基金/ETF
    if symbol.startswith("5") or symbol[:2] in ("15", "16", "18"):
        return "etf"
    # 上交所 6 开头、深交所 0/3 开头、北交所 4/8 开头为个股
    if symbol[0] in ("6", "0", "3", "4", "8"):
        return "stock"
    return None


def endpoints_for_type(code_type: str | None) -> list[tuple[str, str]]:
    """按类型返回 Tushare 日线接口的尝试顺序（首个为首选，其余兜底）。"""
    fund_ep = ("fund_daily", "fund_daily(ETF日线)")
    stock_ep = ("daily", "daily(股票日线)")
    if code_type == "etf":
        return [fund_ep, stock_ep]
    if code_type == "stock":
        return [stock_ep, fund_ep]
    return [fund_ep, stock_ep]


def read_code_entries(stock_file: Path) -> list[tuple[str, float | None]]:
    """解析 stock.txt，每行支持「代码」或「代码 买入价格」（空格分隔）。"""
    if not stock_file.exists():
        raise FileNotFoundError(f"找不到代码列表文件: {stock_file}")

    entries: list[tuple[str, float | None]] = []
    seen: set[str] = set()
    for line_no, line in enumerate(stock_file.read_text(encoding="utf-8-sig").splitlines(), start=1):
        text = line.strip()
        if not text or text.startswith("#"):
            continue

        text = text.split("#", 1)[0].strip()
        if not text:
            continue

        parts = text.split()
        code = normalize_ts_code(parts[0])
        if not code:
            continue

        buy_price: float | None = None
        if len(parts) >= 2:
            try:
                buy_price = float(parts[1])
            except ValueError:
                print(f"提示: {stock_file.name} 第 {line_no} 行买入价格无法解析: {parts[1]}，已忽略。")

        if code in seen:
            print(f"提示: {stock_file.name} 第 {line_no} 行重复代码 {code}，已忽略。")
            continue
        seen.add(code)
        entries.append((code, buy_price))

    return entries


def to_number(value: Any) -> float:
    number = float(value)
    return int(number) if number.is_integer() else round(number, 4)


def num_or_none(value: Any, digits: int = 6) -> float | None:
    """转成数值；NaN/无法解析返回 None（保证可被 JSON 序列化）。"""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number):
        return None
    return int(number) if number.is_integer() else round(number, digits)


def calculate_dmi_adx(
    frame: Any,
    di_period: int = DMI_DI_PERIOD,
    adx_period: int = DMI_ADX_PERIOD,
) -> list[float | None]:
    """按常见 DMI(14, 6) 公式计算 ADX，返回与升序行情 frame 对齐的列表。"""
    if frame is None or frame.empty:
        return []

    highs = [float(v) for v in frame["high"].tolist()]
    lows = [float(v) for v in frame["low"].tolist()]
    closes = [float(v) for v in frame["close"].tolist()]
    total = len(highs)
    adx: list[float | None] = [None] * total
    if total < di_period + adx_period - 1:
        return adx

    tr = [0.0] * total
    plus_dm = [0.0] * total
    minus_dm = [0.0] * total
    tr[0] = highs[0] - lows[0]
    for i in range(1, total):
        high = highs[i]
        low = lows[i]
        prev_high = highs[i - 1]
        prev_low = lows[i - 1]
        prev_close = closes[i - 1]

        tr[i] = max(high - low, abs(high - prev_close), abs(low - prev_close))
        up_move = high - prev_high
        down_move = prev_low - low
        plus_dm[i] = up_move if up_move > down_move and up_move > 0 else 0.0
        minus_dm[i] = down_move if down_move > up_move and down_move > 0 else 0.0

    dx: list[float | None] = [None] * total
    for i in range(di_period - 1, total):
        start = i - di_period + 1
        tr_sum = sum(tr[start : i + 1])
        plus_sum = sum(plus_dm[start : i + 1])
        minus_sum = sum(minus_dm[start : i + 1])
        if tr_sum == 0:
            dx[i] = 0.0
            continue
        plus_di = 100 * plus_sum / tr_sum
        minus_di = 100 * minus_sum / tr_sum
        denominator = plus_di + minus_di
        dx[i] = 0.0 if denominator == 0 else 100 * abs(plus_di - minus_di) / denominator

    for i in range(di_period + adx_period - 2, total):
        window = dx[i - adx_period + 1 : i + 1]
        if any(value is None for value in window):
            continue
        adx[i] = sum(value for value in window if value is not None) / adx_period

    return adx


def calculate_atr(frame: Any, period: int = ATR_PERIOD) -> list[float | None]:
    """计算 ATR，使用 TR 的 period 日简单移动平均。"""
    if frame is None or frame.empty:
        return []

    highs = [float(v) for v in frame["high"].tolist()]
    lows = [float(v) for v in frame["low"].tolist()]
    closes = [float(v) for v in frame["close"].tolist()]
    total = len(highs)
    atr: list[float | None] = [None] * total
    if total < period:
        return atr

    tr = [0.0] * total
    tr[0] = highs[0] - lows[0]
    for i in range(1, total):
        tr[i] = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )

    for i in range(period - 1, total):
        atr[i] = sum(tr[i - period + 1 : i + 1]) / period

    return atr


def build_records(fetch: Any, anchor_date: str) -> list[dict[str, Any]]:
    data = fetch.data
    if data is None or data.empty:
        return []

    # 用全量历史（升序）计算均线，再截取最新 OUTPUT_BARS 条展示。
    full = data[data["trade_date"].astype(str) <= anchor_date].copy()
    if full.empty:
        return []
    full = full.sort_values("trade_date", ascending=True)

    # 收盘价的 55 日均线及其日变化。
    full["ma_delta"] = full["close"].rolling(MA_DELTA).mean()
    full["ma_delta_change"] = full["ma_delta"].diff()
    full["adx14_6"] = calculate_dmi_adx(full, DMI_DI_PERIOD, DMI_ADX_PERIOD)
    full["atr14"] = calculate_atr(full, ATR_PERIOD)

    window = full.tail(OUTPUT_BARS)

    records: list[dict[str, Any]] = []
    for _, row in window.iterrows():
        records.append(
            {
                "date": display_date(str(row["trade_date"])),
                "open": to_number(row["open"]),
                "high": to_number(row["high"]),
                "low": to_number(row["low"]),
                "close": to_number(row["close"]),
                "ma55": num_or_none(row["ma_delta"]),
                "ma55_delta": num_or_none(row["ma_delta_change"]),
                "adx14_6": num_or_none(row["adx14_6"]),
                "atr14": num_or_none(row["atr14"]),
            }
        )
    return records


def resolve_anchor_date(fetch: Any, requested_t: str) -> str:
    data = fetch.data
    if data is None or data.empty:
        return requested_t
    if requested_t in set(data["trade_date"].astype(str)):
        return requested_t
    return str(data.iloc[0]["trade_date"])


def write_json(out_dir: Path, code: str, payload: dict[str, Any]) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{code}.json"
    out_file.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return out_file


def parse_args() -> argparse.Namespace:
    default_dir = script_dir()
    parser = argparse.ArgumentParser(
        description="读取 stock.txt，为每个代码（个股或 ETF）生成最新 21 个交易日的行情 JSON。",
    )
    parser.add_argument(
        "--key-file",
        type=Path,
        default=default_dir / "key.txt",
        help="Tushare token 文件，默认 stock/key.txt。",
    )
    parser.add_argument(
        "--stock-file",
        type=Path,
        default=default_dir / "stock.txt",
        help="代码列表文件（个股/ETF 混合），默认 stock/stock.txt。",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=default_dir / "data",
        help="JSON 输出目录，默认 stock/data。",
    )
    parser.add_argument(
        "--as-of",
        type=parse_yyyymmdd,
        default=date.today(),
        help="按该日期及之前的最近开市日作为最新交易日，格式 YYYYMMDD，默认今天。",
    )
    parser.add_argument(
        "--fetch-days",
        type=int,
        default=160,
        help="初始回看自然日天数，数据不足时会自动扩大，默认 160（约可覆盖 80 个交易日）。",
    )
    return parser.parse_args()


def main() -> int:
    configure_output_encoding()
    args = parse_args()

    try:
        token = read_token(args.key_file)
        entries = read_code_entries(args.stock_file)
    except Exception as exc:  # noqa: BLE001 - 面向用户脚本
        print(f"配置读取失败: {exc}", file=sys.stderr)
        return 1

    if not entries:
        print(f"没有可处理的代码: {args.stock_file}")
        return 1

    try:
        pro = build_pro_client(token)
        t_date = get_trade_date_candidate(pro, args.as_of)
    except Exception as exc:  # noqa: BLE001 - 面向用户脚本
        print(f"Tushare 初始化或交易日历读取失败: {exc}", file=sys.stderr)
        return 1

    name_map, type_map = build_basic_maps(pro)

    print(f"代码数量: {len(entries)}")
    print(f"最新交易日候选: {display_date(t_date)}")
    print(
        f"每个代码输出最新 {OUTPUT_BARS} 个交易日的 OHLC，"
        f"并附 {MA_DELTA} 日均线日变化、DMI({DMI_DI_PERIOD}, {DMI_ADX_PERIOD}) 的 ADX 与 ATR({ATR_PERIOD})。"
    )
    print(f"输出目录: {args.out_dir}")

    ok_count = 0
    manifest: list[dict[str, Any]] = []
    for code, buy_price in entries:
        # 先用基础表判定类型，缺失时按代码段猜测，仍未知则两个接口都试。
        code_type = type_map.get(code) or guess_type_by_code(code)
        try:
            fetch = fetch_price_data(
                pro, code, t_date, args.fetch_days, endpoints_for_type(code_type)
            )
            anchor_date = resolve_anchor_date(fetch, t_date)
            records = build_records(fetch, anchor_date)
        except Exception as exc:  # noqa: BLE001 - 继续处理其它代码
            print(f"  - {code}: 失败，{exc}")
            continue

        if not records:
            details = "; ".join(fetch.errors[-3:]) if getattr(fetch, "errors", None) else "无数据"
            print(f"  - {code}: 失败，未获取到行情数据（{details}）")
            continue

        # 实际命中的数据源更可靠：据此校正类型。
        resolved_type = "etf" if fetch.source.startswith("fund_daily") else (
            "stock" if fetch.source.startswith("daily") else (code_type or "unknown")
        )

        payload = {
            "code": code,
            "name": name_map.get(code, ""),
            "type": resolved_type,
            "buy_price": buy_price,
            "source": fetch.source,
            "latest_trade_date": display_date(anchor_date),
            "count": len(records),
            "data": records,
        }
        out_file = write_json(args.out_dir, code, payload)
        manifest.append(
            {
                "code": code,
                "name": payload["name"],
                "type": resolved_type,
                "buy_price": buy_price,
                "file": out_file.name,
            }
        )
        ok_count += 1
        note = "" if len(records) >= OUTPUT_BARS else f"（仅 {len(records)} 条，少于 {OUTPUT_BARS}）"
        print(f"  - {code}: 成功 [{resolved_type}]，{out_file.name} 写入 {len(records)} 条{note}")

    if manifest:
        generated_at = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M")
        index_payload = {
            "generated_at": generated_at,
            "timezone": "Asia/Shanghai (UTC+8)",
            "count": len(manifest),
            "items": manifest,
        }
        index_file = write_json(args.out_dir, "index", index_payload)
        print(f"  索引: {index_file.name} 写入 {len(manifest)} 条，更新时间 {generated_at}")

    print("=" * 72)
    print(f"完成: {ok_count}/{len(entries)} 个代码已生成 JSON。")
    return 0 if ok_count else 1


if __name__ == "__main__":
    raise SystemExit(main())
