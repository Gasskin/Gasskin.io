#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

try:
    import tushare as ts
except ImportError as exc:
    raise SystemExit("Please install tushare and pandas first: py -3 -m pip install tushare pandas") from exc


DEFAULT_TOKEN = "wwpecc0759164f58b88f05b57d0627629bb1d3c75e30b5683b3ed2f3"
BUY_AMOUNT = 10_000.0
START_MONTH = "202301"
MAX_POSITIONS = 3
TREND_WINDOW = 25
TREND_WEIGHT = 40.0
MOMENTUM_WEIGHT = 35.0
VOLUME_WEIGHT = 25.0
FETCH_BUFFER_DAYS = 120
REQUEST_SLEEP_SECONDS = 0.35

SCRIPT_DIR = Path(__file__).resolve().parent
BACK_FILE = SCRIPT_DIR / "back.txt"
OUTPUT_FILE = SCRIPT_DIR / "backtest_result.json"


@dataclass
class Position:
    ts_code: str
    name: str
    shares: float
    cost: float


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
    parser = argparse.ArgumentParser(description="ETF multi-factor momentum backtest")
    parser.add_argument("--start-month", default=START_MONTH, help="Backtest start month, format YYYYMM")
    parser.add_argument("--buy-amount", type=float, default=BUY_AMOUNT, help="Capital per ETF position")
    parser.add_argument("--max-positions", type=int, default=MAX_POSITIONS, help="Max number of ETFs to hold")
    parser.add_argument("--trend-window", type=int, default=TREND_WINDOW, help="Trend window used by factor model")
    parser.add_argument("--trend-weight", type=float, default=TREND_WEIGHT, help="Trend factor weight")
    parser.add_argument("--momentum-weight", type=float, default=MOMENTUM_WEIGHT, help="Momentum factor weight")
    parser.add_argument("--volume-weight", type=float, default=VOLUME_WEIGHT, help="Volume factor weight")
    parser.add_argument("--output", default=str(OUTPUT_FILE), help="Output JSON path")
    return parser.parse_args()


def parse_back_file(path: Path) -> list[str]:
    if not path.is_file():
        raise FileNotFoundError(f"ETF list file not found: {path}")

    codes: list[str] = []
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        codes.append(line.upper())

    if not codes:
        raise ValueError(f"No ETF code found in {path}")
    return codes


def month_to_date(month: str) -> dt.date:
    return dt.datetime.strptime(month, "%Y%m").date().replace(day=1)


def heuristic_ts_code(code: str) -> str:
    if "." in code:
        return code.upper()
    normalized = code.strip()
    if normalized.startswith("5"):
        return f"{normalized}.SH"
    return f"{normalized}.SZ"


def build_fund_lookup(pro) -> tuple[dict[str, str], dict[str, str]]:
    bare_to_ts: dict[str, str] = {}
    ts_to_name: dict[str, str] = {}

    try:
        df = pro.fund_basic(market="E", status="L")
        if df is not None and not df.empty:
            for row in df.itertuples(index=False):
                ts_code = str(row.ts_code).upper()
                bare = ts_code.split(".")[0]
                bare_to_ts[bare] = ts_code
                name = getattr(row, "name", None) or getattr(row, "fund_name", None) or ts_code
                ts_to_name[ts_code] = str(name)
    except Exception:
        pass

    return bare_to_ts, ts_to_name


def resolve_etfs(raw_codes: Iterable[str], bare_to_ts: dict[str, str], ts_to_name: dict[str, str]) -> list[dict]:
    resolved: list[dict] = []
    for code in raw_codes:
        if "." in code:
            ts_code = code.upper()
        else:
            ts_code = bare_to_ts.get(code, heuristic_ts_code(code))
        resolved.append(
            {
                "code": code.split(".")[0],
                "ts_code": ts_code,
                "name": ts_to_name.get(ts_code, ts_code),
            }
        )
    return resolved


