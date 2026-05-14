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
DEFAULT_MOMENTUM_SHORT_WINDOW = 5
DEFAULT_MOMENTUM_LONG_WINDOW = 10
DEFAULT_NORMALIZATION_WINDOW = 252
DEFAULT_NORMALIZATION_MIN_ROWS = 60
DEFAULT_TREND_WEIGHT = 40.0
DEFAULT_MOMENTUM_WEIGHT = 35.0
DEFAULT_VOLUME_WEIGHT = 25.0
DEFAULT_MA_WINDOWS = (5, 10, 20, 60)


def parse_date(value: str) -> dt.date:
    text = value.strip()
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            return dt.datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"Invalid date {value!r}; use YYYY-MM-DD or YYYYMMDD.")


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
        raise ValueError(f"Invalid numeric value for {field_name}: {value!r}") from exc
    if not math.isfinite(number):
        raise ValueError(f"Invalid numeric value for {field_name}: {value!r}")
    return number


def parse_optional_float(value: Any, field_name: str) -> float | None:
    if value in (None, ""):
        return None
    return parse_float(value, field_name)


def clean_float(value: float | None, digits: int = 10) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(float(value), digits)


def get_pro_client(token_arg: str | None = None):
    try:
        import tushare as ts
    except ImportError as exc:
        raise RuntimeError("Install tushare first, for example: pip install tushare") from exc

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
        raise RuntimeError("No Tushare token found. Pass --token, set TUSHARE_TOKEN, or save a Tushare token.")
    return ts.pro_api(token), token_source


