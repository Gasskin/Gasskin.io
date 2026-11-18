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


def row(name, rank, value):
    return [name, rank, value, value, value, value, value]


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
            self.assertEqual({event["name"] for event in index["events"]}, {"风云杯", "杯##决赛"})
            self.assertEqual(len(list((output / "events").iterdir())), 2)
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
        cases = ([row("甲", 1, 10)], [["ID", "错误"]], [HEADER], [HEADER, HEADER], [HEADER, row(" ", 1, 10)])
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
            with patch("process_data.openpyxl.load_workbook", return_value=workbook):
                index = generate(Path("unused.xlsx"), output)
            self.assertFalse(stale.exists())
            self.assertEqual(json.loads((output / "index.json").read_text(encoding="utf-8")), index)
            self.assertEqual(len(list((output / "players").glob("*.json"))), 2)
            for entry in index["players"]:
                player = json.loads((output / entry["file"]).read_text(encoding="utf-8"))
                self.assertEqual(player["id"], entry["id"])
                self.assertEqual(len(player["matches"]), 1)
                self.assertEqual(entry["totals"], player["totals"])

    def test_json_failure_keeps_original_file(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "index.json"
            target.write_text("previous")
            with self.assertRaises(ValueError):
                write_json(target, {"invalid": float("nan")})
            self.assertEqual(target.read_text(), "previous")
            self.assertEqual(list(Path(directory).iterdir()), [target])

    def test_events_keep_their_players_rankings_and_averages_separate(self):
        rows_by_sheet = {
            "风云杯": [HEADER, row("甲", 1, 10), row("乙", 2, 100), HEADER, row("甲", 1, 30)],
            "新人杯": [HEADER, row("甲", 3, 200), row("丙", 1, 80)],
            "空白赛事": [],
        }
        sheets = [SimpleNamespace(title=name, iter_rows=lambda rows=rows, **kwargs: iter(rows)) for name, rows in rows_by_sheet.items()]
        workbook = SimpleNamespace(worksheets=sheets, close=lambda: None)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with patch("process_data.openpyxl.load_workbook", return_value=workbook):
                all_events = generate(Path("unused.xlsx"), output)
            self.assertEqual(all_events["matchCount"], 3)
            self.assertEqual(all_events["recordCount"], 5)
            events = {event["name"]: event for event in all_events["events"]}
            self.assertEqual(set(events), {"风云杯", "新人杯"})
            stats = {}
            for name, entry in events.items():
                self.assertRegex(entry["file"], r"^events/[0-9a-f]{64}/index\.json$")
                path = output / entry["file"]
                summary = json.loads(path.read_text(encoding="utf-8"))
                stats[name] = summary
                for player_entry in summary["players"]:
                    player = json.loads((path.parent / player_entry["file"]).read_text(encoding="utf-8"))
                    self.assertTrue(all(match["sheet"] == name for match in player["matches"]))
                    if player["id"] == "甲":
                        self.assertEqual(player["matchCount"], 2 if name == "风云杯" else 1)
                        self.assertEqual(player["averages"]["economy"], 20 if name == "风云杯" else 200)
            self.assertEqual([p["id"] for p in stats["风云杯"]["players"]], ["甲", "乙"])
            self.assertEqual([p["id"] for p in stats["新人杯"]["players"]], ["丙", "甲"])
            self.assertEqual(stats["风云杯"]["overall"]["economy"], 60)
            self.assertEqual(stats["新人杯"]["overall"]["economy"], 140)
            self.assertAlmostEqual(all_events["overall"]["economy"], (80 + 100 + 80) / 3)
            self.assertEqual(stats["风云杯"]["metrics"][0]["max"], 100)
            self.assertEqual(stats["新人杯"]["metrics"][0]["max"], 200)
            combined_entry = next(p for p in all_events["players"] if p["id"] == "甲")
            combined = json.loads((output / combined_entry["file"]).read_text(encoding="utf-8"))
            self.assertEqual(combined["averages"]["economy"], 80)  # Weight all 3 matches, not the 2 event means.

    def test_later_event_error_preserves_all_existing_datasets(self):
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

    @unittest.skipUnless(shutil.which("node"), "Node.js is needed to verify browser aggregation")
    def test_browser_merges_selected_events_by_match_count(self):
        rows_by_sheet = {
            "风云杯": [HEADER, row("甲", 1, 10), row("乙", 2, 100), HEADER, row("甲", 1, 30)],
            "新人杯": [HEADER, row("甲", 3, 200), row("丙", 1, 80)],
            "高手杯": [HEADER, row("丁", 1, 900)],
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
const root = JSON.parse(fs.readFileSync(path.join(process.argv[2], 'index.json'), 'utf8'));
const events = root.events.map(event => JSON.parse(fs.readFileSync(path.join(process.argv[2], event.file), 'utf8')));
const first = events.find(event => event.eventName === '风云杯');
const second = events.find(event => event.eventName === '新人杯');
const merged = context.mergeEvents([first, second]);
assert.equal(merged.players.map(player => player.id).join(','), '丙,甲,乙');
const player = merged.players.find(player => player.id === '甲');
assert.equal(player.matchCount, 3);
assert.equal(player.averages.economy, 80);
assert.equal(player.averageRank, 5 / 3);
assert.equal(merged.players.some(player => player.id === '丁'), false);
assert.equal(merged.overall.economy, 260 / 3);
assert.equal(merged.metrics[0].max, 100);
assert.equal(context.mergeEvents([first]).overall.economy, 60);
const all = context.mergeEvents(events);
assert.equal(all.players.length, root.playerCount);
for (const key of Object.keys(root.overall)) assert.equal(all.overall[key], root.overall[key]);
for (const entry of root.players) {
  const actual = all.players.find(player => player.id === entry.id);
  assert.equal(actual.matchCount, entry.matchCount);
  assert.equal(actual.averageRank, entry.averageRank);
}
assert.throws(() => context.mergeEvents([{metrics: first.metrics, players: [{id:'old', matchCount:1}]}]));
console.log('Multi-event weighting, exclusion, ordering, scales and all-event equivalence verified');
'''
            result = subprocess.run(["node", "-e", script, str(Path(__file__).with_name("app.js")), str(output)], capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
