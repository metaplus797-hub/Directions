const state = {
  rows: [],
  floor: "F6",
  selectedNodeId: null,
  editingNodeId: null,
  draggingNodeId: null,
  draggingButton: null,
  didMoveNode: false,
  mapImage: null,
  mapImageName: "",
  backgroundImage: null,
  backgroundLayer: null,
  backgroundLayerKey: "",
  transform: null,
  dragOffset: { x: 0, y: 0 },
};

const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");
const edgeCanvas = document.getElementById("edgeCanvas");
const edgeContext = edgeCanvas.getContext("2d");
const nodeLayer = document.getElementById("nodeLayer");

const floorSelect = document.getElementById("floorSelect");
const floorLabelInput = document.getElementById("floorLabelInput");
const mapImageUpload = document.getElementById("mapImageUpload");
const statusEl = document.getElementById("status");
const nodeInfoEl = document.getElementById("nodeInfo");

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.headers || {},
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `APIエラー: ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

function parseRows(rows) {
  return (rows || []).map((row) => ({
    ...row,
    x: Number(row.x ?? 0),
    y: Number(row.y ?? 0),
    is_destination: String(row.is_destination ?? "FALSE").toUpperCase() === "TRUE",
  }));
}

function getFloorRows() {
  return state.rows.filter((row) => String(row.Floor || "").trim() === state.floor);
}

function renderFloorOptions() {
  const floors = [...new Set(state.rows.map((row) => String(row.Floor || "").trim()).filter(Boolean))].sort();
  floorSelect.innerHTML = floors.map((floor) => `<option value="${floor}">${floor}</option>`).join("");
  if (floors.includes(state.floor)) {
    floorSelect.value = state.floor;
  } else if (floors.length) {
    state.floor = floors[0];
    floorSelect.value = state.floor;
  }
  floorLabelInput.value = state.floor;
}

function computeTransform() {
  if (state.transform) return state.transform;

  const rows = getFloorRows();
  if (!rows.length) {
    state.transform = { scale: 1, offsetX: 40, offsetY: 40 };
    return state.transform;
  }

  const xs = rows.map((n) => n.x);
  const ys = rows.map((n) => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const logicalW = maxX - minX || 1;
  const logicalH = maxY - minY || 1;
  const width = canvas.width;
  const height = canvas.height;
  const scale = Math.min((width - 80) / logicalW, (height - 80) / logicalH) * 0.9;
  state.transform = {
    scale,
    offsetX: width / 2 - ((minX + maxX) / 2) * scale,
    offsetY: height / 2 + ((minY + maxY) / 2) * scale,
  };
  return state.transform;
}

function toScreen(x, y) {
  const t = computeTransform();
  return { x: x * t.scale + t.offsetX, y: -(y * t.scale) + t.offsetY };
}

function fromScreen(sx, sy) {
  const t = computeTransform();
  return { x: (sx - t.offsetX) / t.scale, y: -(sy - t.offsetY) / t.scale };
}

function getNodeById(id) {
  return state.rows.find((row) => row.id === id);
}

function drawBackground() {
  const layer = getBackgroundLayer();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(layer, 0, 0);
  drawSelectedNodeEdges();
  renderNodeLayer();
}

function drawSelectedNodeEdges() {
  edgeContext.clearRect(0, 0, edgeCanvas.width, edgeCanvas.height);
  const selectedNode = getNodeById(state.selectedNodeId);
  if (!selectedNode) return;

  const neighborIds = String(selectedNode.adjacent_point || "").split(/\s+/).filter(Boolean);
  edgeContext.beginPath();
  edgeContext.strokeStyle = "#f97316";
  edgeContext.lineWidth = 3;
  edgeContext.lineCap = "round";

  neighborIds.forEach((value) => {
    const neighborId = /^\d+$/.test(value) ? `${selectedNode.Floor}-${value}` : value;
    const neighbor = getNodeById(neighborId);
    if (!neighbor || String(neighbor.Floor || "").trim() !== state.floor) return;

    const from = toScreen(Number(selectedNode.x), Number(selectedNode.y));
    const to = toScreen(Number(neighbor.x), Number(neighbor.y));
    edgeContext.moveTo(from.x, from.y);
    edgeContext.lineTo(to.x, to.y);
  });

  edgeContext.stroke();
}

function getBackgroundLayer() {
  const key = `${canvas.width}x${canvas.height}:${state.mapImage}`;
  if (state.backgroundLayer && state.backgroundLayerKey === key) {
    return state.backgroundLayer;
  }

  const layer = document.createElement("canvas");
  layer.width = canvas.width;
  layer.height = canvas.height;
  const layerContext = layer.getContext("2d");
  layerContext.fillStyle = "#edf2f7";
  layerContext.fillRect(0, 0, layer.width, layer.height);

  if (state.mapImage) {
    if (state.mapImageName !== state.mapImage) {
      state.mapImageName = state.mapImage;
      state.backgroundImage = new Image();
      state.backgroundImage.onload = () => {
        if (state.mapImageName === state.mapImage) {
          state.backgroundLayer = null;
          drawBackground();
        }
      };
      state.backgroundImage.onerror = () => {
        if (state.mapImageName === state.mapImage) {
          statusEl.textContent = `背景画像を読み込めませんでした: ${state.mapImage}`;
        }
      };
      state.backgroundImage.src = `/static/images/${state.mapImage}`;
    }

    const img = state.backgroundImage;
    if (img?.complete && img.naturalWidth > 0) {
      const ratio = Math.min((layer.width * 0.92) / img.width, (layer.height * 0.92) / img.height);
      const drawWidth = img.width * ratio;
      const drawHeight = img.height * ratio;
      layerContext.drawImage(img, (layer.width - drawWidth) / 2, (layer.height - drawHeight) / 2, drawWidth, drawHeight);
    }
  }

  state.backgroundLayer = layer;
  state.backgroundLayerKey = key;
  return layer;
}

function renderNodeLayer() {
  nodeLayer.replaceChildren();
  const rows = getFloorRows();
  if (!rows.length) {
    const message = document.createElement("p");
    message.className = "map-empty-message";
    message.textContent = "このフロアにはノードがありません";
    nodeLayer.append(message);
    return;
  }

  rows.forEach((row) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-node-button";
    button.dataset.nodeId = row.id;
    button.setAttribute("aria-label", `${row.id}: ${row.name}`);
    button.title = `${row.id}: ${row.name}`;

    const dot = document.createElement("span");
    dot.className = `map-node-dot${row.is_destination ? " destination" : ""}`;
    dot.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "map-node-label";
    label.textContent = row.name || row.id;
    button.append(dot, label);
    positionNodeButton(button, row);
    button.classList.toggle("selected", row.id === state.selectedNodeId);
    nodeLayer.append(button);
  });
}

function positionNodeButton(button, node) {
  const point = toScreen(Number(node.x), Number(node.y));
  button.style.left = `${(point.x / canvas.width) * 100}%`;
  button.style.top = `${(point.y / canvas.height) * 100}%`;
}

function selectNode(node) {
  state.selectedNodeId = node.id;
  nodeLayer.querySelectorAll(".map-node-button").forEach((button) => {
    button.classList.toggle("selected", button.dataset.nodeId === node.id);
  });
  drawSelectedNodeEdges();
  renderNodeInfo();
}

function renderNodeInfo() {
  const node = getNodeById(state.selectedNodeId);
  if (!node) {
    nodeInfoEl.innerHTML = "<p class=\"empty-text\">ノードを選択してください</p>";
    document.getElementById("floorSelect").disabled = false;
    document.getElementById("addNodeBtn").disabled = false;
    return;
  }

  const isEditing = state.editingNodeId === node.id;
  nodeInfoEl.innerHTML = `
    <div class="node-field">
      <label>ID</label>
      <input id="nodeIdInput" value="${escapeHtml(node.id)}" />
    </div>
    <div class="node-field">
      <label>名前</label>
      <input id="nodeNameInput" value="${escapeHtml(node.name)}" />
    </div>
    <div class="node-field">
      <label>X</label>
      <input id="nodeXInput" type="number" step="0.1" value="${Number(node.x).toFixed(2)}" />
    </div>
    <div class="node-field">
      <label>Y</label>
      <input id="nodeYInput" type="number" step="0.1" value="${Number(node.y).toFixed(2)}" />
    </div>
    <div class="node-field">
      <label>隣接ノード</label>
      <input id="nodeAdjacentInput" value="${escapeHtml(node.adjacent_point || "")}" />
    </div>
    <div class="node-field checkbox-row">
      <label>目的地</label>
      <input id="nodeDestinationInput" type="checkbox" ${node.is_destination ? "checked" : ""} />
    </div>
    <div class="node-field">
      <label>画像名</label>
      <input id="nodeImageInput" value="${escapeHtml(node.imageName || "")}" />
    </div>
    <div class="editor-actions" id="nodeEditActions" ${isEditing ? "" : "hidden"}>
      <button id="completeNodeEditBtn" type="button" class="primary-btn">編集完了</button>
    </div>
  `;
  updateEditControls();

  document.getElementById("nodeIdInput").addEventListener("input", (e) => {
    beginNodeEdit(node);
    node.id = e.target.value;
    state.selectedNodeId = node.id;
    state.editingNodeId = node.id;
    renderNodeLayer();
  });
  document.getElementById("nodeNameInput").addEventListener("input", (e) => {
    beginNodeEdit(node);
    node.name = e.target.value;
    renderNodeLayer();
  });
  document.getElementById("nodeXInput").addEventListener("input", (e) => {
    beginNodeEdit(node);
    node.x = Number(e.target.value || 0);
    renderNodeLayer();
    drawSelectedNodeEdges();
  });
  document.getElementById("nodeYInput").addEventListener("input", (e) => {
    beginNodeEdit(node);
    node.y = Number(e.target.value || 0);
    renderNodeLayer();
    drawSelectedNodeEdges();
  });
  document.getElementById("nodeAdjacentInput").addEventListener("input", (e) => {
    beginNodeEdit(node);
    node.adjacent_point = e.target.value;
    drawSelectedNodeEdges();
  });
  document.getElementById("nodeDestinationInput").addEventListener("change", (e) => {
    beginNodeEdit(node);
    node.is_destination = e.target.checked;
    renderNodeLayer();
  });
  document.getElementById("nodeImageInput").addEventListener("input", (e) => {
    beginNodeEdit(node);
    node.imageName = e.target.value;
  });
  document.getElementById("completeNodeEditBtn").addEventListener("click", () => {
    state.editingNodeId = null;
    renderNodeInfo();
    statusEl.textContent = `ノード「${node.name}」の編集を完了しました`;
  });
}

function updateEditControls() {
  const isEditing = state.editingNodeId === state.selectedNodeId;
  floorSelect.disabled = isEditing;
  document.getElementById("addNodeBtn").disabled = isEditing;
  const actions = document.getElementById("nodeEditActions");
  if (actions) actions.hidden = !isEditing;
}

function beginNodeEdit(node) {
  if (state.editingNodeId === node.id) return;
  state.editingNodeId = node.id;
  updateEditControls();
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - canvas.clientLeft) * (canvas.width / canvas.clientWidth),
    y: (event.clientY - rect.top - canvas.clientTop) * (canvas.height / canvas.clientHeight),
  };
}

function normalizeAdjacentNodes() {
  const floorRows = getFloorRows();
  floorRows.forEach((node) => {
    const neighbors = [];
    floorRows.forEach((other) => {
      if (other.id === node.id) return;
      const distance = Math.hypot(Number(other.x) - Number(node.x), Number(other.y) - Number(node.y));
      if (distance <= 5.5) {
        neighbors.push(other.id);
      }
    });
    node.adjacent_point = neighbors.join(" ");
  });
}

async function loadRows() {
  const rows = await api("/api/editor/nodes");
  state.rows = parseRows(rows);
  state.transform = null;
  if (state.selectedNodeId && !getNodeById(state.selectedNodeId)) {
    state.selectedNodeId = null;
    state.editingNodeId = null;
  }
  renderFloorOptions();
  await loadFloorMeta();
  renderNodeInfo();
  drawBackground();
}

async function loadFloorMeta() {
  try {
    const meta = await api(`/api/floors/${encodeURIComponent(state.floor)}/meta`);
    state.mapImage = meta.map_image || "";
    floorLabelInput.value = meta.label || state.floor;
  } catch {
    state.mapImage = `map_${state.floor.toLowerCase()}.png`;
  }
}

async function saveMapMeta() {
  const label = floorLabelInput.value.trim() || state.floor;
  const file = mapImageUpload.files[0];

  if (file) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("label", label);
    const result = await api(`/api/floors/${encodeURIComponent(state.floor)}/map-image`, {
      method: "POST",
      body: formData,
    });
    state.mapImage = result.map_image;
    state.mapImageName = "";
    state.backgroundImage = null;
    state.backgroundLayer = null;
    statusEl.textContent = `背景画像を保存しました: ${result.map_image}`;
  } else {
    await api(`/api/floors/${encodeURIComponent(state.floor)}/meta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, map_image: `map_${state.floor.toLowerCase()}.png` }),
    });
    state.mapImage = `map_${state.floor.toLowerCase()}.png`;
    state.backgroundLayer = null;
    statusEl.textContent = `フロア情報を保存しました: ${state.floor}`;
  }

  mapImageUpload.value = "";
  drawBackground();
}

