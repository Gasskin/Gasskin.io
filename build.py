#!/usr/bin/env python3
"""
Parse data.xml：蜂窝地图。单格约为原先 5 倍（HEX_R）。
格数 = 3 * ceil(成员数 / 全局最少成员数)，即最少成员数国占 3 格为基本单位，其余按倍数向上取整再乘 3。
各国区域连通；按序生长，整体拼成一块连通「地形」。
Run: python build.py
"""
from __future__ import annotations

import hashlib
import json
import math
import random
import shutil
from collections import deque
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
DATA_XML = ROOT / "data.xml"
DOCS = ROOT / "docs"
STATIC = ROOT / "static"

MAP_W = 1000.0
MAP_H = 620.0
SQRT3 = math.sqrt(3.0)

HEX_R = 40.0
MARGIN = 2.0

AXIAL_NEI = ((1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1))


def cell_center(q: int, r: int, R: float, ox: float, oy: float) -> tuple[float, float]:
    x = R * SQRT3 * (q + r * 0.5) + ox
    y = R * 1.5 * r + oy
    return (x, y)


def axial_neighbors(c: tuple[int, int]) -> list[tuple[int, int]]:
    q, r = c
    return [(q + dq, r + dr) for dq, dr in AXIAL_NEI]


def rect_hex_cells(R: float, margin: float) -> list[tuple[int, int]]:
    dq = R * SQRT3
    dr = R * 1.5
    q_span = int(MAP_W / dq) + 8
    r_span = int(MAP_H / dr) + 8
    out: list[tuple[int, int]] = []
    for q in range(-q_span, q_span + 1):
        for r in range(-r_span, r_span + 1):
            x = R * SQRT3 * (q + r * 0.5)
            y = R * 1.5 * r
            if margin <= x <= MAP_W - margin and margin <= y <= MAP_H - margin:
                out.append((q, r))
    return out


def center_grid_origin(cells: list[tuple[int, int]], R: float) -> tuple[float, float]:
    xs = [R * SQRT3 * (q + r * 0.5) for q, r in cells]
    ys = [R * 1.5 * r for q, r in cells]
    cx = (min(xs) + max(xs)) * 0.5
    cy = (min(ys) + max(ys)) * 0.5
    return (MAP_W * 0.5 - cx, MAP_H * 0.5 - cy)


def tile_quotas(member_counts: list[int]) -> list[int]:
    """最少成员数国 = 3 格；其余 = 3 * ceil(成员数 / 最少成员数)。"""
    w_min = min(member_counts)
    if w_min < 1:
        raise SystemExit("成员数无效")
    base = 3
    return [base * int(math.ceil(w / float(w_min))) for w in member_counts]


def bfs_connected_subset(pool: set[tuple[int, int]], T: int, start: tuple[int, int]) -> list[tuple[int, int]] | None:
    """从 start 在 pool 内 BFS，取恰好 T 格（连通）。"""
    if start not in pool or T > len(pool):
        return None
    q = deque([start])
    seen = {start}
    order = [start]
    while q and len(order) < T:
        c = q.popleft()
        for nb in axial_neighbors(c):
            if nb in pool and nb not in seen:
                seen.add(nb)
                order.append(nb)
                q.append(nb)
                if len(order) >= T:
                    break
    if len(order) < T:
        return None
    return order[:T]


def grow_region_bfs(
    available: set[tuple[int, int]],
    size: int,
    seed: tuple[int, int],
    rng: random.Random,
) -> set[tuple[int, int]] | None:
    """在 available 的副本上从 seed BFS 长出 size 格连通区域（会修改传入的 set）。"""
    if size < 1:
        return set()
    if seed not in available:
        return None
    if size == 1:
        available.remove(seed)
        return {seed}
    region = {seed}
    available.remove(seed)
    frontier = deque([seed])
    while len(region) < size:
        if not frontier:
            return None
        c = frontier.popleft()
        nbrs = [x for x in axial_neighbors(c) if x in available]
        rng.shuffle(nbrs)
        added = False
        for nb in nbrs:
            available.remove(nb)
            region.add(nb)
            frontier.append(nb)
            added = True
            if len(region) >= size:
                break
        if not added:
            continue
    return region


def partition_connected(
    tiles: list[int],
    pool: set[tuple[int, int]],
    rng: random.Random,
    max_seed_tries: int = 80,
) -> dict[tuple[int, int], int] | None:
    """
    按 tiles 从大到小依次生长各国；每国连通；k>0 时该国首格与已占区域相邻。
    """
    n = len(tiles)
    T = sum(tiles)
    if len(pool) < T:
        return None

    q_mean = sum(q for q, r in pool) / len(pool)
    r_mean = sum(r for q, r in pool) / len(pool)
    start = min(pool, key=lambda c: (c[0] - q_mean) ** 2 + (c[1] - r_mean) ** 2)

    subset_list = bfs_connected_subset(pool, T, start)
    if subset_list is None:
        return None
    working = set(subset_list)
    empty = set(subset_list)
    owner: dict[tuple[int, int], int] = {}
    assigned_all: set[tuple[int, int]] = set()

    order_k = sorted(range(n), key=lambda i: (-tiles[i], i))

    for k in order_k:
        need = tiles[k]
        seeds: list[tuple[int, int]] = []
        if not assigned_all:
            seeds = [min(empty, key=lambda c: (c[0] - q_mean) ** 2 + (c[1] - r_mean) ** 2)]
        else:
            for c in empty:
                if any(nb in assigned_all for nb in axial_neighbors(c)):
                    seeds.append(c)
            rng.shuffle(seeds)

        grown: set[tuple[int, int]] | None = None
        for seed in seeds[:max_seed_tries]:
            if seed not in empty:
                continue
            trial = set(empty)
            grown = grow_region_bfs(trial, need, seed, rng)
            if grown is None:
                continue
            for c in grown:
                owner[c] = k
                empty.discard(c)
            assigned_all.update(grown)
            break

        if grown is None:
            return None

    if empty:
        return None
    return owner


