"""
FastAPI アプリケーション本体

Kotlin版 MainActivity.kt の以下のUIロジックをAPIエンドポイントとして書き換え：
- updateDestinationSpinner(floor)  -> GET /api/floors/{floor}/destinations
- updateMapDisplay(floor)          -> GET /api/floors/{floor}/graph
- updateRoute()                    -> POST /api/route
- handleIntent() のNFC読み取り検証 -> GET /api/nodes/{node_id}
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles

from data import graph_service
from schemas import (
    CsvNodeRecord,
    DestinationOut,
    FloorGraphResponse,
    Node,
    NodeOut,
    RouteRequest,
    RouteResponse,
)
from pathfinder import dijkstra

app = FastAPI(title="NFC Indoor Navigation API", version="1.0.0")

# Vercel では Root Directory (fastapi-project/) の外のファイルは配置されないため、
# 画面一式も fastapi-project/ の中に置く
FRONTEND_DIR = Path(__file__).resolve().parent / "frontend"
IMAGE_DIR = FRONTEND_DIR / "static" / "images"
FLOOR_META_PATH = Path(__file__).resolve().parent / "data" / "floor_map_meta.json"


def _read_floor_meta() -> dict:
    if not FLOOR_META_PATH.exists():
        return {}
    try:
        return json.loads(FLOOR_META_PATH.read_text(encoding="utf-8")) or {}
    except Exception:
        return {}


def _write_floor_meta(data: dict) -> None:
    FLOOR_META_PATH.parent.mkdir(parents=True, exist_ok=True)
    FLOOR_META_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

# CORSMiddleware は外した。画面とAPIを同じオリジンから配信するので不要で、
# アプリ全体にミドルウェアがあると Vercel が静的ファイルをCDNに載せなくなるため。


def is_read_only() -> bool:
    """公開環境なら True。編集APIを止めるのに使う

    Vercel は実行時に VERCEL=1 を設定する。トンネル経由の公開テストなど
    それ以外の公開環境では DIRECTIONS_READ_ONLY=1 を指定して起動する。
    """
    return os.getenv("VERCEL") == "1" or os.getenv("DIRECTIONS_READ_ONLY") == "1"


def require_writable() -> None:
    """公開環境ではファイルを書き換えるAPIを 403 で拒否する

    編集APIにはログインがなく、公開すると誰でもデータを書き換えられてしまう。
    また Vercel の実行環境ではファイルを保存できない。
    """
    if is_read_only():
        raise HTTPException(status_code=403, detail="公開環境ではデータを編集できません")


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


@app.get("/api/editor/nodes", response_model=list[CsvNodeRecord])
def get_editor_nodes():
    """CSV編集画面用にノード一覧を取得する"""
    return [CsvNodeRecord(**row) for row in graph_service.get_csv_rows()]


@app.post("/api/editor/nodes", dependencies=[Depends(require_writable)])
def save_editor_nodes(rows: list[CsvNodeRecord]):
    """CSV編集画面で編集したノード一覧をファイルへ保存する"""
    graph_service.save_csv_rows([row.model_dump() for row in rows])
    graph_service.load()
    return {"success": True, "count": len(rows), "path": str(graph_service.csv_path)}


@app.get("/api/floors/{floor}/meta")
def get_floor_meta(floor: str):
    """フロアに紐づく画像名と表示名を取得する"""
    meta = _read_floor_meta().get(floor, {})
    return {
        "floor": floor,
        "label": meta.get("label") or floor,
        "map_image": meta.get("map_image") or f"map_{floor.lower()}.png",
    }


@app.post("/api/floors/{floor}/meta", dependencies=[Depends(require_writable)])
def save_floor_meta(floor: str, payload: dict):
    """フロアの画像メタ情報を保存する"""
    meta = _read_floor_meta()
    current = meta.get(floor, {})
    current.update(payload)
    meta[floor] = current
    _write_floor_meta(meta)
    return {"floor": floor, "meta": current}


@app.post("/api/floors/{floor}/map-image", dependencies=[Depends(require_writable)])
async def upload_map_image(
    floor: str,
    file: UploadFile = File(...),
    label: str = Form(""),
):
    """フロア用の背景画像をアップロードして保存する"""
    if not file.filename:
        raise HTTPException(status_code=400, detail="ファイル名がありません")

    suffix = Path(file.filename).suffix.lower() or ".png"
    target_name = f"map_{floor.lower()}{suffix}"
    target_path = IMAGE_DIR / target_name
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)

    content = await file.read()
    target_path.write_bytes(content)

    meta = _read_floor_meta()
    meta[floor] = {
        "label": label or floor,
        "map_image": target_name,
    }
    _write_floor_meta(meta)

    return {
        "floor": floor,
        "label": label or floor,
        "map_image": target_name,
        "path": str(target_path),
    }


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
# ローカルでも Vercel でも同じコードで動く。Vercel はビルド時にこのマウントを検出し、
# frontend/ のファイルをCDNから配信する（/api/* はこれより前に定義しているので優先される）。
# 配置:
#   fastapi-project/
#   ├── main.py      <- このファイル
#   └── frontend/    <- ここを参照
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
