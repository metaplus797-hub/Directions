"""
グラフデータ（ノード・エッジ）の読み込みと管理

Kotlin版 MainActivity.kt の以下の関数を Python に移植：
- loadGraphFromCsv()
- updateDestinationSpinner() の抽出ロジック
- updateMapDisplay() のフィルタリング部分（座標スケーリングはフロントエンドJS側で行う）
"""
from __future__ import annotations

import csv
import logging
from pathlib import Path
from typing import Dict, List

from schemas import Node

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent / "data"
CSV_PATH = DATA_DIR / "graph_data.csv"

# Kotlin版で "if (floor == "F8") return@mapNotNull null" としていた除外ロジック。
# データ未整備のフロアをスキップするための設定。不要になったら空集合にする。
EXCLUDED_FLOORS: set[str] = {"F8"}


class GraphService:
    """CSVから読み込んだグラフをメモリ上に保持し、各種クエリを提供するクラス"""

    def __init__(self, csv_path: Path = CSV_PATH):
        self.csv_path = csv_path
        self.graph: Dict[str, Node] = {}
        self.all_edges: List[tuple[str, str]] = []
        self.load()

    def load(self) -> None:
        """CSVファイルを読み込み、self.graph / self.all_edges を構築する"""
        graph: Dict[str, Node] = {}

        with self.csv_path.open("r", encoding="utf-8", newline="") as f:
            reader = csv.reader(f)
            header = next(reader, None)  # ヘッダー行をスキップ

            for line_no, tokens in enumerate(reader, start=2):
                try:
                    if len(tokens) < 7:
                        continue

                    floor = tokens[6].strip()
                    if floor in EXCLUDED_FLOORS:
                        continue

                    node_id = tokens[0].strip()
                    name = tokens[1].strip()
                    x = float(tokens[2].strip())
                    y = float(tokens[3].strip())
                    neighbors_str = tokens[4].strip()
                    is_destination = tokens[5].strip().upper() == "TRUE"
                    image_name = tokens[7].strip() if len(tokens) >= 8 else ""

                    neighbors: List[str] = []
                    for neighbor_id in neighbors_str.split(" "):
                        neighbor_id = neighbor_id.strip()
                        if not neighbor_id:
                            continue
                        # 数字のみ ("2") -> 現在の行のフロアIDと結合 ("F7-2")
                        # そうでない ("F8-1" など) -> そのまま使用（フロア間の接続）
                        if neighbor_id.isdigit():
                            neighbors.append(f"{floor}-{neighbor_id}")
                        else:
                            neighbors.append(neighbor_id)

                    graph[node_id] = Node(
                        id=node_id,
                        name=name,
                        x=x,
                        y=y,
                        neighbors=neighbors,
                        is_destination=is_destination,
                        floor=floor,
                        image_name=image_name,
                    )
                except (ValueError, IndexError) as e:
                    logger.error("CSV行のパースに失敗 (line %d): %s (%s)", line_no, tokens, e)
                    continue

        self.graph = graph
        self.all_edges = [
            (from_id, neighbor_id)
            for from_id, node in graph.items()
            for neighbor_id in node.neighbors
        ]
        logger.info(
            "グラフ読み込み完了: ノード数=%d, エッジ数=%d", len(graph), len(self.all_edges)
        )

    # --- クエリ用メソッド ---

    def get_floors(self) -> List[str]:
        """存在するフロア名の一覧（ソート済み）"""
        return sorted({node.floor for node in self.graph.values()})

    def get_nodes_on_floor(self, floor: str) -> Dict[str, Node]:
        return {nid: n for nid, n in self.graph.items() if n.floor == floor}

    def get_edges_on_floor(self, floor: str) -> List[tuple[str, str]]:
        node_ids = set(self.get_nodes_on_floor(floor).keys())
        return [
            (f, t) for f, t in self.all_edges if f in node_ids and t in node_ids
        ]

    def get_destinations_on_floor(self, floor: str) -> List[Node]:
        return sorted(
            (n for n in self.graph.values() if n.is_destination and n.floor == floor),
            key=lambda n: n.name,
        )

    def get_node(self, node_id: str) -> Node | None:
        return self.graph.get(node_id)

    def exists(self, node_id: str) -> bool:
        return node_id in self.graph


# アプリ全体で共有する単一インスタンス（シングルトン的に利用）
graph_service = GraphService()
