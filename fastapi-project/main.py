"""
FastAPI アプリケーション本体

Kotlin版 MainActivity.kt の以下のUIロジックをAPIエンドポイントとして書き換え：
- updateDestinationSpinner(floor)  -> GET /api/floors/{floor}/destinations
- updateMapDisplay(floor)          -> GET /api/floors/{floor}/graph
- updateRoute()                    -> POST /api/route
- handleIntent() のNFC読み取り検証 -> GET /api/nodes/{node_id}
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from data import graph_service
from schemas import (
    DestinationOut,
    FloorGraphResponse,
    Node,
    NodeOut,
    RouteRequest,
    RouteResponse,
)
from pathfinder import dijkstra

app = FastAPI(title="NFC Indoor Navigation API", version="1.0.0")

# フロントエンド(HTML/CSS/JS)を別オリジンから開発する場合に備えてCORSを許可
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 本番運用時はフロントのオリジンに限定してください
    allow_methods=["*"],
    allow_headers=["*"],
)


def _node_to_out(node: Node) -> NodeOut:
    return NodeOut(
        id=node.id,
        name=node.name,
        x=node.x,
        y=node.y,
        is_destination=node.is_destination,
        floor=node.floor,
        image_name=node.image_name,
        # Kotlin版 nodeLabels: 目的地のみラベル表示、それ以外は空文字
        label=node.name if node.is_destination else "",
    )


@app.get("/api/floors", response_model=list[str])
def get_floors():
    """フロア一覧を取得する（floorSpinner 相当）"""
    return graph_service.get_floors()


@app.get("/api/nodes", response_model=list[NodeOut])
def list_all_nodes():
    """全ノードの一覧を取得する（NFCシミュレート用セレクトボックスなどに利用）"""
    return [_node_to_out(n) for n in graph_service.graph.values()]


@app.get("/api/floors/{floor}/graph", response_model=FloorGraphResponse)
def get_floor_graph(floor: str):
    """指定フロアのノード・エッジ一式を取得する（updateMapDisplay 相当）

    座標(x, y)は生の論理座標のまま返す。画面へのスケーリング・オフセット計算は
    フロントエンドJS側（キャンバスの実サイズに応じて）で行う。
    """
    nodes = graph_service.get_nodes_on_floor(floor)
    if not nodes:
        raise HTTPException(status_code=404, detail=f"フロア '{floor}' が見つかりません")

    edges = graph_service.get_edges_on_floor(floor)

    return FloorGraphResponse(
        floor=floor,
        nodes=[_node_to_out(n) for n in nodes.values()],
        edges=[[f, t] for f, t in edges],
        map_image=f"map_{floor.lower()}.png",
    )


@app.get("/api/floors/{floor}/destinations", response_model=list[DestinationOut])
def get_destinations(floor: str):
    """指定フロアの目的地一覧を取得する（goalSpinner 相当）"""
    destinations = graph_service.get_destinations_on_floor(floor)
    return [DestinationOut(id=n.id, name=n.name, floor=n.floor) for n in destinations]


@app.get("/api/nodes/{node_id}", response_model=NodeOut)
def get_node(node_id: str):
    """ノードIDから詳細情報を取得する（NFC読み取り結果の検証に利用）"""
    node = graph_service.get_node(node_id)
    if node is None:
        raise HTTPException(status_code=404, detail=f"ノード '{node_id}' は未登録です")
    return _node_to_out(node)


@app.post("/api/route", response_model=RouteResponse)
def get_route(req: RouteRequest):
    """現在地から目的地までの最短経路を計算する（updateRoute 相当）"""
    if not graph_service.exists(req.start):
        raise HTTPException(status_code=404, detail=f"現在地 '{req.start}' は未登録です")
    if not graph_service.exists(req.goal):
        raise HTTPException(status_code=404, detail=f"目的地 '{req.goal}' は未登録です")

    if req.start == req.goal:
        return RouteResponse(found=False, message="現在地と目的地が同じです")

    path, distance = dijkstra(graph_service.graph, req.start, req.goal)

    if not path:
        return RouteResponse(found=False, message="経路が見つかりませんでした")

    path_names = [graph_service.graph[nid].name for nid in path]
    floors_in_path = sorted({graph_service.graph[nid].floor for nid in path})

    # フロアごとに経路上のエッジを分類（Kotlin版: pathEdges.filter { 現在のフロアの線だけ描画 }）
    edges_by_floor: dict[str, list[list[str]]] = {f: [] for f in floors_in_path}
    for from_id, to_id in zip(path, path[1:]):
        from_floor = graph_service.graph[from_id].floor
        to_floor = graph_service.graph[to_id].floor
        if from_floor == to_floor:
            edges_by_floor[from_floor].append([from_id, to_id])

    return RouteResponse(
        found=True,
        path=path,
        path_names=path_names,
        distance=round(distance, 2),
        floors=floors_in_path,
        edges_by_floor=edges_by_floor,
    )


# フロントエンド(HTML/CSS/JS/画像)の静的配信
# 開発時はこのFastAPIサーバー1つで frontend/ 一式も配信できるようにする。
# 本番では nginx 等で frontend を別配信し、API_BASE を切り替えても良い。
import pathlib

# main.py が fastapi-project/ 直下にある想定:
#   guide_group/
#   ├── fastapi-project/main.py  <- このファイル
#   └── frontend/                <- ここを参照
_frontend_dir = pathlib.Path(__file__).resolve().parent.parent / "frontend"
if _frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(_frontend_dir), html=True), name="frontend")
