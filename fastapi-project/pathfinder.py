"""
経路探索ロジック

Kotlin版 MainActivity.kt の以下の関数を Python に移植：
- calculateWeight(nodeA, nodeB)
- dijkstra(graph, start, goal)
"""
from __future__ import annotations

import heapq
import math
from typing import Dict, List, Tuple

from schemas import Node

# 異なるフロア間を移動する際の固定ペナルティ（Kotlin版と同じく仮の値）
# ※実際の建物（階段・エレベーターの移動時間）に合わせて調整してください
FLOOR_CHANGE_PENALTY = 30.0


def calculate_weight(node_a: Node, node_b: Node) -> float:
    """2ノード間の移動コストを計算する

    同一フロア: 2D ユークリッド距離
    異なるフロア: 固定ペナルティ（階段・エレベーター利用とみなす）
    """
    if node_a.floor == node_b.floor:
        return math.hypot(node_b.x - node_a.x, node_b.y - node_a.y)
    return FLOOR_CHANGE_PENALTY


def dijkstra(
    graph: Dict[str, Node], start: str, goal: str
) -> Tuple[List[str], float]:
    """ダイクストラ法で start から goal までの最短経路を求める

    Returns:
        (経路のノードIDリスト, 総距離)。経路が見つからない場合は ([], 0.0)
    """
    if start not in graph or goal not in graph:
        return [], 0.0

    dist: Dict[str, float] = {start: 0.0}
    prev: Dict[str, str | None] = {}
    visited: set[str] = set()

    # (距離, ノードID) のヒープ
    pq: List[Tuple[float, str]] = [(0.0, start)]

    while pq:
        current_dist, current_id = heapq.heappop(pq)

        if current_id in visited:
            continue
        visited.add(current_id)

        if current_id == goal:
            break

        current_node = graph.get(current_id)
        if current_node is None:
            continue

        for neighbor_id in current_node.neighbors:
            neighbor_node = graph.get(neighbor_id)
            if neighbor_node is None:
                continue

            weight = calculate_weight(current_node, neighbor_node)
            new_dist = current_dist + weight

            if new_dist < dist.get(neighbor_id, math.inf):
                dist[neighbor_id] = new_dist
                prev[neighbor_id] = current_id
                heapq.heappush(pq, (new_dist, neighbor_id))

    # 経路の復元
    path: List[str] = []
    node: str | None = goal
    while node is not None:
        path.append(node)
        node = prev.get(node)
    path.reverse()

    if path and path[0] == start:
        return path, dist.get(goal, 0.0)
    return [], 0.0
