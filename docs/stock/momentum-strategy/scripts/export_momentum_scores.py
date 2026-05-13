#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import os
from pathlib import Path
from typing import Any


DEFAULT_WINDOW = 20
DEFAULT_TREND_WEIGHT = 40.0
DEFAULT_MOMENTUM_WEIGHT = 35.0
DEFAULT_VOLUME_WEIGHT = 25.0


def parse_date(value: str) -> dt.date:
    text = value.strip()
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            return dt.datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"日期格式不正确：{value!r}；请使用 YYYY-MM-DD 或 YYYYMMDD。")


def today_shanghai() -> dt.date:
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date()


def date_text(value: dt.date) -> str:
    return value.strftime("%Y-%m-%d")


def tushare_date(value: dt.date) -> str:
    return value.strftime("%Y%m%d")


def normalize_ts_code(code: str) -> str:
    normalized = code.strip().upper()
    if "." in normalized:
        return normalized
    if normalized.startswith(("5", "6")):
        return f"{normalized}.SH"
    if normalized.startswith(("4", "8")):
        return f"{normalized}.BJ"
    return f"{normalized}.SZ"


def parse_float(value: Any, field_name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} 数值不正确：{value!r}") from exc
    if not math.isfinite(number):
        raise ValueError(f"{field_name} 数值不正确：{value!r}")
    return number


def clean_float(value: float | None, digits: int = 10) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(float(value), digits)


def get_pro_client(token_arg: str | None = None):
    try:
        import tushare as ts
    except ImportError as exc:
        raise RuntimeError("请先安装 tushare，例如：pip install tushare") from exc

    token = (token_arg or "").strip()
    token_source = "argument" if token else ""
    if not token:
        token = os.getenv("TUSHARE_TOKEN", "").strip()
        token_source = "environment" if token else ""
    if not token:
        try:
            token = (ts.get_token() or "").strip()
            token_source = "saved" if token else ""
        except Exception:
            token = ""
    if not token:
        raise RuntimeError("未提供 Tushare token。请传入 --token，或设置 TUSHARE_TOKEN，或先保存 Tushare token。")
    return ts.pro_api(token), token_source


