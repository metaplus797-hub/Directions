const state = {
  rows: [],
  floor: "F6",
  selectedNodeId: null,
  draggingNodeId: null,
  mapImage: null,
  mapImageName: "",
  dragOffset: { x: 0, y: 0 },
};

const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");

const floorSelect = document.getElementById("floorSelect");
const floorLabelInput = document.getElementById("floorLabelInput");
const mapImageUpload = document.getElementById("mapImageUpload");
const statusEl = document.getElementById("status");
const nodeInfoEl = document.getElementById("nodeInfo");

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

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
  const rows = getFloorRows();
  if (!rows.length) {
    return { scale: 1, offsetX: 40, offsetY: 40 };
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
  return {
    scale,
    offsetX: width / 2 - ((minX + maxX) / 2) * scale,
    offsetY: height / 2 + ((minY + maxY) / 2) * scale,
  };
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
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#edf2f7";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (state.mapImage) {
    const img = new Image();
    img.onload = () => {
      const maxWidth = canvas.width * 0.92;
      const maxHeight = canvas.height * 0.92;
      const ratio = Math.min(maxWidth / img.width, maxHeight / img.height);
      const drawWidth = img.width * ratio;
      const drawHeight = img.height * ratio;
      const x = (canvas.width - drawWidth) / 2;
      const y = (canvas.height - drawHeight) / 2;
      ctx.drawImage(img, x, y, drawWidth, drawHeight);
      drawNodes();
    };
    img.src = `/static/images/${state.mapImage}`;
    return;
  }

  drawNodes();
}

function drawNodes() {
  const rows = getFloorRows();
  if (!rows.length) {
    drawEmptyMessage();
    return;
  }

  rows.forEach((row) => {
    const p = toScreen(Number(row.x), Number(row.y));
    const isSelected = row.id === state.selectedNodeId;
    const isDestination = row.is_destination;

    ctx.beginPath();
    ctx.fillStyle = isSelected ? "#ef4444" : isDestination ? "#2563eb" : "#10b981";
    ctx.arc(p.x, p.y, isSelected ? 10 : 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#111827";
    ctx.font = "12px sans-serif";
    ctx.fillText(row.name || row.id, p.x + 10, p.y - 8);
  });

  if (state.selectedNodeId) {
    const node = getNodeById(state.selectedNodeId);
    if (node) {
      const p = toScreen(Number(node.x), Number(node.y));
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      ctx.fillRect(p.x + 12, p.y - 36, 180, 28);
      ctx.fillStyle = "#fff";
      ctx.font = "12px sans-serif";
      ctx.fillText(`${node.id} / ${node.name}`, p.x + 18, p.y - 18);
    }
  }
}

function drawEmptyMessage() {
  ctx.fillStyle = "#64748b";
  ctx.font = "18px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("このフロアにはノードがありません", canvas.width / 2, canvas.height / 2);
}

function renderNodeInfo() {
  const node = getNodeById(state.selectedNodeId);
  if (!node) {
    nodeInfoEl.innerHTML = "<p class=\"empty-text\">ノードを選択してください</p>";
    return;
  }

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
  `;

  document.getElementById("nodeIdInput").addEventListener("input", (e) => {
    node.id = e.target.value;
  });
  document.getElementById("nodeNameInput").addEventListener("input", (e) => {
    node.name = e.target.value;
  });
  document.getElementById("nodeXInput").addEventListener("input", (e) => {
    node.x = Number(e.target.value || 0);
    drawBackground();
  });
  document.getElementById("nodeYInput").addEventListener("input", (e) => {
    node.y = Number(e.target.value || 0);
    drawBackground();
  });
  document.getElementById("nodeAdjacentInput").addEventListener("input", (e) => {
    node.adjacent_point = e.target.value;
  });
  document.getElementById("nodeDestinationInput").addEventListener("change", (e) => {
    node.is_destination = e.target.checked;
  });
  document.getElementById("nodeImageInput").addEventListener("input", (e) => {
    node.imageName = e.target.value;
  });
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function findClosestNode(pointX, pointY) {
  const rows = getFloorRows();
  let best = null;
  let bestDist = Infinity;

  rows.forEach((row) => {
    const p = toScreen(Number(row.x), Number(row.y));
    const dist = Math.hypot(pointX - p.x, pointY - p.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = row;
    }
  });

  return { node: best, dist: bestDist };
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
  renderFloorOptions();
  await loadFloorMeta();
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
    statusEl.textContent = `背景画像を保存しました: ${result.map_image}`;
  } else {
    await api(`/api/floors/${encodeURIComponent(state.floor)}/meta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, map_image: `map_${state.floor.toLowerCase()}.png` }),
    });
    state.mapImage = `map_${state.floor.toLowerCase()}.png`;
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
      x: String(Number(row.x || 0)),
      y: String(Number(row.y || 0)),
      adjacent_point: String(row.adjacent_point || "").trim(),
      is_destination: row.is_destination ? "TRUE" : "FALSE",
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
  renderFloorOptions();
  renderNodeInfo();
  drawBackground();
}

function attachCanvasEvents() {
  canvas.addEventListener("pointerdown", (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const { node } = findClosestNode(x, y);
    if (!node) return;

    state.selectedNodeId = node.id;
    state.draggingNodeId = node.id;
    const point = toScreen(Number(node.x), Number(node.y));
    state.dragOffset = { x: x - point.x, y: y - point.y };
    renderNodeInfo();
    drawBackground();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!state.draggingNodeId) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const node = getNodeById(state.draggingNodeId);
    if (!node) return;

    const point = fromScreen(x - state.dragOffset.x, y - state.dragOffset.y);
    node.x = Number(point.x.toFixed(2));
    node.y = Number(point.y.toFixed(2));
    renderNodeInfo();
    drawBackground();
  });

  canvas.addEventListener("pointerup", () => {
    if (state.draggingNodeId) {
      normalizeAdjacentNodes();
      renderNodeInfo();
      drawBackground();
    }
    state.draggingNodeId = null;
  });

  canvas.addEventListener("pointerleave", () => {
    if (state.draggingNodeId) {
      normalizeAdjacentNodes();
      renderNodeInfo();
      drawBackground();
    }
    state.draggingNodeId = null;
  });
}

floorSelect.addEventListener("change", async (event) => {
  state.floor = event.target.value;
  state.selectedNodeId = null;
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