async function saveNodes() {
  const payload = state.rows
    .filter((row) => row.id && row.name)
    .map((row) => ({
      id: String(row.id).trim(),
      name: String(row.name).trim(),
      x: Number(row.x || 0),
      y: Number(row.y || 0),
      adjacent_point: String(row.adjacent_point || "").trim(),
      is_destination: Boolean(row.is_destination),
      Floor: String(row.Floor || state.floor).trim(),
      imageName: String(row.imageName || "").trim(),
    }));

  const result = await api("/api/editor/nodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  statusEl.textContent = `保存しました: ${result.count} 件`;
  await loadRows();
}

function addNode() {
  const floorRows = getFloorRows();
  const nextIndex = floorRows.length + 1;
  const newId = `${state.floor}-${nextIndex}`;
  const row = {
    id: newId,
    name: `新規ノード${nextIndex}`,
    x: 0,
    y: 0,
    adjacent_point: "",
    is_destination: false,
    Floor: state.floor,
    imageName: "",
  };
  state.rows.push(row);
  state.selectedNodeId = row.id;
  state.editingNodeId = row.id;
  state.transform = null;
  renderFloorOptions();
  renderNodeInfo();
  drawBackground();
}

function attachCanvasEvents() {
  const finishDrag = () => {
    if (state.draggingNodeId && state.didMoveNode) {
      normalizeAdjacentNodes();
      renderNodeInfo();
      drawSelectedNodeEdges();
    }
    state.draggingNodeId = null;
    state.draggingButton = null;
    state.didMoveNode = false;
  };

  nodeLayer.addEventListener("pointerdown", (event) => {
    const button = event.target.closest(".map-node-button");
    if (!button) return;
    const node = getNodeById(button.dataset.nodeId);
    if (!node) return;
    if (state.editingNodeId && state.editingNodeId !== node.id) {
      statusEl.textContent = "編集中です。別のノードを選ぶには「編集完了」を押してください";
      return;
    }

    event.preventDefault();
    selectNode(node);
    const { x, y } = getCanvasPoint(event);
    state.draggingNodeId = node.id;
    state.draggingButton = button;
    state.didMoveNode = false;
    const point = toScreen(Number(node.x), Number(node.y));
    state.dragOffset = { x: x - point.x, y: y - point.y };
    button.setPointerCapture(event.pointerId);
  });

  nodeLayer.addEventListener("pointermove", (event) => {
    if (!state.draggingNodeId) return;
    const { x, y } = getCanvasPoint(event);
    const node = getNodeById(state.draggingNodeId);
    if (!node) return;

    const point = fromScreen(x - state.dragOffset.x, y - state.dragOffset.y);
    const nextX = Number(point.x.toFixed(2));
    const nextY = Number(point.y.toFixed(2));
    if (nextX === Number(node.x) && nextY === Number(node.y)) return;

    beginNodeEdit(node);
    state.didMoveNode = true;
    node.x = nextX;
    node.y = nextY;
    if (state.draggingButton) positionNodeButton(state.draggingButton, node);
    drawSelectedNodeEdges();
    const xInput = document.getElementById("nodeXInput");
    const yInput = document.getElementById("nodeYInput");
    if (xInput) xInput.value = nextX.toFixed(2);
    if (yInput) yInput.value = nextY.toFixed(2);
  });

  nodeLayer.addEventListener("pointerup", finishDrag);
  nodeLayer.addEventListener("pointercancel", finishDrag);
  nodeLayer.addEventListener("click", (event) => {
    if (event.detail !== 0) return;
    const button = event.target.closest(".map-node-button");
    const node = button && getNodeById(button.dataset.nodeId);
    if (!node) return;
    if (state.editingNodeId && state.editingNodeId !== node.id) {
      statusEl.textContent = "編集中です。別のノードを選ぶには「編集完了」を押してください";
      return;
    }
    selectNode(node);
  });
}

floorSelect.addEventListener("change", async (event) => {
  state.floor = event.target.value;
  state.selectedNodeId = null;
  state.editingNodeId = null;
  state.transform = null;
  state.backgroundLayer = null;
  await loadFloorMeta();
  renderNodeInfo();
  drawBackground();
});

document.getElementById("saveMapMetaBtn").addEventListener("click", saveMapMeta);
document.getElementById("addNodeBtn").addEventListener("click", addNode);
document.getElementById("recalcNeighborsBtn").addEventListener("click", () => {
  normalizeAdjacentNodes();
  renderNodeInfo();
  drawBackground();
  statusEl.textContent = "近いノードを自動接続しました";
});
document.getElementById("saveNodesBtn").addEventListener("click", saveNodes);

attachCanvasEvents();
loadRows();
