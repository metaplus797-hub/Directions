"""地点データ（data/graph_data.csv）の公開前チェック

xfail が付いたテストは、既知の問題があっていまは失敗するもの。
データを直すと XPASS と表示されるので、そのときは xfail を外す。
"""
import csv
from collections import Counter, deque

import pytest

from data import CSV_PATH, EXCLUDED_FLOORS, graph_service


def test_csv_ids_are_unique():
    with CSV_PATH.open(encoding="utf-8", newline="") as f:
        ids = [row["id"].strip() for row in csv.DictReader(f) if row.get("id", "").strip()]
    duplicates = [i for i, count in Counter(ids).items() if count > 1]
    assert duplicates == []


def test_neighbors_point_to_existing_nodes():
    graph = graph_service.graph
    missing = [
        (node_id, neighbor)
        for node_id, node in graph.items()
        for neighbor in node.neighbors
        # 除外中のフロア（F8）への接続は読み込み時に無視されるので問題なし
        if neighbor not in graph and neighbor.split("-")[0] not in EXCLUDED_FLOORS
    ]
    assert missing == []


@pytest.mark.xfail(reason="屋外(out)の地点名が文字化けしている（out-1〜4, out-11）。元データから名前を直す必要がある")
def test_names_are_not_garbled():
    garbled = sorted(n.id for n in graph_service.graph.values() if "�" in n.name)
    assert garbled == []


@pytest.mark.xfail(
    reason="屋外の通路が一方通行で、建物から out-3〜out-11 に行けない。"
    "編集画面で追加された行 'test' もどこからもつながっていない"
)
def test_every_destination_is_reachable_from_elevator():
    graph = graph_service.graph
    start = "F7-1"  # EV7
    seen = {start}
    queue = deque([start])
    while queue:
        for neighbor in graph[queue.popleft()].neighbors:
            if neighbor in graph and neighbor not in seen:
                seen.add(neighbor)
                queue.append(neighbor)

    unreachable = sorted(n.id for n in graph.values() if n.is_destination and n.id not in seen)
    assert unreachable == []