def try_partition_until_ok(
    tiles: list[int],
    pool: set[tuple[int, int]],
    base_seed: int,
    outer_attempts: int = 400,
) -> dict[tuple[int, int], int]:
    for att in range(outer_attempts):
        rng = random.Random(base_seed ^ (att * 0x9E3779B97F4A7C15))
        o = partition_connected(tiles, pool, rng)
        if o is not None:
            return o
    raise SystemExit(
        "无法在矩形蜂窝内按格数与连通约束划分国土，可略减小 HEX_R 或略减小 MARGIN 后重试。"
    )


def load_kingdoms(path: Path) -> list[dict]:
    tree = ET.parse(path)
    root = tree.getroot()
    kingdoms: list[dict] = []
    for country in root.findall("Country"):
        name = (country.get("name") or "").strip() or "未命名势力"
        members = []
        for m in country.findall("Member"):
            mn = (m.get("name") or "").strip()
            if mn:
                members.append(mn)
        kingdoms.append({"name": name, "members": members})
    return kingdoms


_GOLDEN_ANGLE_DEG = 360.0 / (1.0 + (1.0 + 5.0**0.5) / 2.0)


def _kingdom_color_seed(names_in_order: list[str]) -> int:
    blob = "\n".join(names_in_order).encode("utf-8")
    return int.from_bytes(hashlib.sha256(blob).digest()[:8], "big") % (2**32)


def kingdom_color_slots(n: int, seed: int) -> list[tuple[float, float, float]]:
    if n <= 0:
        return []
    rng = random.Random(seed)
    base = rng.uniform(0.0, 360.0)
    slots: list[tuple[float, float, float]] = []
    for i in range(n):
        h = (base + i * _GOLDEN_ANGLE_DEG) % 360.0
        s = 44.0 + (i % 5) * 2.35
        l = 36.0 + (i % 4) * 2.65
        slots.append((h, s, l))
    rng.shuffle(slots)
    return slots


def build() -> None:
    if not DATA_XML.is_file():
        raise SystemExit(f"Missing {DATA_XML}")

    kingdoms = load_kingdoms(DATA_XML)
    if not kingdoms:
        raise SystemExit("No <Country> entries in data.xml")

    n = len(kingdoms)
    names = [k["name"] for k in kingdoms]
    weights = [max(1, len(k["members"])) for k in kingdoms]
    tiles = tile_quotas(weights)
    T = sum(tiles)

    pool_list = rect_hex_cells(HEX_R, MARGIN)
    pool_set = set(pool_list)
    if len(pool_set) < T:
        raise SystemExit(
            f"画布内蜂窝池 {len(pool_set)} 格 < 所需总格数 {T}，请减小 HEX_R 或 MARGIN。"
        )

    base_seed = _kingdom_color_seed(names)
    owner = try_partition_until_ok(tiles, pool_set, base_seed)

    used_cells = sorted(owner.keys(), key=lambda c: (c[1], c[0]))
    ox, oy = center_grid_origin(used_cells, HEX_R)

    hex_cells: list[list[int]] = [[q, r, owner[(q, r)]] for q, r in used_cells]

    acc_x = [0.0] * n
    acc_y = [0.0] * n
    cnt = [0] * n
    for q, r, k in hex_cells:
        px, py = cell_center(q, r, HEX_R, ox, oy)
        acc_x[k] += px
        acc_y[k] += py
        cnt[k] += 1

    color_seed = _kingdom_color_seed(names)
    color_slots = kingdom_color_slots(n, color_seed)

    out_kingdoms = []
    for j, k in enumerate(kingdoms):
        h, s, l = color_slots[j]
        if cnt[j] > 0:
            lx = acc_x[j] / cnt[j]
            ly = acc_y[j] / cnt[j]
        else:
            lx, ly = MAP_W * 0.5, MAP_H * 0.5
        out_kingdoms.append(
            {
                "name": k["name"],
                "members": k["members"],
                "memberCount": weights[j],
                "label": [round(lx, 2), round(ly, 2)],
                "hexCount": cnt[j],
                "targetHex": tiles[j],
                "color": {
                    "h": round(h, 2),
                    "s": round(s, 1),
                    "l": round(l, 1),
                },
            }
        )

    payload = {
        "mapVersion": 2,
        "mapShape": "connected_hex",
        "mapSize": {"w": MAP_W, "h": MAP_H},
        "hex": {"R": HEX_R, "origin": [round(ox, 3), round(oy, 3)]},
        "hexCells": hex_cells,
        "kingdoms": out_kingdoms,
    }

    DOCS.mkdir(parents=True, exist_ok=True)
    (DOCS / ".nojekyll").touch(exist_ok=True)
    (DOCS / "data.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    if STATIC.is_dir():
        for p in STATIC.iterdir():
            if p.is_file():
                shutil.copy2(p, DOCS / p.name)

    print(
        f"Wrote {DOCS / 'data.json'} (总格 {T}, 各国格数 {tiles}, {n} 国, 实际输出 {len(hex_cells)} 格)."
    )


if __name__ == "__main__":
    build()
