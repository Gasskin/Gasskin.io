import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from process_data import METRICS, aggregate, generate, write_json


HEADER = ["ID", "排名", *(f"原始字段/{label}" for _, label in METRICS)]
HEADER_WITH_LINEUP = [*HEADER, "阵容"]


def row(name, rank, value, lineup=None):
    base = [name, rank, value, value, value, value, value]
    return base if lineup is None else [*base, lineup]


class StatisticsTests(unittest.TestCase):
    def test_hash_prefixed_sheets_are_excluded_before_validation(self):
        def unread_rows():
            raise AssertionError("Ignored sheet rows must not be consumed")
            yield

        sheets = [
            SimpleNamespace(title="##备注", iter_rows=lambda **kwargs: unread_rows()),
            SimpleNamespace(title="风云杯", iter_rows=lambda **kwargs: iter([HEADER, row("甲", 1, 10)])),
            SimpleNamespace(title="##散排", iter_rows=lambda **kwargs: iter([HEADER, row("甲", None, 900)])),
            SimpleNamespace(title="杯##决赛", iter_rows=lambda **kwargs: iter([HEADER, row("乙", 1, 30)])),
        ]
        workbook = SimpleNamespace(worksheets=sheets, close=lambda: None)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with patch("process_data.openpyxl.load_workbook", return_value=workbook):
                index = generate(Path("unused.xlsx"), output)
            self.assertEqual((index["sheetCount"], index["matchCount"], index["recordCount"]), (2, 2, 2))
            self.assertEqual(index["overall"]["economy"], 20)
            self.assertNotIn("events", index)
            self.assertFalse((output / "events").exists())
            for entry in index["players"]:
                player = json.loads((output / entry["file"]).read_text(encoding="utf-8"))
                self.assertEqual(player["matchCount"], 1)
                self.assertTrue(all(not match["sheet"].startswith("##") for match in player["matches"]))

    def test_all_sheets_matches_and_equal_player_weight(self):
        index, players = aggregate([
            ("第一天", [HEADER, row(" 甲 ", 1, 10), row("乙", 2, 100), [], HEADER, row("甲", 2, 20)]),
            ("第二天", [HEADER, row("甲", 3, 30)]),
            ("空白表", [[], [None] * 7]),
        ])
        self.assertEqual((index["sheetCount"], index["matchCount"], index["recordCount"]), (3, 3, 4))
        self.assertEqual([p["id"] for p in players], ["甲", "乙"])
        self.assertEqual(players[0]["matchCount"], 3)
        self.assertEqual(players[0]["averages"]["rank"], 2)
        self.assertEqual(players[0]["averages"]["economy"], 20)
        self.assertEqual(index["overall"]["economy"], 60)  # Not the record-weighted 40.
        self.assertEqual(players[0]["matches"][-1]["sheet"], "第二天")
        self.assertEqual(index["metrics"][0]["max"], 100)

    def test_duplicate_id_reports_source(self):
        with self.assertRaisesRegex(ValueError, "第 3 行.*重复 ID.*甲.*第 2 行"):
            aggregate([("决赛", [HEADER, row("甲", 1, 10), row(" 甲 ", 2, 20)])])

    def test_invalid_metrics_and_rank(self):
        for bad in (None, "", "错误", float("nan"), float("inf"), -1, True):
            with self.subTest(value=bad), self.assertRaises(ValueError):
                aggregate([("测试", [HEADER, row("甲", 1, bad)])])
        for rank in (0, -1, 1.5, None, True):
            with self.subTest(rank=rank), self.assertRaises(ValueError):
                aggregate([("测试", [HEADER, row("甲", rank, 10)])])

    def test_zero_metrics_and_safe_filenames(self):
        index, players = aggregate([("测试", [HEADER, row("../玩家/?:*", "1", "0")])])
        self.assertTrue(all(m["max"] == 1 for m in index["metrics"]))
        self.assertTrue(all(players[0]["averages"][key] == 0 for key, _ in METRICS))
        self.assertRegex(index["players"][0]["file"], r"^players/[0-9a-f]{64}\.json$")

    def test_missing_header_bad_header_empty_match_and_blank_id(self):
        cases = (
            [row("甲", 1, 10)],
            [["ID", "错误"]],
            [[*HEADER, "错误列"]],
            [HEADER],
            [HEADER, HEADER],
            [HEADER, row(" ", 1, 10)],
        )
        for rows in cases:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                aggregate([("测试", rows)])

    def test_validation_failure_keeps_previous_output(self):
        sheet = SimpleNamespace(title="决赛", iter_rows=lambda **kwargs: iter([HEADER, row("甲", 1, 10), row("甲", 2, 20)]))
        workbook = SimpleNamespace(worksheets=[sheet], close=lambda: None)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "index.json").write_bytes(b"previous index")
            (output / "players").mkdir()
            (output / "players" / "old.json").write_bytes(b"previous player")
            before = {p.relative_to(output): p.read_bytes() for p in output.rglob("*.json")}
            with patch("process_data.openpyxl.load_workbook", return_value=workbook), self.assertRaises(ValueError):
                generate(Path("unused.xlsx"), output)
            self.assertEqual(before, {p.relative_to(output): p.read_bytes() for p in output.rglob("*.json")})

    def test_export_is_per_player_and_removes_stale_generated_records(self):
        sheet = SimpleNamespace(title="决赛", iter_rows=lambda **kwargs: iter([HEADER, row("甲", 1, 10), row("乙", 2, 30)]))
        workbook = SimpleNamespace(worksheets=[sheet], close=lambda: None)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "players").mkdir()
            stale = output / "players" / ("0" * 64 + ".json")
            stale.write_text("{}")
            stale_events = output / "events" / ("1" * 64)
            stale_events.mkdir(parents=True)
            (stale_events / "index.json").write_text("{}")
            with patch("process_data.openpyxl.load_workbook", return_value=workbook):
                index = generate(Path("unused.xlsx"), output)
            self.assertFalse(stale.exists())
            self.assertFalse((output / "events").exists())
            self.assertEqual(json.loads((output / "index.json").read_text(encoding="utf-8")), index)
            self.assertEqual(len(list((output / "players").glob("*.json"))), 2)
            for entry in index["players"]:
                player = json.loads((output / entry["file"]).read_text(encoding="utf-8"))
                self.assertEqual(player["id"], entry["id"])
                self.assertEqual(len(player["matches"]), 1)
                self.assertEqual(entry["totals"], player["totals"])
                self.assertEqual(entry["averages"], player["averages"])

    def test_json_failure_keeps_original_file(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "index.json"
            target.write_text("previous")
            with self.assertRaises(ValueError):
                write_json(target, {"invalid": float("nan")})
            self.assertEqual(target.read_text(), "previous")
            self.assertEqual(list(Path(directory).iterdir()), [target])

    def test_multiple_sheets_are_unified_into_single_dataset(self):
        rows_by_sheet = {
            "风云杯": [HEADER, row("甲", 1, 10), row("乙", 2, 100), HEADER, row("甲", 1, 30)],
            "新人杯": [HEADER, row("甲", 3, 200), row("丙", 1, 80)],
            "空白赛事": [],
            "##散排": [HEADER, row("丁", 1, 900)],
        }
        sheets = [SimpleNamespace(title=name, iter_rows=lambda rows=rows, **kwargs: iter(rows)) for name, rows in rows_by_sheet.items()]
        workbook = SimpleNamespace(worksheets=sheets, close=lambda: None)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with patch("process_data.openpyxl.load_workbook", return_value=workbook):
                unified = generate(Path("unused.xlsx"), output)
            self.assertNotIn("events", unified)
            self.assertFalse((output / "events").exists())
            self.assertEqual(unified["sheetCount"], 3)
            self.assertEqual(unified["matchCount"], 3)
            self.assertEqual(unified["recordCount"], 5)
            self.assertEqual(unified["playerCount"], 3)
            self.assertEqual([p["id"] for p in unified["players"]], ["丙", "甲", "乙"])
            self.assertAlmostEqual(unified["overall"]["economy"], (80 + 100 + 80) / 3)
            self.assertEqual(unified["metrics"][0]["max"], 100)
            combined_entry = next(p for p in unified["players"] if p["id"] == "甲")
            combined = json.loads((output / combined_entry["file"]).read_text(encoding="utf-8"))
            self.assertEqual(combined["matchCount"], 3)
            self.assertEqual(combined["averages"]["economy"], 80)  # Weight all 3 matches across sheets.
            self.assertEqual(combined_entry["averages"], combined["averages"])

    def test_later_sheet_error_preserves_all_existing_datasets(self):
        valid = SimpleNamespace(title="风云杯", iter_rows=lambda **kwargs: iter([HEADER, row("甲", 1, 10)]))
        invalid = SimpleNamespace(title="新人杯", iter_rows=lambda **kwargs: iter([HEADER, row("乙", 1, 20), row("乙", 2, 30)]))
        workbook = SimpleNamespace(worksheets=[valid], close=lambda: None)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with patch("process_data.openpyxl.load_workbook", return_value=workbook):
                generate(Path("unused.xlsx"), output)
                before = {p.relative_to(output): p.read_bytes() for p in output.rglob("*.json")}
                workbook.worksheets.append(invalid)
                with self.assertRaisesRegex(ValueError, "新人杯.*重复 ID"):
                    generate(Path("unused.xlsx"), output)
            self.assertEqual(before, {p.relative_to(output): p.read_bytes() for p in output.rglob("*.json")})

    def test_win_top3_rates_and_lineup_stats_ignore_empty_cells(self):
        index, players = aggregate([
            ("第一天", [
                HEADER_WITH_LINEUP,
                row("甲", 1, 100, " 嫦娥 "),
                row("乙", 3, 90, "白哥三分"),
                row("丙", 4, 80, ""),
                HEADER_WITH_LINEUP,
                row("甲", 4, 110, "嫦娥"),
                row("乙", 2, 95, "   "),
                row("丙", 1, 85, "嫦娥"),
            ]),
            ("第二天", [
                HEADER_WITH_LINEUP,
                row("甲", 2, 120, "白哥三分"),
                row("甲" + " ", 1, 130, "") if False else row("乙", 5, 70, "白哥三分"),
                row("丙", 6, 60, None),
            ]),
        ])
        by_id = {p["id"]: p for p in index["players"]}
        # 甲: ranks [1, 4, 2] -> win=1/3, top3=2/3; lineups: 嫦娥(2), 白哥三分(1), total=3
        self.assertEqual(by_id["甲"]["winCount"], 1)
        self.assertAlmostEqual(by_id["甲"]["winRate"], 1 / 3)
        self.assertEqual(by_id["甲"]["top3Count"], 2)
        self.assertAlmostEqual(by_id["甲"]["top3Rate"], 2 / 3)
        self.assertEqual(by_id["甲"]["lineupMatchCount"], 3)
        self.assertEqual([c["name"] for c in by_id["甲"]["lineups"]], ["嫦娥", "白哥三分"])
        self.assertAlmostEqual(by_id["甲"]["lineups"][0]["usageRate"], 2 / 3)
        self.assertAlmostEqual(by_id["甲"]["lineups"][0]["averageRank"], 2.5)
        self.assertAlmostEqual(by_id["甲"]["lineups"][0]["winRate"], 0.5)
        self.assertAlmostEqual(by_id["甲"]["lineups"][0]["top3Rate"], 0.5)
        # 乙: ranks [3, 2, 5] -> win=0, top3=2/3; empty lineup ignored, only 白哥三分(2) counted -> usageRate=1.0
        self.assertEqual(by_id["乙"]["matchCount"], 3)
        self.assertEqual(by_id["乙"]["winRate"], 0)
        self.assertAlmostEqual(by_id["乙"]["top3Rate"], 2 / 3)
        self.assertEqual(by_id["乙"]["lineupMatchCount"], 2)
        self.assertEqual(len(by_id["乙"]["lineups"]), 1)
        self.assertEqual(by_id["乙"]["lineups"][0]["name"], "白哥三分")
        self.assertEqual(by_id["乙"]["lineups"][0]["matchCount"], 2)
        self.assertEqual(by_id["乙"]["lineups"][0]["usageRate"], 1.0)
        self.assertAlmostEqual(by_id["乙"]["lineups"][0]["averageRank"], 4.0)
        # 丙: ranks [4, 1, 6] -> win=1/3, top3=1/3; only 嫦娥(1) recorded
        self.assertEqual(by_id["丙"]["matchCount"], 3)
        self.assertEqual(by_id["丙"]["lineupMatchCount"], 1)
        self.assertEqual(by_id["丙"]["lineups"][0]["usageRate"], 1.0)
        # Global lineups: 嫦娥 ranks [1, 4, 1] -> avg 2.0, win 2/3, top3 2/3; 白哥三分 ranks [3, 2, 5] -> avg 10/3, win 0, top3 2/3
        self.assertEqual(index["lineupCount"], 2)
        self.assertEqual(index["lineupRecordCount"], 6)
        by_lineup = {c["name"]: c for c in index["lineups"]}
        self.assertEqual([c["name"] for c in index["lineups"]], ["嫦娥", "白哥三分"])
        self.assertAlmostEqual(by_lineup["嫦娥"]["averageRank"], 2.0)
        self.assertAlmostEqual(by_lineup["嫦娥"]["winRate"], 2 / 3)
        self.assertAlmostEqual(by_lineup["嫦娥"]["top3Rate"], 2 / 3)
        self.assertAlmostEqual(by_lineup["白哥三分"]["averageRank"], 10 / 3)
        self.assertEqual(by_lineup["白哥三分"]["winRate"], 0)
        self.assertAlmostEqual(by_lineup["白哥三分"]["top3Rate"], 2 / 3)
        # Player files also store win/top3 rates and lineups
        player_a = next(p for p in players if p["id"] == "甲")
        self.assertEqual(player_a["lineups"], by_id["甲"]["lineups"])

    @unittest.skipUnless(shutil.which("node"), "Node.js is needed to verify browser script")
    def test_browser_uses_unified_index_sorting_and_lineups(self):
        html = Path(__file__).with_name("index.html").read_text(encoding="utf-8")
        self.assertNotIn("event-filter", html)
        self.assertNotIn("平均数据", html)
        self.assertIn("使用阵容", html)
        self.assertIn("阵容数据", html)
        self.assertIn('data-sort="winRate"', html)
        self.assertIn('data-sort="top3Rate"', html)

        rows_by_sheet = {
            "风云杯": [
                HEADER_WITH_LINEUP,
                row("甲", 1, 10, "嫦娥"),
                row("乙", 2, 100, "白哥三分"),
                HEADER_WITH_LINEUP,
                row("甲", 4, 30, "嫦娥"),
                row("乙", 3, 90, ""),
            ],
            "新人杯": [
                HEADER_WITH_LINEUP,
                row("甲", 3, 200, "白哥三分"),
                row("丙", 1, 80, "玉环倒转"),
            ],
            "##散排": [HEADER_WITH_LINEUP, row("丁", 1, 900, "散排阵容")],
        }
        sheets = [SimpleNamespace(title=name, iter_rows=lambda rows=rows, **kwargs: iter(rows)) for name, rows in rows_by_sheet.items()]
        workbook = SimpleNamespace(worksheets=sheets, close=lambda: None)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with patch("process_data.openpyxl.load_workbook", return_value=workbook):
                generate(Path("unused.xlsx"), output)
            # Load the real browser code; leave its startup fetch pending so no DOM is required.
            script = r'''
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({fetch: () => new Promise(() => {})});
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), context);
assert.equal(typeof context.mergeEvents, 'undefined');
const root = JSON.parse(fs.readFileSync(path.join(process.argv[2], 'index.json'), 'utf8'));
assert.equal(root.events, undefined);
const byAvg = [...root.players].sort((a, b) => context.comparePlayers(a, b, 'averageRank')).map(p => p.id);
const byWin = [...root.players].sort((a, b) => context.comparePlayers(a, b, 'winRate')).map(p => p.id);
const byTop3 = [...root.players].sort((a, b) => context.comparePlayers(a, b, 'top3Rate')).map(p => p.id);
assert.deepEqual(byAvg, ['丙', '乙', '甲']);
assert.deepEqual(byWin, ['丙', '甲', '乙']);
assert.deepEqual(byTop3, ['丙', '乙', '甲']);
const lineupsByAvg = [...root.lineups].sort((a, b) => context.compareLineups(a, b, 'averageRank')).map(c => c.name);
const lineupsByWin = [...root.lineups].sort((a, b) => context.compareLineups(a, b, 'winRate')).map(c => c.name);
assert.deepEqual(lineupsByAvg, ['玉环倒转', '嫦娥', '白哥三分']);
assert.deepEqual(lineupsByWin, ['玉环倒转', '嫦娥', '白哥三分']);
const legacy = JSON.parse(JSON.stringify(root));
for (const player of legacy.players) delete player.averages;
context.normalizePlayers(legacy);
assert.equal(legacy.players.find(p => p.id === '甲').averages.economy, 80);
assert.throws(() => context.normalizePlayers({metrics: root.metrics, players: [{id: 'old', matchCount: 1}]}));
console.log('Unified browser sorting and lineup handling verified');
'''
            result = subprocess.run(["node", "-e", script, str(Path(__file__).with_name("app.js")), str(output)], capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
