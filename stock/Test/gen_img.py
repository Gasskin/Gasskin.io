#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import datetime as dt
import os
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

try:
    import tushare as ts
except ImportError as exc:
    raise SystemExit(
        "Please install tushare, pandas and matplotlib first: py -3 -m pip install tushare pandas matplotlib"
    ) from exc


DEFAULT_TOKEN = "wwpecc0759164f58b88f05b57d0627629bb1d3c75e30b5683b3ed2f3"
DEFAULT_TS_CODE = "159681.SZ"
DEFAULT_START_DATE = "2025-01-01"
DEFAULT_WINDOW = 20
DEFAULT_TREND_WEIGHT = 40.0
DEFAULT_MOMENTUM_WEIGHT = 35.0
DEFAULT_VOLUME_WEIGHT = 25.0

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = SCRIPT_DIR


def get_pro_client():
    token = os.getenv("TUSHARE_TOKEN")
    if not token:
        try:
            token = ts.get_token()
        except Exception:
            token = ""
    token = token or DEFAULT_TOKEN
    return ts.pro_api(token)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate ETF factor charts.")
    parser.add_argument("--ts-code", default=DEFAULT_TS_CODE, help="ETF ts_code, e.g. 159681.SZ")
    parser.add_argument("--start-date", default=DEFAULT_START_DATE, help="Start date, format YYYY-MM-DD")
    parser.add_argument("--window", type=int, default=DEFAULT_WINDOW, help="Rolling trade-day window")
    parser.add_argument("--trend-weight", type=float, default=DEFAULT_TREND_WEIGHT, help="Trend factor weight")
    parser.add_argument("--momentum-weight", type=float, default=DEFAULT_MOMENTUM_WEIGHT, help="Momentum factor weight")
    parser.add_argument("--volume-weight", type=float, default=DEFAULT_VOLUME_WEIGHT, help="Volume factor weight")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Directory for PNG outputs")
    return parser.parse_args()


def normalize_ts_code(code: str) -> str:
    normalized = code.strip().upper()
    if "." in normalized:
        return normalized
    if normalized.startswith("5"):
        return f"{normalized}.SH"
    return f"{normalized}.SZ"


def fetch_fund_daily(pro, ts_code: str, start_date: str, end_date: str) -> pd.DataFrame:
    df = pro.fund_daily(
        ts_code=ts_code,
        start_date=start_date.replace("-", ""),
        end_date=end_date.replace("-", ""),
    )
    if df is None or df.empty:
        raise RuntimeError(f"No ETF daily data returned for {ts_code}")

    required = {"trade_date", "close", "vol"}
    missing = required.difference(df.columns)
    if missing:
        raise RuntimeError(f"{ts_code} missing fields: {sorted(missing)}")

    df = df.rename(columns={"trade_date": "date", "vol": "volume"}).copy()
    df["date"] = pd.to_datetime(df["date"], format="%Y%m%d")
    df = df.sort_values("date").set_index("date")
    return df[["close", "volume"]]


def calculate_b_and_r2(close_window: pd.Series) -> tuple[float, float]:
    y = np.log(close_window.astype(float).to_numpy())
    x = np.arange(len(y), dtype=float)

    slope = float(np.polyfit(x, y, 1)[0])
    if len(y) > 1 and float(np.std(y)) > 0:
        corr = float(np.corrcoef(x, y)[0, 1])
        corr = 0.0 if np.isnan(corr) else corr
    else:
        corr = 0.0
    r_squared = float(corr**2)
    return slope, r_squared


def build_metrics(
    df: pd.DataFrame,
    window: int,
    trend_weight: float,
    momentum_weight: float,
    volume_weight: float,
) -> pd.DataFrame:
    min_rows = max(window, 20, 11)
    if len(df) < min_rows:
        raise RuntimeError(f"Not enough trade days to build metrics. Need at least {min_rows}, got {len(df)}.")

    records: list[dict] = []
    closes = df["close"].astype(float)
    volumes = df["volume"].astype(float)

    for idx in range(window - 1, len(df)):
        end_date = df.index[idx]
        close_window = closes.iloc[idx - window + 1 : idx + 1]
        volume_window = volumes.iloc[idx - window + 1 : idx + 1]
        b, r_squared = calculate_b_and_r2(close_window)

        if len(close_window) < 11:
            momentum_score = np.nan
        else:
            roc_5 = (close_window.iloc[-1] / close_window.iloc[-6] - 1.0) * 100.0
            roc_10 = (close_window.iloc[-1] / close_window.iloc[-11] - 1.0) * 100.0
            momentum_score = 0.6 * roc_5 + 0.4 * roc_10

        if len(volume_window) < 20:
            volume_score = np.nan
        else:
            vol_ma_short = float(volume_window.tail(5).mean())
            vol_ma_long = float(volume_window.tail(20).mean())
            volume_score = float(np.log(vol_ma_short / vol_ma_long)) if vol_ma_short > 0 and vol_ma_long > 0 else 0.0

        trend_score = (b * 250.0) * r_squared
        total_score_raw = (
            trend_weight * trend_score
            + momentum_weight * momentum_score
            + volume_weight * volume_score
        )
        total_score = max(0.0, float(total_score_raw))

        records.append(
            {
                "date": end_date,
                "close": round(float(close_window.iloc[-1]), 4),
                "b": b,
                "r_squared": r_squared,
                "b_times_r_squared": b * r_squared,
                "trend_score": trend_score,
                "momentum_score": momentum_score,
                "volume_score": volume_score,
                "total_score": total_score,
                "total_score_raw": total_score_raw,
            }
        )

    metrics = pd.DataFrame(records).set_index("date")
    return metrics


