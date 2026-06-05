import heapq


# アルゴリズムを変える場合はこの関数だけ書き換えればOK
# 引数・返り値の型は固定
def find_route(
    start_id: int,
    goal_id: int,
    nodes: dict[int, dict],
    edges: list[tuple[int, int, float, float]],
) -> tuple[list[dict], float, float, list[int]]:
    """
    returns:
        path_steps  : [{"from": int, "to": int}, ...]
        total_distance : float (メートル)
        total_time     : float (秒)
        path_node_ids  : [int, ...]  (スタートからゴールの順)
    """
    # 隣接リスト構築
    graph: dict[int, list[tuple[int, float, float]]] = {nid: [] for nid in nodes}
    for from_id, to_id, dist, time in edges:
        graph[from_id].append((to_id, dist, time))
        graph[to_id].append((from_id, dist, time))

    # Dijkstra（距離最小）
    inf = float("inf")
    best_dist = {nid: inf for nid in nodes}
    best_dist[start_id] = 0.0
    prev: dict[int, tuple[int, float, float]] = {}  # node -> (from_node, dist, time)
    pq = [(0.0, start_id)]

    while pq:
        d, u = heapq.heappop(pq)
        if d > best_dist[u]:
            continue
        for v, w, t in graph[u]:
            nd = best_dist[u] + w
            if nd < best_dist[v]:
                best_dist[v] = nd
                prev[v] = (u, w, t)
                heapq.heappush(pq, (nd, v))

    # パス復元
    path_nodes: list[int] = []
    node = goal_id
    while node != start_id:
        path_nodes.append(node)
        node = prev[node][0]
    path_nodes.append(start_id)
    path_nodes.reverse()

    path_steps = [{"from": path_nodes[i], "to": path_nodes[i + 1]} for i in range(len(path_nodes) - 1)]
    total_distance = best_dist[goal_id]
    total_time = sum(prev[path_nodes[i + 1]][2] for i in range(len(path_nodes) - 1))

    return path_steps, total_distance, total_time, path_nodes