def fetch_fund_daily(pro, ts_code: str, start_date: str, end_date: str) -> pd.DataFrame:
    df = pro.fund_daily(ts_code=ts_code, start_date=start_date, end_date=end_date)
    if df is None or df.empty:
        raise RuntimeError(f"No ETF daily data returned for {ts_code}")

    required = {"trade_date", "open", "high", "low", "close", "vol", "amount"}
    missing = required.difference(df.columns)
    if missing:
        raise RuntimeError(f"{ts_code} missing fields: {sorted(missing)}")

    df = df.rename(columns={"trade_date": "date", "vol": "volume"}).copy()
    df["date"] = pd.to_datetime(df["date"], format="%Y%m%d")
    df = df.sort_values("date").set_index("date")
    return df[["open", "high", "low", "close", "volume", "amount"]]


def calculate_factor_scores(
    df: pd.DataFrame,
    trend_window: int,
    trend_weight: float,
    momentum_weight: float,
    volume_weight: float,
) -> dict | None:
    window = df.tail(trend_window * 2).copy()
    min_rows = max(trend_window, 20, 11)
    if len(window) < min_rows:
        return None

    close_values = window["close"].astype(float)
    volume_values = window["volume"].astype(float)
    x = np.arange(len(window), dtype=float)
    y = np.log(close_values.to_numpy())

    slope = float(np.polyfit(x, y, 1)[0])
    if len(window) > 1 and float(np.std(y)) > 0:
        corr = float(np.corrcoef(x, y)[0, 1])
        corr = 0.0 if np.isnan(corr) else corr
    else:
        corr = 0.0
    trend_score = float((slope * 250.0) * (corr ** 2))

    roc_5 = float((close_values.iloc[-1] / close_values.iloc[-6] - 1.0) * 100.0)
    roc_10 = float((close_values.iloc[-1] / close_values.iloc[-11] - 1.0) * 100.0)
    momentum_score = float(0.6 * roc_5 + 0.4 * roc_10)

    vol_ma_short = float(volume_values.tail(5).mean())
    vol_ma_long = float(volume_values.tail(20).mean())
    volume_score = float(np.log(vol_ma_short / vol_ma_long)) if vol_ma_short > 0 and vol_ma_long > 0 else 0.0

    total_score_raw = (
        trend_weight * trend_score
        + momentum_weight * momentum_score
        + volume_weight * volume_score
    )
    total_score = max(0.0, min(100.0, float(total_score_raw)))
    daily_return_pct = float((close_values.iloc[-1] / close_values.iloc[-2] - 1.0) * 100.0)

    return {
        "trend_score": round(trend_score, 4),
        "momentum_score": round(momentum_score, 4),
        "volume_score": round(volume_score, 4),
        "total_score": round(total_score, 4),
        "total_score_raw": round(float(total_score_raw), 4),
        "daily_return_pct": round(daily_return_pct, 4),
    }


def build_signal_board(
    etfs: list[dict],
    data_map: dict[str, pd.DataFrame],
    signal_date: pd.Timestamp,
    trend_window: int,
    trend_weight: float,
    momentum_weight: float,
    volume_weight: float,
    max_positions: int,
) -> tuple[list[dict], dict[str, dict], list[dict]]:
    scored: list[dict] = []

    for etf in etfs:
        ts_code = etf["ts_code"]
        history = data_map[ts_code][data_map[ts_code].index <= signal_date]
        scores = calculate_factor_scores(
            df=history,
            trend_window=trend_window,
            trend_weight=trend_weight,
            momentum_weight=momentum_weight,
            volume_weight=volume_weight,
        )
        if scores is None:
            continue
        scored.append(
            {
                "code": etf["code"],
                "ts_code": ts_code,
                "name": etf["name"],
                **scores,
            }
        )

    scored.sort(
        key=lambda item: (
            item["total_score"],
            item["trend_score"],
            item["momentum_score"],
            item["volume_score"],
            item["ts_code"],
        ),
        reverse=True,
    )

    for rank, item in enumerate(scored, start=1):
        item["rank"] = rank

    score_map = {item["ts_code"]: item for item in scored}
    selected = [item for item in scored if item["total_score"] > 0][:max_positions]
    return scored, score_map, selected