def save_single_line_chart(
    series: pd.Series,
    title: str,
    ylabel: str,
    output_path: Path,
    color: str,
    zero_line: bool = False,
    threshold_line: float | None = None,
) -> None:
    fig, ax = plt.subplots(figsize=(14, 4.6), constrained_layout=True)
    ax.plot(series.index, series, color=color, linewidth=1.5)
    if zero_line:
        ax.axhline(0, color="#666666", linewidth=0.8, linestyle="--")
    if threshold_line is not None:
        ax.axhline(threshold_line, color="#c44e52", linewidth=1.0, linestyle="--")
        ax.text(
            series.index[-1],
            threshold_line,
            f"  {threshold_line:.0f}",
            color="#c44e52",
            va="bottom",
            ha="left",
        )
    ax.set_title(title)
    ax.set_ylabel(ylabel)
    ax.set_xlabel("Date")
    ax.set_ylim(bottom=0)
    ax.grid(alpha=0.25)
    fig.savefig(output_path, dpi=160)
    plt.close(fig)


def save_trend_chart(metrics: pd.DataFrame, ts_code: str, window: int, output_path: Path) -> None:
    fig, axes = plt.subplots(3, 1, figsize=(14, 9), sharex=True, constrained_layout=True)
    fig.suptitle(f"{ts_code} b / R^2 / b*R^2 ({window}-day rolling window)", fontsize=14)

    axes[0].plot(metrics.index, metrics["b"], color="#d62728", linewidth=1.4)
    axes[0].axhline(0, color="#666666", linewidth=0.8, linestyle="--")
    axes[0].set_ylabel("b")
    axes[0].grid(alpha=0.25)

    axes[1].plot(metrics.index, metrics["r_squared"], color="#2ca02c", linewidth=1.4)
    axes[1].set_ylabel("R^2")
    axes[1].set_ylim(bottom=0)
    axes[1].grid(alpha=0.25)

    axes[2].plot(metrics.index, metrics["b_times_r_squared"], color="#9467bd", linewidth=1.4)
    axes[2].axhline(0, color="#666666", linewidth=0.8, linestyle="--")
    axes[2].set_ylabel("b * R^2")
    axes[2].set_xlabel("Date")
    axes[2].grid(alpha=0.25)

    fig.savefig(output_path, dpi=160)
    plt.close(fig)


def main() -> None:
    args = parse_args()
    pro = get_pro_client()

    ts_code = normalize_ts_code(args.ts_code)
    start_date = args.start_date
    end_date = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime("%Y-%m-%d")
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    df = fetch_fund_daily(pro, ts_code, start_date, end_date)
    metrics = build_metrics(
        df=df,
        window=args.window,
        trend_weight=args.trend_weight,
        momentum_weight=args.momentum_weight,
        volume_weight=args.volume_weight,
    )

    prefix = ts_code.replace(".", "_").lower()
    close_path = output_dir / f"{prefix}_close.png"
    trend_path = output_dir / f"{prefix}_trend_metrics.png"
    momentum_path = output_dir / f"{prefix}_momentum_score.png"
    volume_path = output_dir / f"{prefix}_volume_score.png"
    total_path = output_dir / f"{prefix}_total_score.png"

    save_single_line_chart(
        series=metrics["close"],
        title=f"{ts_code} Close Price",
        ylabel="Close",
        output_path=close_path,
        color="#1f77b4",
    )
    save_trend_chart(metrics=metrics, ts_code=ts_code, window=args.window, output_path=trend_path)
    save_single_line_chart(
        series=metrics["momentum_score"],
        title=f"{ts_code} Momentum Score",
        ylabel="Momentum",
        output_path=momentum_path,
        color="#ff7f0e",
        zero_line=True,
    )
    save_single_line_chart(
        series=metrics["volume_score"],
        title=f"{ts_code} Volume Score",
        ylabel="Volume Score",
        output_path=volume_path,
        color="#2ca02c",
        zero_line=True,
    )
    save_single_line_chart(
        series=metrics["total_score"],
        title=f"{ts_code} Total Weighted Score",
        ylabel="Total Score",
        output_path=total_path,
        color="#9467bd",
        zero_line=True,
        threshold_line=100.0,
    )

    print(f"ts_code: {ts_code}")
    print(f"start_date: {start_date}")
    print(f"end_date: {end_date}")
    print(f"window: {args.window}")
    print(f"rows: {len(metrics)}")
    print(f"close_chart: {close_path}")
    print(f"trend_chart: {trend_path}")
    print(f"momentum_chart: {momentum_path}")
    print(f"volume_chart: {volume_path}")
    print(f"total_score_chart: {total_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ERROR] failed to generate charts: {exc}")
        raise SystemExit(1)
