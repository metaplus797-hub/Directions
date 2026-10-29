"""
グラフデータ（ノード・エッジ）の読み込みと管理

Kotlin版 MainActivity.kt の以下の関数を Python に移植：
- loadGraphFromJson()
- updateDestinationSpinner() の抽出ロジック
- updateMapDisplay() のフィルタリング部分（座標スケーリングはフロントエンドJS側で行う）
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Dict, List

from schemas import Node

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent / "data"
JSON_PATH = DATA_DIR / "graph_data.json"

# Kotlin版で "if (floor == "F8") return@mapNotNull null" としていた除外ロジック。
# データ未整備のフロアをスキップするための設定。不要になったら空集合にする。
EXCLUDED_FLOORS: set[str] = {"F8"}


class GraphService:
    """JSONから読み込んだグラフをメモリ上に保持し、各種クエリを提供するクラス"""

    def __init__(self, json_path: Path = JSON_PATH):
        self.json_path = json_path
        self.graph: Dict[str, Node] = {}
        self.all_edges: List[tuple[str, str]] = []
        self.load()

    def load(self) -> None:
        """JSONファイルを読み込み、self.graph / self.all_edges を構築する"""
        graph: Dict[str, Node] = {}

        with self.json_path.open("r", encoding="utf-8") as f:
            rows = json.load(f)
        if not isinstance(rows, list):
            raise ValueError(f"ノードデータはJSON配列である必要があります: {self.json_path}")

        for index, row in enumerate(rows, start=1):
            if not isinstance(row, dict):
                raise ValueError(f"JSONの{index}件目がオブジェクトではありません: {self.json_path}")

            floor = str(row.get("Floor") or "").strip()
            if floor in EXCLUDED_FLOORS:
                continue

            node_id = str(row.get("id") or "").strip()
            neighbors_value = row.get("adjacent_point") or []
            if isinstance(neighbors_value, str):
                neighbor_ids = neighbors_value.split()
            elif isinstance(neighbors_value, list):
                neighbor_ids = neighbors_value
            else:
                raise ValueError(f"JSONの{index}件目のadjacent_pointは文字列または配列が必要です")

            neighbors: List[str] = []
            for value in neighbor_ids:
                neighbor_id = str(value).strip()
                if not neighbor_id:
                    continue
                # 数字のみ ("2") -> 現在の行のフロアIDと結合 ("F7-2")
                # そうでない ("F8-1" など) -> そのまま使用（フロア間の接続）
                neighbors.append(f"{floor}-{neighbor_id}" if neighbor_id.isdigit() else neighbor_id)

            graph[node_id] = Node(
                id=node_id,
                name=str(row.get("name") or "").strip(),
                x=float(row.get("x") or 0),
                y=float(row.get("y") or 0),
                neighbors=neighbors,
                is_destination=row.get("is_destination", False) is True
                or str(row.get("is_destination", "")).strip().upper() == "TRUE",
                floor=floor,
                image_name=str(row.get("imageName") or "").strip(),
            )

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

    def get_editor_rows(self) -> List[dict]:
        """JSONノードデータを編集画面用の行形式で返す"""
        with self.json_path.open("r", encoding="utf-8") as f:
            rows = json.load(f)
        return [
            {
                "id": str(row.get("id") or ""),
                "name": str(row.get("name") or ""),
                "x": float(row.get("x") or 0),
                "y": float(row.get("y") or 0),
                "adjacent_point": " ".join(row.get("adjacent_point", []))
                if isinstance(row.get("adjacent_point"), list)
                else str(row.get("adjacent_point") or ""),
                "is_destination": row.get("is_destination") is True
                or str(row.get("is_destination", "")).strip().upper() == "TRUE",
                "Floor": str(row.get("Floor") or ""),
                "imageName": str(row.get("imageName") or ""),
            }
            for row in rows
        ]

    def save_editor_rows(self, rows: List[dict]) -> None:
        """編集画面の行データを型付きJSONとして保存する"""
        normalized_rows = []
        for item in rows:
            if hasattr(item, "model_dump"):
                item = item.model_dump()
            adjacent_point = item.get("adjacent_point") or ""
            if isinstance(adjacent_point, list):
                neighbors = [str(value).strip() for value in adjacent_point if str(value).strip()]
            else:
                neighbors = str(adjacent_point).split()

            destination = item.get("is_destination", False)
            normalized_rows.append(
                {
                    "id": str(item.get("id") or "").strip(),
                    "name": str(item.get("name") or "").strip(),
                    "x": float(item.get("x") or 0),
                    "y": float(item.get("y") or 0),
                    "adjacent_point": neighbors,
                    "is_destination": destination is True
                    or str(destination).strip().upper() == "TRUE",
                    "Floor": str(item.get("Floor") or "").strip(),
                    "imageName": str(item.get("imageName") or "").strip(),
                }
            )

        self.json_path.write_text(
            json.dumps(normalized_rows, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

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