def calculate_snapshot(
    positions: dict[str, Position],
    data_map: dict[str, pd.DataFrame],
    valuation_date: pd.Timestamp | None,
) -> tuple[float, list[dict]]:
    holdings: list[dict] = []
    market_value = 0.0

    if valuation_date is None:
        return market_value, holdings

    for ts_code, position in positions.items():
        history = data_map[ts_code][data_map[ts_code].index <= valuation_date]
        if history.empty:
            continue
        row = history.iloc[-1]
        price = float(row["close"])
        value = position.shares * price
        market_value += value
        holdings.append(
            {
                "ts_code": ts_code,
                "name": position.name,
                "shares": round(position.shares, 6),
                "cost": round(position.cost, 2),
                "close_price": round(price, 4),
                "market_value": round(value, 2),
                "unrealized_pnl": round(value - position.cost, 2),
                "unrealized_pct": round((value - position.cost) / position.cost * 100, 2) if position.cost else None,
            }
        )

    holdings.sort(key=lambda item: item["ts_code"])
    return round(market_value, 2), holdings


def backtest(
    etfs: list[dict],
    data_map: dict[str, pd.DataFrame],
    start_month: str,
    buy_amount: float,
    max_positions: int,
    trend_window: int,
    trend_weight: float,
    momentum_weight: float,
    volume_weight: float,
) -> dict:
    common_dates = sorted(set.union(*(set(df.index) for df in data_map.values())))
    if len(common_dates) < 2:
        raise RuntimeError("Not enough trade dates across ETFs")

    start_date = pd.Timestamp(month_to_date(start_month))
    positions: dict[str, Position] = {}
    transactions: list[dict] = []
    rebalance_results: list[dict] = []

    cash = 0.0
    total_buy_cost = 0.0
    total_sell_amount = 0.0

    for idx in range(1, len(common_dates)):
        trade_date = common_dates[idx]
        signal_date = common_dates[idx - 1]
        if trade_date < start_date:
            continue

        scored, score_map, selected = build_signal_board(
            etfs=etfs,
            data_map=data_map,
            signal_date=signal_date,
            trend_window=trend_window,
            trend_weight=trend_weight,
            momentum_weight=momentum_weight,
            volume_weight=volume_weight,
            max_positions=max_positions,
        )
        selected = [item for item in selected if trade_date in data_map[item["ts_code"]].index]
        selected_codes = {item["ts_code"] for item in selected}
        actions: list[dict] = []

        for ts_code in list(positions):
            if ts_code in selected_codes:
                continue
            if trade_date not in data_map[ts_code].index:
                continue

            position = positions.pop(ts_code)
            score = score_map.get(ts_code)
            sell_price = float(data_map[ts_code].loc[trade_date, "open"])
            proceeds = position.shares * sell_price
            pnl = proceeds - position.cost

            cash += proceeds
            total_sell_amount += proceeds

            action = {
                "trade_date": trade_date.strftime("%Y-%m-%d"),
                "signal_date": signal_date.strftime("%Y-%m-%d"),
                "action": "SELL",
                "ts_code": ts_code,
                "name": position.name,
                "price": round(sell_price, 4),
                "shares": round(position.shares, 6),
                "amount": round(proceeds, 2),
                "cost": round(position.cost, 2),
                "pnl": round(pnl, 2),
                "rank": score["rank"] if score else None,
                "daily_return_pct": score["daily_return_pct"] if score else None,
                "trend_score": score["trend_score"] if score else None,
                "momentum_score": score["momentum_score"] if score else None,
                "volume_score": score["volume_score"] if score else None,
                "total_score": score["total_score"] if score else None,
            }
            transactions.append(action)
            actions.append(action)

        for item in selected:
            ts_code = item["ts_code"]
            if ts_code in positions:
                continue
            if trade_date not in data_map[ts_code].index:
                continue

            buy_price = float(data_map[ts_code].loc[trade_date, "open"])
            shares = buy_amount / buy_price if buy_price else 0.0
            if shares <= 0:
                continue

            positions[ts_code] = Position(
                ts_code=ts_code,
                name=item["name"],
                shares=shares,
                cost=buy_amount,
            )
            cash -= buy_amount
            total_buy_cost += buy_amount

            action = {
                "trade_date": trade_date.strftime("%Y-%m-%d"),
                "signal_date": signal_date.strftime("%Y-%m-%d"),
                "action": "BUY",
                "ts_code": ts_code,
                "name": item["name"],
                "price": round(buy_price, 4),
                "shares": round(shares, 6),
                "amount": round(buy_amount, 2),
                "rank": item["rank"],
                "daily_return_pct": item["daily_return_pct"],
                "trend_score": item["trend_score"],
                "momentum_score": item["momentum_score"],
                "volume_score": item["volume_score"],
                "total_score": item["total_score"],
            }
            transactions.append(action)
            actions.append(action)

        market_value, holdings = calculate_snapshot(positions, data_map, trade_date)
        asset_value = cash + market_value
        rebalance_results.append(
            {
                "trade_date": trade_date.strftime("%Y-%m-%d"),
                "signal_date": signal_date.strftime("%Y-%m-%d"),
                "selected": [
                    {
                        "ts_code": item["ts_code"],
                        "name": item["name"],
                        "rank": item["rank"],
                        "total_score": item["total_score"],
                    }
                    for item in selected
                ],
                "actions": actions,
                "cash": round(cash, 2),
                "market_value": market_value,
                "asset_value": round(asset_value, 2),
                "holdings": holdings,
            }
        )

    last_trade_date = common_dates[-1]
    market_value, holdings = calculate_snapshot(positions, data_map, last_trade_date)
    asset_value = cash + market_value

    return {
        "params": {
            "strategy": "study_momentum_top_n",
            "start_month": start_month,
            "buy_amount": buy_amount,
            "max_positions": max_positions,
            "trend_window": trend_window,
            "trend_weight": trend_weight,
            "momentum_weight": momentum_weight,
            "volume_weight": volume_weight,
        },
        "summary": {
            "rebalance_days": len(rebalance_results),
            "total_buy_cost": round(total_buy_cost, 2),
            "total_sell_amount": round(total_sell_amount, 2),
            "cash": round(cash, 2),
            "market_value": market_value,
            "asset_value": round(asset_value, 2),
            "profit": round(asset_value - total_buy_cost, 2),
            "profit_pct": round((asset_value - total_buy_cost) / total_buy_cost * 100, 2) if total_buy_cost else None,
            "position_count": len(positions),
            "transaction_count": len(transactions),
            "last_trade_date": last_trade_date.strftime("%Y-%m-%d"),
        },
        "transactions": transactions,
        "rebalance_results": rebalance_results,
        "final_holdings": holdings,
    }


