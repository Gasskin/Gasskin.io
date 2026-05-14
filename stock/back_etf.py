#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
读取 momentum-output 下的每日动量分数 JSON，并按下面的规则回测：
1. 如果昨天 total_score >= threshold，则按今天开盘价买入。
2. 如果当前已经持仓，且昨天 total_score < threshold，则按今天开盘价卖出。

输出到 momentum-back/，每个 ETF 一个独立 JSON。
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path


STOCK_DIR = Path(__file__).resolve().parent
INPUT_DIR = STOCK_DIR / "momentum-output"
OUTPUT_DIR = STOCK_DIR / "momentum-back"
MANIFEST_NAME = "index.json"
DEFAULT_THRESHOLD = 100.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backtest ETF buy/sell actions from exported momentum scores.")
    parser.add_argument("--input-dir", default=str(INPUT_DIR), help="Directory containing momentum JSON files.")
    parser.add_argument("--output-dir", default=str(OUTPUT_DIR), help="Directory to write backtest JSON files.")
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD, help="Buy/sell threshold on yesterday score.")
    return parser.parse_args()


def today_shanghai_iso() -> str:
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat()


def load_manifest(input_dir: Path) -> list[dict]:
    manifest_path = input_dir / MANIFEST_NAME
    if manifest_path.is_file():
        payload = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        files = payload.get("files", [])
        if isinstance(files, list):
            normalized: list[dict] = []
            for item in files:
                if isinstance(item, dict) and item.get("file"):
                    normalized.append(item)
            if normalized:
                return normalized

    fallback: list[dict] = []
    for path in sorted(input_dir.glob("data*.json")):
        fallback.append({"ts_code": path.stem.replace("data", "").upper(), "name": path.stem, "file": path.name})
    return fallback


def to_float(value) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def ma60_value(record: dict) -> float | None:
    ma_values = record.get("ma")
    if not isinstance(ma_values, (list, tuple)) or len(ma_values) < 4:
        return None

    value = to_float(ma_values[3])
    if value is None or value < 0:
        return None
    return value


def build_backtest_for_file(file_path: Path, manifest_item: dict, threshold: float) -> dict:
    payload = json.loads(file_path.read_text(encoding="utf-8-sig"))
    metadata = payload.get("metadata", {})
    records = payload.get("records", [])
    records = [item for item in records if isinstance(item, dict) and item.get("date")]
    records.sort(key=lambda item: item["date"])

    ts_code = metadata.get("ts_code") or manifest_item.get("ts_code") or file_path.stem
    name = manifest_item.get("name") or metadata.get("name") or ts_code

    operations: list[dict] = []
    realized_profit = 0.0
    holding: dict | None = None
    skipped_days = 0

    for idx in range(1, len(records)):
        yesterday = records[idx - 1]
        today = records[idx]
        yesterday_score = to_float(yesterday.get("total_score"))
        yesterday_close = to_float(yesterday.get("close"))
        yesterday_ma60 = ma60_value(yesterday)
        today_open = to_float(today.get("open"))
        if yesterday_score is None or today_open is None:
            skipped_days += 1
            continue

        can_buy = (
            yesterday_score >= threshold
            and yesterday_close is not None
            and yesterday_ma60 is not None
            and yesterday_close >= yesterday_ma60
        )

        if holding is None and can_buy:
            holding = {
                "buy_signal_date": yesterday["date"],
                "buy_date": today["date"],
                "buy_price": today_open,
            }
            operations.append(
                {
                    "action": "BUY",
                    "signal_date": yesterday["date"],
                    "trade_date": today["date"],
                    "score_yesterday": round(yesterday_score, 4),
                    "price": round(today_open, 4),
                    "return_pct": 0.0,
                }
            )
            continue

        if holding is not None and yesterday_score < threshold:
            buy_price = float(holding["buy_price"])
            profit = today_open - buy_price
            return_pct = (profit / buy_price * 100.0) if buy_price else None
            realized_profit += profit
            operations.append(
                {
                    "action": "SELL",
                    "signal_date": yesterday["date"],
                    "trade_date": today["date"],
                    "score_yesterday": round(yesterday_score, 4),
                    "price": round(today_open, 4),
                    "buy_date": holding["buy_date"],
                    "buy_price": round(buy_price, 4),
                    "return_pct": round(return_pct, 4) if return_pct is not None else None,
                }
            )
            holding = None

    final_record = records[-1] if records else None
    latest_close = to_float(final_record.get("close")) if final_record else None
    unrealized_profit = 0.0
    open_position = None

    if holding is not None and latest_close is not None:
        buy_price = float(holding["buy_price"])
        unrealized_profit = latest_close - buy_price
        open_position = {
            "buy_signal_date": holding["buy_signal_date"],
            "buy_date": holding["buy_date"],
            "buy_price": round(buy_price, 4),
            "latest_date": final_record["date"],
            "latest_close": round(latest_close, 4),
            "unrealized_profit": round(unrealized_profit, 4),
            "unrealized_return_pct": round(unrealized_profit / buy_price * 100.0, 4) if buy_price else None,
        }

    total_profit = realized_profit + unrealized_profit
    total_return_pct = round(
        sum(item["return_pct"] for item in operations if isinstance(item.get("return_pct"), (int, float))),
        4,
    )

    return {
        "metadata": {
            "ts_code": ts_code,
            "name": name,
            "source_file": file_path.name,
            "generated_at": today_shanghai_iso(),
            "strategy": "buy at today's open when yesterday total_score >= threshold and yesterday close >= yesterday MA60; skip buy if MA60 is missing; sell at today's open when holding and yesterday total_score < threshold",
            "threshold": threshold,
            "position_unit": 1.0,
        },
        "summary": {
            "total_return_pct": total_return_pct,
        },
        "record_count": len(records),
        "operation_count": len(operations),
        "buy_count": sum(1 for item in operations if item["action"] == "BUY"),
        "sell_count": sum(1 for item in operations if item["action"] == "SELL"),
        "skipped_days": skipped_days,
        "realized_profit": round(realized_profit, 4),
        "unrealized_profit": round(unrealized_profit, 4),
        "total_profit": round(total_profit, 4),
        "has_open_position": holding is not None,
        "operations": operations,
        "open_position": open_position,
    }


def write_manifest(output_dir: Path, items: list[dict]) -> None:
    manifest = {
        "generated_at": today_shanghai_iso(),
        "files": items,
    }
    (output_dir / MANIFEST_NAME).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    input_dir = Path(args.input_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    items = load_manifest(input_dir)
    if not items:
        raise RuntimeError(f"No momentum JSON files found in {input_dir}")

    manifest_items: list[dict] = []
    for item in items:
        file_name = item["file"]
        input_path = input_dir / file_name
        if not input_path.is_file():
            print(f"Skip missing file: {input_path}")
            continue

        result = build_backtest_for_file(input_path, item, args.threshold)
        output_path = output_dir / file_name
        output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        manifest_items.append(
            {
                "ts_code": result["metadata"]["ts_code"],
                "name": result["metadata"]["name"],
                "file": file_name,
            }
        )
        print(f"Wrote {output_path}")

    write_manifest(output_dir, manifest_items)
    print(f"Finished. Output directory: {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