def normalize_bars(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_date: dict[dt.date, dict[str, Any]] = {}
    for row in rows:
        trade_date = row["date"]
        by_date[trade_date] = {
            "date": trade_date,
            "open": parse_optional_float(row.get("open"), "open"),
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
            errors.append(f"{api_name}: empty result")
            continue

        required = {"trade_date", "open", "close", "vol"}
        missing = required.difference(set(df.columns))
        if missing:
            errors.append(f"{api_name}: missing columns {sorted(missing)}")
            continue

        rows = [
            {
                "date": parse_date(str(item["trade_date"])),
                "open": item["open"],
                "close": item["close"],
                "volume": item["vol"],
            }
            for item in df.to_dict("records")
        ]
        return api_name, token_source, normalize_bars(rows)

    detail = "; ".join(errors) if errors else "no API call was made"
    raise RuntimeError(f"{ts_code} returned no daily bars: {detail}")


def load_csv_bars(path: Path) -> list[dict[str, Any]]:
    with path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        fieldnames = reader.fieldnames or []
        lower_to_real = {name.lower(): name for name in fieldnames}
        date_key = lower_to_real.get("date") or lower_to_real.get("trade_date")
        open_key = lower_to_real.get("open")
        close_key = lower_to_real.get("close")
        volume_key = lower_to_real.get("volume") or lower_to_real.get("vol")
        if not date_key or not close_key or not volume_key:
            raise RuntimeError("CSV must include date/trade_date, close, and volume/vol columns.")

        rows = [
            {
                "date": parse_date(str(item[date_key])),
                "open": item[open_key] if open_key else None,
                "close": item[close_key],
                "volume": item[volume_key],
            }
            for item in reader
        ]
    if not rows:
        raise RuntimeError(f"CSV has no data rows: {path}")
    return normalize_bars(rows)


def calculate_b_and_r2(closes: list[float]) -> tuple[float, float]:
    if any(value <= 0 for value in closes):
        raise RuntimeError("Close prices must be greater than 0 to calculate log(close).")

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


def moving_average_optional(values: list[float | None], idx: int, window: int) -> float | None:
    if idx + 1 < window:
        return None

    window_values = values[idx - window + 1 : idx + 1]
    if any(value is None or not math.isfinite(value) for value in window_values):
        return None
    return mean([float(value) for value in window_values])


def moving_average_values(closes: list[float], idx: int, windows: tuple[int, ...] = DEFAULT_MA_WINDOWS) -> list[float]:
    values: list[float] = []
    for window in windows:
        if idx + 1 < window:
            values.append(-1.0)
            continue
        values.append(mean(closes[idx - window + 1 : idx + 1]))
    return values


def build_metrics(
    bars: list[dict[str, Any]],
    start_date: dt.date,
    end_date: dt.date,
    window: int,
    momentum_short_window: int,
    momentum_long_window: int,
    normalization_window: int,
    normalization_min_rows: int,
    trend_weight: float,
    momentum_weight: float,
    volume_weight: float,
) -> list[dict[str, Any]]:
    min_rows = max(window, 20, momentum_short_window + 1, momentum_long_window + 1)
    if len(bars) < min_rows:
        raise RuntimeError(f"Not enough trading days. Need at least {min_rows}, got {len(bars)}.")

    raw_rows: list[dict[str, Any]] = []
    closes = [float(item["close"]) for item in bars]
    volumes = [float(item["volume"]) for item in bars]

    for idx in range(window - 1, len(bars)):
        end_day = bars[idx]["date"]
        close_window = closes[idx - window + 1 : idx + 1]
        volume_window = volumes[idx - window + 1 : idx + 1]
        b, r_squared = calculate_b_and_r2(close_window)

        trend_raw_score = (b * 250.0) * r_squared
        if idx < momentum_short_window or idx < momentum_long_window:
            momentum_raw_score = None
        else:
            roc_short = (closes[idx] / closes[idx - momentum_short_window] - 1.0) * 100.0
            roc_long = (closes[idx] / closes[idx - momentum_long_window] - 1.0) * 100.0
            momentum_raw_score = 0.6 * roc_short + 0.4 * roc_long

        if len(volume_window) < 20:
            volume_raw_score = None
        else:
            vol_ma_short = mean(volume_window[-5:])
            vol_ma_long = mean(volume_window[-20:])
            volume_raw_score = math.log(vol_ma_short / vol_ma_long) if vol_ma_short > 0 and vol_ma_long > 0 else 0.0

        if momentum_raw_score is None or volume_raw_score is None:
            legacy_total_score_raw = None
        else:
            legacy_total_score_raw = (
                trend_weight * trend_raw_score
                + momentum_weight * momentum_raw_score
                + volume_weight * volume_raw_score
            )

        raw_rows.append(
            {
                "idx": idx,
                "date": end_day,
                "open": bars[idx].get("open"),
                "close": close_window[-1],
                "volume": volume_window[-1],
                "ma": moving_average_values(closes, idx),
                "b": b,
                "r_squared": r_squared,
                "trend_raw_score": trend_raw_score,
                "momentum_raw_score": momentum_raw_score,
                "volume_raw_score": volume_raw_score,
                "legacy_total_score_raw": legacy_total_score_raw,
            }
        )

    weight_sum = trend_weight + momentum_weight + volume_weight

    scored_rows: list[dict[str, Any]] = []
    for row in raw_rows:
        trend_score = row["trend_raw_score"]
        momentum_score = row["momentum_raw_score"]
        volume_score = row["volume_raw_score"]

        if trend_score is None or momentum_score is None or volume_score is None:
            total_score_raw = None
            total_score = 0.0
        else:
            total_score_raw = (
                trend_weight * trend_score
                + momentum_weight * momentum_score
                + volume_weight * volume_score
            )
            total_score = float(total_score_raw)

        scored_rows.append(
            {
                **row,
                "trend_score": trend_score,
                "momentum_score": momentum_score,
                "volume_score": volume_score,
                "total_score_raw": total_score_raw,
                "total_score": total_score,
            }
        )

    total_scores = [row["total_score_raw"] for row in scored_rows]
    for idx, row in enumerate(scored_rows):
        row["score_ma20"] = moving_average_optional(total_scores, idx, 20)
        row["score_ma60"] = moving_average_optional(total_scores, idx, 60)

    records: list[dict[str, Any]] = []
    for row in scored_rows:
        end_day = row["date"]
        if start_date <= end_day <= end_date:
            records.append(
                {
                    "date": date_text(end_day),
                    "open": clean_float(row["open"], 4),
                    "close": clean_float(row["close"], 4),
                    "volume": clean_float(row["volume"], 4),
                    "ma": [clean_float(value, 4) if value >= 0 else -1 for value in row["ma"]],
                    "b": clean_float(row["b"]),
                    "r_squared": clean_float(row["r_squared"]),
                    "b_times_r_squared": clean_float(row["b"] * row["r_squared"]),
                    "trend_raw_score": clean_float(row["trend_raw_score"]),
                    "momentum_raw_score": clean_float(row["momentum_raw_score"]),
                    "volume_raw_score": clean_float(row["volume_raw_score"]),
                    "legacy_total_score_raw": clean_float(row["legacy_total_score_raw"]),
                    "trend_score": clean_float(row["trend_score"]),
                    "momentum_score": clean_float(row["momentum_score"]),
                    "volume_score": clean_float(row["volume_score"]),
                    "total_score_raw": clean_float(row["total_score_raw"]),
                    "total_score": clean_float(row["total_score"]),
                    "score_ma20": clean_float(row["score_ma20"], 4),
                    "score_ma60": clean_float(row["score_ma60"], 4),
                }
            )

    if not records:
        raise RuntimeError("No scoring trading days found in the requested date range.")
    return records


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export daily momentum strategy scores as JSON.")
    parser.add_argument("--ts-code", required=True, help="Stock, ETF, or fund code, for example 600519.SH or 159681.SZ.")
    parser.add_argument("--start-date", required=True, help="Requested start date: YYYY-MM-DD or YYYYMMDD.")
    parser.add_argument("--end-date", help="Requested end date: YYYY-MM-DD or YYYYMMDD. Defaults to today's Shanghai date.")
    parser.add_argument("--token", help="Tushare token. Overrides TUSHARE_TOKEN and saved tushare token.")
    parser.add_argument("--window", type=int, default=DEFAULT_WINDOW, help="Trend regression rolling trading-day window.")
    parser.add_argument("--momentum-short-window", type=int, default=DEFAULT_MOMENTUM_SHORT_WINDOW)
    parser.add_argument("--momentum-long-window", type=int, default=DEFAULT_MOMENTUM_LONG_WINDOW)
    parser.add_argument("--normalization-window", type=int, default=DEFAULT_NORMALIZATION_WINDOW)
    parser.add_argument("--normalization-min-rows", type=int, default=DEFAULT_NORMALIZATION_MIN_ROWS)
    parser.add_argument("--trend-weight", type=float, default=DEFAULT_TREND_WEIGHT)
    parser.add_argument("--momentum-weight", type=float, default=DEFAULT_MOMENTUM_WEIGHT)
    parser.add_argument("--volume-weight", type=float, default=DEFAULT_VOLUME_WEIGHT)
    parser.add_argument("--asset-type", choices=["auto", "stock", "fund"], default="auto")
    parser.add_argument(
        "--warmup-days",
        type=int,
        help="Calendar days fetched before start-date. Default keeps enough history for rolling normalization.",
    )
    parser.add_argument("--input-csv", help="Optional local CSV with date/trade_date, close, and volume/vol columns.")
    parser.add_argument("--output", help="Output JSON path.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.window <= 0:
        raise RuntimeError("--window must be greater than 0.")
    if args.momentum_short_window <= 0:
        raise RuntimeError("--momentum-short-window must be greater than 0.")
    if args.momentum_long_window <= 0:
        raise RuntimeError("--momentum-long-window must be greater than 0.")
    if args.normalization_window <= 0:
        raise RuntimeError("--normalization-window must be greater than 0.")
    weight_sum = args.trend_weight + args.momentum_weight + args.volume_weight
    if weight_sum <= 0:
        raise RuntimeError("Weight sum must be greater than 0.")

    ts_code = normalize_ts_code(args.ts_code)
    requested_start = parse_date(args.start_date)
    requested_end = parse_date(args.end_date) if args.end_date else today_shanghai()
    if requested_start > requested_end:
        raise RuntimeError("start-date must be earlier than or equal to end-date.")

    end_was_clipped = False
    effective_end = requested_end
    if not args.input_csv:
        today = today_shanghai()
        if effective_end > today:
            effective_end = today
            end_was_clipped = True

    default_warmup_days = max(
        args.window * 4,
        args.momentum_long_window * 4,
        args.normalization_window * 2,
        90,
    )
    warmup_days = args.warmup_days if args.warmup_days is not None else default_warmup_days
    if warmup_days < 0:
        raise RuntimeError("--warmup-days must not be negative.")
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
        momentum_short_window=args.momentum_short_window,
        momentum_long_window=args.momentum_long_window,
        normalization_window=args.normalization_window,
        normalization_min_rows=args.normalization_min_rows,
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
            "momentum_windows": {
                "short": args.momentum_short_window,
                "long": args.momentum_long_window,
            },
            "normalization": {
                "method": "none",
                "applied": False,
                "window": args.normalization_window,
                "min_rows": args.normalization_min_rows,
                "notes": "Legacy arguments retained for compatibility; component scores use raw values directly.",
            },
            "weights": {
                "trend": args.trend_weight,
                "momentum": args.momentum_weight,
                "volume": args.volume_weight,
            },
            "score_version": "absolute_weighted_sum_v1",
            "rows": len(records),
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        },
        "records": records,
    }

    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(f"ts_code: {ts_code}")
    print(f"source: {source}")
    print(f"token_source: {token_source}")
    print(f"rows: {len(records)}")
    print(f"output: {output_path.resolve()}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ERROR] failed to export momentum strategy scores: {exc}")
        raise SystemExit(1)