def build_trade_json(result: dict, etfs: list[dict]) -> dict:
    holdings_by_code = {item["ts_code"]: item for item in result["final_holdings"]}
    grouped: dict[str, dict] = {}

    for etf in etfs:
        grouped[etf["ts_code"]] = {
            "code": etf["code"],
            "ts_code": etf["ts_code"],
            "name": etf["name"],
            "trades": [],
            "summary": {
                "buy_amount": 0.0,
                "sell_amount": 0.0,
                "holding_value": 0.0,
                "profit": 0.0,
                "return_pct": None,
            },
        }

    for item in result["transactions"]:
        target = grouped[item["ts_code"]]
        trade = {
            "date": item["trade_date"],
            "signal_date": item["signal_date"],
            "action": item["action"],
            "price": round(float(item["price"]), 4),
            "change_pct": round(float(item["daily_return_pct"]), 4) if item["daily_return_pct"] is not None else None,
            "shares": round(float(item["shares"]), 6),
            "amount": round(float(item["amount"]), 2),
            "rank": item["rank"],
            "total_score": item["total_score"],
            "trend_score": item["trend_score"],
            "momentum_score": item["momentum_score"],
            "volume_score": item["volume_score"],
        }
        if item["action"] == "SELL":
            trade["profit"] = round(float(item["pnl"]), 2)

        target["trades"].append(trade)

        if item["action"] == "BUY":
            target["summary"]["buy_amount"] += float(item["amount"])
        else:
            target["summary"]["sell_amount"] += float(item["amount"])

    total_buy_amount = 0.0
    total_sell_amount = 0.0
    total_holding_value = 0.0

    for ts_code, info in grouped.items():
        holding = holdings_by_code.get(ts_code)
        holding_value = float(holding["market_value"]) if holding else 0.0
        buy_amount = float(info["summary"]["buy_amount"])
        sell_amount = float(info["summary"]["sell_amount"])
        profit = sell_amount + holding_value - buy_amount
        return_pct = round(profit / buy_amount * 100, 2) if buy_amount else None

        info["summary"] = {
            "buy_amount": round(buy_amount, 2),
            "sell_amount": round(sell_amount, 2),
            "holding_value": round(holding_value, 2),
            "profit": round(profit, 2),
            "return_pct": return_pct,
        }

        total_buy_amount += buy_amount
        total_sell_amount += sell_amount
        total_holding_value += holding_value

    all_profit = total_sell_amount + total_holding_value - total_buy_amount
    all_return_pct = round(all_profit / total_buy_amount * 100, 2) if total_buy_amount else None

    return {
        "generated_at": result["generated_at"],
        "params": result["params"],
        "backtest_summary": result["summary"],
        "etfs": grouped,
        "all": {
            "buy_amount": round(total_buy_amount, 2),
            "sell_amount": round(total_sell_amount, 2),
            "holding_value": round(total_holding_value, 2),
            "profit": round(all_profit, 2),
            "return_pct": all_return_pct,
        },
    }


