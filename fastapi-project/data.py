# ノードとエッジのデータ
# データが集まり次第このファイルを書き換える

# NODES: {node_id: {"id": int, "name": str, "photo": str}}
NODES: dict[int, dict] = {
    1: {"id": 1, "name": "入口",   "photo": "https://example.com/photos/1.jpg"},
    2: {"id": 2, "name": "広場",   "photo": "https://example.com/photos/2.jpg"},
    3: {"id": 3, "name": "展望台", "photo": "https://example.com/photos/3.jpg"},
    4: {"id": 4, "name": "売店",   "photo": "https://example.com/photos/4.jpg"},
    5: {"id": 5, "name": "出口",   "photo": "https://example.com/photos/5.jpg"},
}

# EDGES: (from_node_id, to_node_id, distance_m, time_s)
EDGES: list[tuple[int, int, float, float]] = [
    (1, 2, 100, 80),
    (2, 3, 150, 120),
    (2, 4,  80,  60),
    (3, 5, 200, 160),
    (4, 5, 120,  90),
]