def normalize_bars(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_date: dict[dt.date, dict[str, Any]] = {}
    for row in rows:
        trade_date = row["date"]
        by_date[trade_date] = {
            "date": trade_date,
            "close": parse_float(row["close"], "close"),
            "volume": parse_float(row["volume"], "volume"),
        }
    return [by_date[key] for key in sorted(by_date)]


def fetch_tushare_bars(
    ts_code: str,
    start_date: dt.date,
    end_date: dt.date,
    asset_type: str,
    token: str | None,
) -> tuple[str, str, list[dict[str, Any]]]:
    pro, token_source = get_pro_client(token)
    start = tushare_date(start_date)
    end = tushare_date(end_date)

    if asset_type == "fund":
        api_order = ["fund_daily"]
    elif asset_type == "stock":
        api_order = ["daily"]
    elif ts_code.startswith(("1", "5")):
        api_order = ["fund_daily", "daily"]
    else:
        api_order = ["daily", "fund_daily"]

    errors: list[str] = []
    for api_name in api_order:
        try:
            df = getattr(pro, api_name)(ts_code=ts_code, start_date=start, end_date=end)
        except Exception as exc:
            errors.append(f"{api_name}: {exc}")
            continue
        if df is None or getattr(df, "empty", True):
            errors.append(f"{api_name}: 空结果")
            continue

        required = {"trade_date", "close", "vol"}
        missing = required.difference(set(df.columns))
        if missing:
            errors.append(f"{api_name}: 缺少字段 {sorted(missing)}")
            continue

        rows = [
            {
                "date": parse_date(str(item["trade_date"])),
                "close": item["close"],
                "volume": item["vol"],
            }
            for item in df.to_dict("records")
        ]
        return api_name, token_source, normalize_bars(rows)

    detail = "; ".join(errors) if errors else "没有执行任何接口请求"
    raise RuntimeError(f"{ts_code} 没有返回日线数据：{detail}")


def load_csv_bars(path: Path) -> list[dict[str, Any]]:
    with path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        fieldnames = reader.fieldnames or []
        lower_to_real = {name.lower(): name for name in fieldnames}
        date_key = lower_to_real.get("date") or lower_to_real.get("trade_date")
        close_key = lower_to_real.get("close")
        volume_key = lower_to_real.get("volume") or lower_to_real.get("vol")
        if not date_key or not close_key or not volume_key:
            raise RuntimeError("CSV 必须包含 date/trade_date、close、volume/vol 这些列。")

        rows = []
        for item in reader:
            rows.append(
                {
                    "date": parse_date(str(item[date_key])),
                    "close": item[close_key],
                    "volume": item[volume_key],
                }
            )
    if not rows:
        raise RuntimeError(f"CSV 中没有数据行：{path}")
    return normalize_bars(rows)


def calculate_b_and_r2(closes: list[float]) -> tuple[float, float]:
    if any(value <= 0 for value in closes):
        raise RuntimeError("收盘价必须大于 0，才能计算 log(close)。")

    y = [math.log(float(value)) for value in closes]
    n = len(y)
    x_mean = (n - 1) / 2.0
    y_mean = sum(y) / n
    var_x = sum((idx - x_mean) ** 2 for idx in range(n))
    var_y = sum((value - y_mean) ** 2 for value in y)
    cov_xy = sum((idx - x_mean) * (value - y_mean) for idx, value in enumerate(y))

    slope = cov_xy / var_x if var_x else 0.0
    if n > 1 and var_x > 0 and var_y > 0:
        corr = cov_xy / math.sqrt(var_x * var_y)
    else:
        corr = 0.0
    return slope, corr**2


def mean(values: list[float]) -> float:
    return sum(values) / len(values)


def build_metrics(
    bars: list[dict[str, Any]],
    start_date: dt.date,
    end_date: dt.date,
    window: int,
    trend_weight: float,
    momentum_weight: float,
    volume_weight: float,
) -> list[dict[str, Any]]:
    min_rows = max(window, 20, 11)
    if len(bars) < min_rows:
        raise RuntimeError(f"交易日数量不足，无法计算指标。至少需要 {min_rows} 行，当前只有 {len(bars)} 行。")

    records: list[dict[str, Any]] = []
    closes = [float(item["close"]) for item in bars]
    volumes = [float(item["volume"]) for item in bars]

    for idx in range(window - 1, len(bars)):
        end_day = bars[idx]["date"]
        close_window = closes[idx - window + 1 : idx + 1]
        volume_window = volumes[idx - window + 1 : idx + 1]
        b, r_squared = calculate_b_and_r2(close_window)

        if len(close_window) < 11:
            momentum_score = None
        else:
            roc_5 = (close_window[-1] / close_window[-6] - 1.0) * 100.0
            roc_10 = (close_window[-1] / close_window[-11] - 1.0) * 100.0
            momentum_score = 0.6 * roc_5 + 0.4 * roc_10

        if len(volume_window) < 20:
            volume_score = None
        else:
            vol_ma_short = mean(volume_window[-5:])
            vol_ma_long = mean(volume_window[-20:])
            volume_score = math.log(vol_ma_short / vol_ma_long) if vol_ma_short > 0 and vol_ma_long > 0 else 0.0

        trend_score = (b * 250.0) * r_squared
        if momentum_score is None or volume_score is None:
            total_score_raw = None
            total_score = 0.0
        else:
            total_score_raw = (
                trend_weight * trend_score
                + momentum_weight * momentum_score
                + volume_weight * volume_score
            )
            total_score = max(0.0, float(total_score_raw))

        if start_date <= end_day <= end_date:
            records.append(
                {
                    "date": date_text(end_day),
                    "close": clean_float(close_window[-1], 4),
                    "volume": clean_float(volume_window[-1], 4),
                    "b": clean_float(b),
                    "r_squared": clean_float(r_squared),
                    "b_times_r_squared": clean_float(b * r_squared),
                    "trend_score": clean_float(trend_score),
                    "momentum_score": clean_float(momentum_score),
                    "volume_score": clean_float(volume_score),
                    "total_score_raw": clean_float(total_score_raw),
                    "total_score": clean_float(total_score),
                }
            )

    if not records:
        raise RuntimeError("请求的日期范围内没有可输出的打分交易日。")
    return records


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="按交易日导出动量策略分数 JSON。")
    parser.add_argument("--ts-code", required=True, help="股票、ETF 或基金代码，例如 600519.SH 或 159681.SZ。")
    parser.add_argument("--start-date", required=True, help="请求开始日期，格式 YYYY-MM-DD 或 YYYYMMDD。")
    parser.add_argument("--end-date", help="请求结束日期，格式 YYYY-MM-DD 或 YYYYMMDD。默认使用北京时间当天。")
    parser.add_argument("--token", help="Tushare token。优先级高于 TUSHARE_TOKEN 环境变量和本地保存 token。")
    parser.add_argument("--window", type=int, default=DEFAULT_WINDOW, help="滚动交易日窗口。")
    parser.add_argument("--trend-weight", type=float, default=DEFAULT_TREND_WEIGHT)
    parser.add_argument("--momentum-weight", type=float, default=DEFAULT_MOMENTUM_WEIGHT)
    parser.add_argument("--volume-weight", type=float, default=DEFAULT_VOLUME_WEIGHT)
    parser.add_argument("--asset-type", choices=["auto", "stock", "fund"], default="auto")
    parser.add_argument("--warmup-days", type=int, help="开始日期前额外拉取的自然日数量。默认 max(window*4, 90)。")
    parser.add_argument("--input-csv", help="可选的本地 CSV，需包含 date/trade_date、close、volume/vol。")
    parser.add_argument("--output", help="输出 JSON 路径。")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.window <= 0:
        raise RuntimeError("--window 必须大于 0。")

    ts_code = normalize_ts_code(args.ts_code)
    requested_start = parse_date(args.start_date)
    requested_end = parse_date(args.end_date) if args.end_date else today_shanghai()
    if requested_start > requested_end:
        raise RuntimeError("start-date 必须早于或等于 end-date。")

    end_was_clipped = False
    effective_end = requested_end
    if not args.input_csv:
        today = today_shanghai()
        if effective_end > today:
            effective_end = today
            end_was_clipped = True

    warmup_days = args.warmup_days if args.warmup_days is not None else max(args.window * 4, 90)
    if warmup_days < 0:
        raise RuntimeError("--warmup-days 不能为负数。")
    fetch_start = requested_start - dt.timedelta(days=warmup_days)

    if args.input_csv:
        source = f"csv:{Path(args.input_csv).resolve()}"
        api_name = "csv"
        token_source = "not_used"
        bars = load_csv_bars(Path(args.input_csv))
    else:
        api_name, token_source, bars = fetch_tushare_bars(ts_code, fetch_start, effective_end, args.asset_type, args.token)
        source = f"tushare.{api_name}"

    bars = [item for item in bars if fetch_start <= item["date"] <= effective_end]
    records = build_metrics(
        bars=bars,
        start_date=requested_start,
        end_date=effective_end,
        window=args.window,
        trend_weight=args.trend_weight,
        momentum_weight=args.momentum_weight,
        volume_weight=args.volume_weight,
    )

    if args.output:
        output_path = Path(args.output)
    else:
        safe_code = ts_code.replace(".", "_").lower()
        output_path = Path.cwd() / f"{safe_code}_momentum_scores_{tushare_date(requested_start)}_{tushare_date(effective_end)}.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "metadata": {
            "ts_code": ts_code,
            "asset_type": args.asset_type,
            "source": source,
            "source_api": api_name,
            "token_source": token_source,
            "requested_start_date": date_text(requested_start),
            "requested_end_date": date_text(requested_end),
            "effective_end_date": date_text(effective_end),
            "end_date_clipped_to_today": end_was_clipped,
            "fetch_start_date": date_text(fetch_start),
            "window": args.window,
            "weights": {
                "trend": args.trend_weight,
                "momentum": args.momentum_weight,
                "volume": args.volume_weight,
            },
            "rows": len(records),
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        },
        "records": records,
    }

    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(f"ts_code: {ts_code}")
    print(f"数据来源: {source}")
    print(f"token来源: {token_source}")
    print(f"行数: {len(records)}")
    print(f"输出: {output_path.resolve()}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ERROR] 导出动量策略分数失败：{exc}")
        raise SystemExit(1)
