"""API の基本動作（画面から呼ばれる6本）"""


def test_floors(client):
    res = client.get("/api/floors")
    assert res.status_code == 200
    floors = res.json()
    assert {"F6", "F7", "out"} <= set(floors)
    assert "F8" not in floors  # EXCLUDED_FLOORS で除外中


def test_all_nodes(client):
    nodes = client.get("/api/nodes").json()
    ids = {n["id"] for n in nodes}
    assert {"F6-1", "F7-1", "out-1"} <= ids


def test_floor_graph(client):
    body = client.get("/api/floors/F7/graph").json()
    assert body["floor"] == "F7"
    assert body["map_image"] == "map_f7.png"
    assert len(body["nodes"]) == 17
    node_ids = {n["id"] for n in body["nodes"]}
    # 別フロアへの接続（F7-1 -> F6-1 など）は含めない
    assert all(f in node_ids and t in node_ids for f, t in body["edges"])


def test_unknown_floor_is_404(client):
    assert client.get("/api/floors/F99/graph").status_code == 404


def test_destinations_are_sorted_by_name(client):
    names = [d["name"] for d in client.get("/api/floors/F7/destinations").json()]
    assert "W701" in names
    assert "aisle1" not in names  # 通路は目的地ではない
    assert names == sorted(names)


def test_node_lookup(client):
    body = client.get("/api/nodes/F7-3").json()
    assert body["name"] == "W705"
    assert body["label"] == "W705"  # 目的地なのでラベルあり
    assert client.get("/api/nodes/no-such-node").status_code == 404


def test_route_on_same_floor(client):
    body = client.post("/api/route", json={"start": "F7-3", "goal": "F7-5"}).json()
    assert body["found"] is True
    assert body["path"][0] == "F7-3"
    assert body["path"][-1] == "F7-5"
    assert body["floors"] == ["F7"]
    assert body["distance"] > 0


def test_route_across_floors_uses_elevator(client):
    body = client.post("/api/route", json={"start": "F7-5", "goal": "F6-14"}).json()
    assert body["found"] is True
    assert body["floors"] == ["F6", "F7"]
    assert "F7-1" in body["path"] and "F6-1" in body["path"]  # EV7 -> EV6


def test_route_with_same_start_and_goal(client):
    body = client.post("/api/route", json={"start": "F7-3", "goal": "F7-3"}).json()
    assert body["found"] is False
    assert body["message"] == "現在地と目的地が同じです"


def test_route_with_unknown_node_is_404(client):
    res = client.post("/api/route", json={"start": "F7-3", "goal": "no-such-node"})
    assert res.status_code == 404
