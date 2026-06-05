from fastapi import FastAPI, HTTPException

from data import EDGES, NODES
from pathfinder import find_route
from schemas import NodePhoto, PathStep, RouteRequest, RouteResponse

app = FastAPI()


@app.post("/route", response_model=RouteResponse)
def get_route(req: RouteRequest):
    if req.start_node_id not in NODES or req.goal_node_id not in NODES:
        raise HTTPException(status_code=404, detail="ノードが見つかりません")

    path_steps, distance, time, path_node_ids = find_route(
        req.start_node_id, req.goal_node_id, NODES, EDGES
    )

    photos = [
        NodePhoto(node_id=nid, photo=NODES[nid]["photo"])
        for nid in path_node_ids
    ]

    return RouteResponse(
        path=[PathStep(from_node=s["from"], to_node=s["to"]) for s in path_steps],
        distance=distance,
        time=time,
        photos=photos,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
