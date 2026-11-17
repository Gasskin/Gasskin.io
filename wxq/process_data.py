"""Read every sheet in data.xlsx and export per-player match statistics."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile

import openpyxl


ROOT = Path(__file__).resolve().parent
METRICS = (
    ("economy", "经济"),
    ("attack", "攻击"),
    ("survival", "生存"),
    ("growth", "成长"),
    ("operation", "操作"),
)
FIELDS = ("rank", *(key for key, _ in METRICS))


def text(value):
    return "" if value is None else str(value).strip()


def aggregate(sheets):
    """Accept (sheet name, rows) pairs; validate everything before exporting."""
    players = {}
    match_count = 0
    sheet_count = 0
    for sheet_name, rows in sheets:
        sheet_count += 1
        header_row = None
        match_in_sheet = 0
        seen = {}
        for row_number, values in enumerate(rows, 1):
            row = list(values[:7])
            row += [None] * (7 - len(row))
            if all(not text(value) for value in row):
                continue
            location = f"Sheet「{sheet_name}」第 {row_number} 行"
            if text(row[0]) == "ID":
                labels = [text(value).rsplit("/", 1)[-1].strip() for value in row]
                if labels != ["ID", "排名", *(label for _, label in METRICS)]:
                    raise ValueError(f"{location}：表头应为 ID、排名、经济、攻击、生存、成长、操作（指标可带 / 前缀）。")
                if header_row is not None and not seen:
                    raise ValueError(f"Sheet「{sheet_name}」第 {header_row} 行：该场对局没有玩家数据。")
                header_row = row_number
                match_in_sheet += 1
                match_count += 1
                seen = {}
                continue
            if header_row is None:
                raise ValueError(f"{location}：玩家数据前缺少 ID 表头。")
            player_id = text(row[0])
            if not player_id:
                raise ValueError(f"{location}：ID 不能为空。")
            if player_id in seen:
                raise ValueError(f"{location}：第 {match_in_sheet} 场出现重复 ID「{player_id}」，首次出现在第 {seen[player_id]} 行。")
            seen[player_id] = row_number
            stats = {}
            for column, (key, label) in enumerate((("rank", "排名"), *METRICS), 1):
                value = row[column]
                try:
                    if value is None or isinstance(value, bool):
                        raise ValueError()
                    number = float(value)
                    if not math.isfinite(number) or number < 0:
                        raise ValueError()
                    if key == "rank" and (number < 1 or not number.is_integer()):
                        raise ValueError()
                except (TypeError, ValueError, OverflowError):
                    raise ValueError(f"{location}：{label}必须是{'正整数' if key == 'rank' else '非负有限数值'}，当前为 {value!r}；公式单元格请先在 Excel 中计算并保存。") from None
                stats[key] = number
            player = players.setdefault(player_id, {"id": player_id, "matches": []})
            player["matches"].append({
                "matchId": match_count, "sheet": sheet_name,
                "matchInSheet": match_in_sheet, "headerRow": header_row,
                "row": row_number, **stats,
            })
        if header_row is not None and not seen:
            raise ValueError(f"Sheet「{sheet_name}」第 {header_row} 行：该场对局没有玩家数据。")
    if not players:
        raise ValueError("所有 Sheet 中均未找到有效对局数据。")
    return summarize(players, sheet_count, match_count)


def summarize(players, sheet_count, match_count):
    """Use the same ranking and averaging rules for all matches or one event."""
    for player in players.values():
        player["matchCount"] = len(player["matches"])
        player["totals"] = {key: math.fsum(match[key] for match in player["matches"]) for key in FIELDS}
        player["averages"] = {key: player["totals"][key] / player["matchCount"] for key in FIELDS}
    ordered = sorted(players.values(), key=lambda p: (p["averages"]["rank"], -p["matchCount"], p["id"]))
    index = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sheetCount": sheet_count,
        "matchCount": match_count,
        "playerCount": len(players),
        "recordCount": sum(p["matchCount"] for p in ordered),
        "averageMethod": "player_equal_weight",
        "overall": {key: math.fsum(p["averages"][key] for p in ordered) / len(players) for key in FIELDS},
        "metrics": [
            {"key": key, "label": label, "max": max(1, max(p["averages"][key] for p in ordered))}
            for key, label in METRICS
        ],
        "players": [],
    }
    for player in ordered:
        filename = hashlib.sha256(player["id"].encode("utf-8")).hexdigest() + ".json"
        index["players"].append({
            "id": player["id"], "averageRank": player["averages"]["rank"],
            "matchCount": player["matchCount"], "file": f"players/{filename}",
            "totals": player["totals"],
        })
    return index, ordered


def write_json(path, data):
    temporary = None
    try:
        with NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(data, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def generate(source, output):
    workbook = openpyxl.load_workbook(source, read_only=True, data_only=True)
    try:
        index, players = aggregate((sheet.title, sheet.iter_rows(values_only=True)) for sheet in workbook.worksheets)
    finally:
        workbook.close()
    event_players = {}
    for player in players:
        for match in player["matches"]:
            group = event_players.setdefault(match["sheet"], {})
            group.setdefault(player["id"], {"id": player["id"], "matches": []})["matches"].append(match)
    index["events"] = []
    datasets = []
    for name, group in event_players.items():
        event_id = hashlib.sha256(name.encode("utf-8")).hexdigest()
        event_index, event_ordered = summarize(group, 1, len({m["matchId"] for p in group.values() for m in p["matches"]}))
        event_index["eventName"] = name
        index["events"].append({"name": name, "file": f"events/{event_id}/index.json"})
        datasets.append((output / "events" / event_id, event_index, event_ordered))
    index["events"].sort(key=lambda event: event["name"])
    datasets.append((output, index, players))
    # Data errors above leave the previous JSON files completely untouched.
    for directory, summary, ordered in datasets:
        (directory / "players").mkdir(parents=True, exist_ok=True)
        for entry, player in zip(summary["players"], ordered):
            write_json(directory / entry["file"], player)
        write_json(directory / "index.json", summary)
        current = {entry["file"] for entry in summary["players"]}
        for old in (directory / "players").glob("*.json"):
            if len(old.stem) == 64 and all(c in "0123456789abcdef" for c in old.stem) and f"players/{old.name}" not in current:
                old.unlink()
    return index


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", type=Path, default=ROOT / "data.xlsx")
    parser.add_argument("--output", type=Path, default=ROOT / "data")
    args = parser.parse_args()
    try:
        result = generate(args.source, args.output)
    except Exception as error:
        print(f"生成失败：{error}", file=sys.stderr)
        return 1
    print(f"生成成功：{len(result['events'])} 项赛事，{result['matchCount']} 场对局，{result['playerCount']} 位玩家。")
    print(f"JSON：{args.output.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