def print_transactions(transactions: list[dict]) -> None:
    print("\ntransactions:")
    if not transactions:
        print("no trades")
        return

    for item in transactions:
        print(
            f"{item['trade_date']} {item['action']:>4} "
            f"{item['name']}({item['ts_code']}) "
            f"price={item['price']:.4f} shares={item['shares']:.6f} "
            f"amount={item['amount']:.2f} rank={item['rank']} "
            f"score={item['total_score']}"
        )


def main() -> None:
    args = parse_args()
    pro = get_pro_client()

    raw_codes = parse_back_file(BACK_FILE)
    bare_to_ts, ts_to_name = build_fund_lookup(pro)
    etfs = resolve_etfs(raw_codes, bare_to_ts, ts_to_name)

    fetch_start_date = (month_to_date(args.start_month) - dt.timedelta(days=FETCH_BUFFER_DAYS)).strftime("%Y%m%d")
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=8)))
    fetch_end_date = today.strftime("%Y%m%d")

    data_map: dict[str, pd.DataFrame] = {}
    for index, etf in enumerate(etfs, start=1):
        print(f"[{index}/{len(etfs)}] fetch {etf['ts_code']} {etf['name']} ...")
        data_map[etf["ts_code"]] = fetch_fund_daily(pro, etf["ts_code"], fetch_start_date, fetch_end_date)
        time.sleep(REQUEST_SLEEP_SECONDS)

    result = backtest(
        etfs=etfs,
        data_map=data_map,
        start_month=args.start_month,
        buy_amount=args.buy_amount,
        max_positions=args.max_positions,
        trend_window=args.trend_window,
        trend_weight=args.trend_weight,
        momentum_weight=args.momentum_weight,
        volume_weight=args.volume_weight,
    )
    result["generated_at"] = today.strftime("%Y-%m-%d %H:%M:%S")
    trade_json = build_trade_json(result, etfs)

    output_path = Path(args.output).resolve()
    with output_path.open("w", encoding="utf-8") as fp:
        json.dump(trade_json, fp, ensure_ascii=False, indent=2)

    summary = result["summary"]
    print("\nbacktest finished")
    print(f"output: {output_path}")
    print(f"rebalance_days: {summary['rebalance_days']}")
    print(f"total_buy_cost: {summary['total_buy_cost']:.2f}")
    print(f"total_sell_amount: {summary['total_sell_amount']:.2f}")
    print(f"cash: {summary['cash']:.2f}")
    print(f"market_value: {summary['market_value']:.2f}")
    print(f"asset_value: {summary['asset_value']:.2f}")
    print(f"profit: {summary['profit']:.2f}")
    print(f"profit_pct: {summary['profit_pct'] if summary['profit_pct'] is not None else 'N/A'}%")
    print(f"transaction_count: {summary['transaction_count']}")
    print(f"all_return_pct: {trade_json['all']['return_pct'] if trade_json['all']['return_pct'] is not None else 'N/A'}%")
    print_transactions(result["transactions"])


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ERROR] ETF backtest failed: {exc}")
        raise SystemExit(1)
