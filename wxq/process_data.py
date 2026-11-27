"""Read every non-ignored sheet in data.xlsx and export unified player match statistics."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
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


def summarize_ranks(ranks):
    count = len(ranks)
    win_count = sum(1 for rank in ranks if rank == 1)
    top3_count = sum(1 for rank in ranks if rank <= 3)
    return {
        "matchCount": count,
        "averageRank": math.fsum(ranks) / count,
        "winCount": win_count,
        "winRate": win_count / count,
        "top3Count": top3_count,
        "top3Rate": top3_count / count,
    }


def summarize_heroes(hero_groups, total_hero_matches=None):
    """Build hero statistics with nested lineup breakdowns."""
    heroes = []
    for hero_name, group in hero_groups.items():
        ranks = group["ranks"]
        lineup_groups = group["lineups"]
        lineup_match_count = sum(len(item) for item in lineup_groups.values())
        lineups = sorted(
            (
                {
                    "name": lineup_name,
                    "usageRate": len(lineup_ranks) / lineup_match_count,
                    **summarize_ranks(lineup_ranks),
                }
                for lineup_name, lineup_ranks in lineup_groups.items()
            ),
            key=lambda item: (-item["matchCount"], item["averageRank"], item["name"]),
        )
        entry = {
            "name": hero_name,
            **summarize_ranks(ranks),
            "lineupMatchCount": lineup_match_count,
            "lineups": lineups,
        }
        if total_hero_matches is not None:
            entry["usageRate"] = len(ranks) / total_hero_matches
        heroes.append(entry)
    return heroes


def aggregate(sheets):
    """Accept (sheet name, rows) pairs; validate everything before exporting."""
    players = {}
    match_count = 0
    sheet_count = 0
    expected_base = ["ID", "排名", *(label for _, label in METRICS)]
    for sheet_name, rows in sheets:
        if sheet_name.startswith("##"):
            continue
        sheet_count += 1
        header_row = None
        has_hero_column = False
        has_lineup_column = False
        match_in_sheet = 0
        seen = {}
        for row_number, values in enumerate(rows, 1):
            row = list(values[:9])
            row += [None] * (9 - len(row))
            if all(not text(value) for value in row):
                continue
            location = f"Sheet「{sheet_name}」第 {row_number} 行"
            if text(row[0]) == "ID":
                labels = [text(value).rsplit("/", 1)[-1].strip() for value in row]
                extra = tuple(labels[7:9])
                if labels[:7] != expected_base or extra not in (("", ""), ("棋手", ""), ("棋手", "阵容")):
                    raise ValueError(f"{location}：表头应为 ID、排名、经济、攻击、生存、成长、操作（可选第 8、9 列：棋手、阵容；指标可带 / 前缀）。")
                if header_row is not None and not seen:
                    raise ValueError(f"Sheet「{sheet_name}」第 {header_row} 行：该场对局没有玩家数据。")
                header_row = row_number
                has_hero_column = labels[7] == "棋手"
                has_lineup_column = labels[8] == "阵容"
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
            match_record = {
                "matchId": match_count, "sheet": sheet_name,
                "matchInSheet": match_in_sheet, "headerRow": header_row,
                "row": row_number, **stats,
            }
            hero = text(row[7]) if has_hero_column else ""
            lineup = text(row[8]) if has_lineup_column else ""
            if hero:
                match_record["hero"] = hero
                if lineup:
                    match_record["lineup"] = lineup
            player = players.setdefault(player_id, {"id": player_id, "matches": []})
            player["matches"].append(match_record)
        if header_row is not None and not seen:
            raise ValueError(f"Sheet「{sheet_name}」第 {header_row} 行：该场对局没有玩家数据。")
    if not players:
        raise ValueError("所有 Sheet 中均未找到有效对局数据。")
    return summarize(players, sheet_count, match_count)


def summarize(players, sheet_count, match_count):
    """Compute rankings, win/top3 rates, equal-weight player averages, and hero/lineup stats."""
    global_heroes = {}
    for player in players.values():
        player["matchCount"] = len(player["matches"])
        player["totals"] = {key: math.fsum(match[key] for match in player["matches"]) for key in FIELDS}
        player["averages"] = {key: player["totals"][key] / player["matchCount"] for key in FIELDS}
        rank_stats = summarize_ranks([match["rank"] for match in player["matches"]])
        player["winCount"] = rank_stats["winCount"]
        player["winRate"] = rank_stats["winRate"]
        player["top3Count"] = rank_stats["top3Count"]
        player["top3Rate"] = rank_stats["top3Rate"]
        player_heroes = {}
        for match in player["matches"]:
            hero = match.get("hero")
            if not hero:
                continue
            rank = match["rank"]
            lineup = match.get("lineup")
            for target in (player_heroes, global_heroes):
                group = target.setdefault(hero, {"ranks": [], "lineups": {}})
                group["ranks"].append(rank)
                if lineup:
                    group["lineups"].setdefault(lineup, []).append(rank)
        hero_match_count = sum(len(group["ranks"]) for group in player_heroes.values())
        player["heroMatchCount"] = hero_match_count
        player["heroes"] = sorted(
            summarize_heroes(player_heroes, hero_match_count),
            key=lambda item: (-item["matchCount"], item["averageRank"], item["name"]),
        )
    ordered = sorted(players.values(), key=lambda p: (p["averages"]["rank"], -p["matchCount"], p["id"]))
    heroes = sorted(
        summarize_heroes(global_heroes),
        key=lambda item: (item["averageRank"], -item["matchCount"], item["name"]),
    )
    index = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sheetCount": sheet_count,
        "matchCount": match_count,
        "playerCount": len(players),
        "recordCount": sum(p["matchCount"] for p in ordered),
        "heroCount": len(heroes),
        "heroRecordCount": sum(item["matchCount"] for item in heroes),
        "averageMethod": "player_equal_weight",
        "overall": {key: math.fsum(p["averages"][key] for p in ordered) / len(players) for key in FIELDS},
        "metrics": [
            {"key": key, "label": label, "max": max(1, max(p["averages"][key] for p in ordered))}
            for key, label in METRICS
        ],
        "players": [],
        "heroes": heroes,
    }
    for player in ordered:
        filename = hashlib.sha256(player["id"].encode("utf-8")).hexdigest() + ".json"
        index["players"].append({
            "id": player["id"],
            "averageRank": player["averages"]["rank"],
            "matchCount": player["matchCount"],
            "winCount": player["winCount"],
            "winRate": player["winRate"],
            "top3Count": player["top3Count"],
            "top3Rate": player["top3Rate"],
            "heroMatchCount": player["heroMatchCount"],
            "file": f"players/{filename}",
            "totals": player["totals"],
            "averages": player["averages"],
            "heroes": player["heroes"],
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
    # Data errors above leave the previous JSON files completely untouched.
    (output / "players").mkdir(parents=True, exist_ok=True)
    for entry, player in zip(index["players"], players):
        write_json(output / entry["file"], player)
    write_json(output / "index.json", index)
    current = {entry["file"] for entry in index["players"]}
    for old in (output / "players").glob("*.json"):
        if len(old.stem) == 64 and all(c in "0123456789abcdef" for c in old.stem) and f"players/{old.name}" not in current:
            old.unlink()
    events_dir = output / "events"
    if events_dir.exists():
        shutil.rmtree(events_dir)
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
    print(f"生成成功：{result['sheetCount']} 个分页，{result['matchCount']} 场对局，{result['playerCount']} 位玩家，{result['heroCount']} 位棋手。")
    print(f"JSON：{args.output.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
