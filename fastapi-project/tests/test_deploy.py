"""Vercel に載せるための条件チェック

Vercel のアカウントがなくても確かめられる範囲を、ローカルと GitHub Actions で検査する。
"""
import shutil
from pathlib import Path

import pytest
from fastapi import FastAPI

import main
from data import graph_service

PROJECT_DIR = Path(main.__file__).resolve().parent


def test_entrypoint_exposes_fastapi_app():
    # Vercel は main.py にある `app` という名前の FastAPI インスタンスを探す
    assert isinstance(main.app, FastAPI)


def test_no_app_wide_middleware():
    # アプリ全体にミドルウェアがあると、Vercel は静的ファイルをCDNに載せず関数で配信する
    assert main.app.user_middleware == []


def test_runtime_files_are_inside_root_directory():
    # Vercel の Root Directory は fastapi-project/。その外のファイルは配置されない
    for path in [main.FRONTEND_DIR, main.IMAGE_DIR, main.FLOOR_META_PATH, graph_service.csv_path]:
        assert path.resolve().is_relative_to(PROJECT_DIR), path


@pytest.mark.parametrize(
    "path", ["/", "/index.html", "/app.js", "/style.css", "/editor.html", "/map-editor.html"]
)
def test_frontend_files_are_served(client, path):
    assert client.get(path).status_code == 200


def test_api_routes_win_over_static_files(client):
    # / に静的ファイルをマウントしていても /api/* は API が応答する
    res = client.get("/api/floors")
    assert res.headers["content-type"].startswith("application/json")


def test_every_floor_has_map_image(client):
    for floor in client.get("/api/floors").json():
        image = client.get(f"/api/floors/{floor}/graph").json()["map_image"]
        assert client.get(f"/static/images/{image}").status_code == 200, image


def test_every_node_photo_exists(client):
    for node in client.get("/api/nodes").json():
        if node["image_name"]:
            res = client.get(f"/static/images/{node['image_name']}.jpg")
            assert res.status_code == 200, node["id"]


# --- 公開環境では編集APIを止める ---

WRITE_REQUESTS = [
    ("/api/editor/nodes", {"json": []}),
    ("/api/floors/F7/meta", {"json": {"label": "7F"}}),
    ("/api/floors/F7/map-image", {"files": {"file": ("map.png", b"dummy", "image/png")}}),
]


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    """万一ブロックに失敗しても本物のデータを書き換えないよう、保存先を一時フォルダに差し替える"""
    csv_copy = tmp_path / "graph_data.csv"
    shutil.copy(graph_service.csv_path, csv_copy)
    monkeypatch.setattr(graph_service, "csv_path", csv_copy)
    monkeypatch.setattr(main, "IMAGE_DIR", tmp_path / "images")
    monkeypatch.setattr(main, "FLOOR_META_PATH", tmp_path / "floor_map_meta.json")
    return tmp_path


def _snapshot(folder: Path) -> dict:
    return {p.relative_to(folder): p.read_bytes() for p in folder.rglob("*") if p.is_file()}


@pytest.mark.parametrize("env_name", ["VERCEL", "DIRECTIONS_READ_ONLY"])
@pytest.mark.parametrize("url,kwargs", WRITE_REQUESTS)
def test_write_apis_are_blocked_when_public(client, sandbox, monkeypatch, env_name, url, kwargs):
    monkeypatch.setenv(env_name, "1")
    before = _snapshot(sandbox)

    res = client.post(url, **kwargs)

    assert res.status_code == 403
    assert res.json()["detail"] == "公開環境ではデータを編集できません"
    assert _snapshot(sandbox) == before


def test_read_apis_still_work_when_public(client, monkeypatch):
    monkeypatch.setenv("DIRECTIONS_READ_ONLY", "1")
    assert client.get("/api/editor/nodes").status_code == 200
    assert client.get("/api/floors/F7/meta").status_code == 200
    assert client.post("/api/route", json={"start": "F7-3", "goal": "F7-5"}).json()["found"]


def test_local_mode_is_writable():
    assert main.is_read_only() is False
