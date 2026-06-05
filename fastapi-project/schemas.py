from pydantic import BaseModel


class RouteRequest(BaseModel):
    start_node_id: int
    goal_node_id: int


class PathStep(BaseModel):
    from_node: int
    to_node: int


class NodePhoto(BaseModel):
    node_id: int
    photo: str


class RouteResponse(BaseModel):
    path: list[PathStep]
    distance: float  # メートル
    time: float      # 秒
    photos: list[NodePhoto]
