import json
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

    def test_json_failure_keeps_original_file(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "index.json"
            target.write_text("previous")
            with self.assertRaises(ValueError):
                write_json(target, {"invalid": float("nan")})
            self.assertEqual(target.read_text(), "previous")
            self.assertEqual(list(Path(directory).iterdir()), [target])


if __name__ == "__main__":
    unittest.main()
