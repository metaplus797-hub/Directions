import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    """実行環境の変数に左右されないよう、既定はローカル（編集できる）扱いにする"""
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.delenv("DIRECTIONS_READ_ONLY", raising=False)


@pytest.fixture
def client():
    return TestClient(app)
