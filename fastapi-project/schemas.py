"""
データモデル定義

Kotlin版の `data class Node` を Pydantic モデルとして書き換え。
- node_id: str
- 距離(distance) / 座標(x, y): float
- neighbors / path: List[str]
"""
from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel, Field


class Node(BaseModel):
    """1つのノード（NFCタグ設置ポイント）を表すモデル"""

    id: str
    name: str
    x: float
    y: float
    neighbors: List[str] = Field(default_factory=list)
    is_destination: bool
    floor: str
    image_name: str = ""


class NodeOut(BaseModel):
    """フロア表示用にクライアントへ返すノード情報"""

    id: str
    name: str
    x: float
    y: float
    is_destination: bool
    floor: str
    image_name: str = ""
    label: str = ""  # 目的地のみ表示名、それ以外は空文字（Kotlin版 nodeLabels 相当）


Edge = tuple  # (from_id: str, to_id: str)


class FloorGraphResponse(BaseModel):
    """指定フロアの地図描画に必要な情報一式"""

    floor: str
    nodes: List[NodeOut]
    edges: List[List[str]]  # [[from, to], ...]
    map_image: Optional[str] = None  # 例: "map_f7.png"


class DestinationOut(BaseModel):
    id: str
    name: str
    floor: str


class RouteRequest(BaseModel):
    start: str
    goal: str


class RouteResponse(BaseModel):
    found: bool
    path: List[str] = Field(default_factory=list)  # ノードIDの経路
    path_names: List[str] = Field(default_factory=list)  # 表示名の経路
    distance: float = 0.0
    floors: List[str] = Field(default_factory=list)  # 経路が通るフロア一覧
    edges_by_floor: dict[str, List[List[str]]] = Field(default_factory=dict)
    message: Optional[str] = None
