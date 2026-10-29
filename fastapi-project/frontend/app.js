/**
 * app.js
 *
 * Kotlin版からの移植対応表:
 *  - MainActivity.updateDestinationSpinner() -> loadDestinations()
 *  - MainActivity.updateMapDisplay()         -> loadFloorGraph() + draw()
 *  - MainActivity.updateRoute()              -> updateRoute()
 *  - MainActivity.dijkstra()/calculateWeight()-> サーバー側 (backend/app/pathfinding.py) に移植済み。
 *                                                フロントはAPI経由で結果を取得するのみ。
 *  - MainActivity.handleIntent() (NFC)       -> onNfcRead() / NDEFReader連携
 *  - ModernRouteView2.onDraw()               -> draw()
 *  - ModernRouteView2.onTouchEvent()         -> canvas 'click' イベント
 */

// バックエンドが別オリジンの場合はここを "http://localhost:8000" のように変更する
const API_BASE = "";

// --- アプリの状態 ---
const state = {
  floors: [],
  currentFloor: "",
  currentLocation: null, // ノードID (string)
  goalLocation: null, // ノードID (string)
  destinations: [], // 現在のフロアの目的地一覧
  floorGraph: null, // 現在のフロアの {nodes, edges, map_image}
  pathEdgesByFloor: {}, // {floor: [[from,to], ...]}
  fullPath: [], // 経路の全ノードID (List<string>)
  distance: 0.0, // 距離 (float)
  selectedNodeId: null, // ポップアップ表示中のノード
};

// --- DOM要素 ---
const el = {
  location: document.getElementById("locationTextView"),
  floorSpinner: document.getElementById("floorSpinner"),
  goalSpinner: document.getElementById("goalSpinner"),
  showRouteButton: document.getElementById("showRouteButton"),
  result: document.getElementById("resultTextView"),
  canvas: document.getElementById("routeView"),
  nfcSimSelect: document.getElementById("nfcSimSelect"),
};
const ctx = el.canvas.getContext("2d");

// --- API ヘルパー ---
async function api(path, options) {
  const res = await fetch(API_BASE + path, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `APIエラー: ${res.status}`);
  }
  return res.json();
}

// =========================================================
// 初期化
// =========================================================
async function init() {
  resizeCanvas();
  window.addEventListener("resize", () => {
    resizeCanvas();
    draw();
  });

  state.floors = await api("/api/floors");
  el.floorSpinner.innerHTML = state.floors
    .map((f) => `<option value="${f}">${f}</option>`)
    .join("");
  state.currentFloor = state.floors[0] || "";
  el.floorSpinner.value = state.currentFloor;

  el.floorSpinner.addEventListener("change", async (e) => {
    state.currentFloor = e.target.value;
    await onFloorChanged();
  });

  el.goalSpinner.addEventListener("change", async (e) => {
    state.goalLocation = e.target.value || null;

    // Kotlin版: 目的地選択時、現在地のフロアと表示中フロアが違えば自動切り替え
    if (state.currentLocation && state.goalLocation) {
      const node = await api(`/api/nodes/${encodeURIComponent(state.currentLocation)}`);
      if (node.floor !== state.currentFloor) {
        state.currentFloor = node.floor;
        el.floorSpinner.value = node.floor;
        await onFloorChanged();
        return; // onFloorChanged 内で updateRoute まで実行される
      }
    }
    await updateRoute();
  });

  el.showRouteButton.addEventListener("click", () => updateRoute());

  el.canvas.addEventListener("click", onCanvasClick);

  await setupNfcSimulator();
  await setupWebNfc();

  await onFloorChanged();

  // NFCタグに書いたURL（例: https://nav.example.com/?loc=F7-3）から開かれた場合は、
  // その地点を現在地にする。URLを書いたタグなら iPhone でもかざすだけで開ける。
  const initialLoc = new URLSearchParams(window.location.search).get("loc");
  if (initialLoc) await onNfcRead(initialLoc);
}

async function onFloorChanged() {
  await Promise.all([loadDestinations(state.currentFloor), loadFloorGraph(state.currentFloor)]);
  await updateRoute();
}

// =========================================================
// データ取得
// =========================================================

// Kotlin版 updateDestinationSpinner(floor) 相当
async function loadDestinations(floor) {
  state.destinations = await api(`/api/floors/${encodeURIComponent(floor)}/destinations`);

  const options = [`<option value="">目的地を選択</option>`].concat(
    state.destinations.map((d) => `<option value="${d.id}">${d.name}</option>`)
  );
  el.goalSpinner.innerHTML = options.join("");

  // 保持している目的地がこのフロアにあれば選択状態を復元
  if (state.goalLocation && state.destinations.some((d) => d.id === state.goalLocation)) {
    el.goalSpinner.value = state.goalLocation;
  } else {
    el.goalSpinner.value = "";
  }
}

// Kotlin版 updateMapDisplay(floor) 相当（座標スケーリングは draw() 内で行う）
async function loadFloorGraph(floor) {
  state.floorGraph = await api(`/api/floors/${encodeURIComponent(floor)}/graph`);
  draw();
}

// =========================================================
// 経路探索 (Kotlin版 updateRoute() 相当)
// =========================================================
async function updateRoute() {
  const locName = state.currentLocation
    ? (state.floorGraph?.nodes.find((n) => n.id === state.currentLocation)?.name ?? state.currentLocation)
    : "未取得";
  el.location.textContent = `現在地: ${locName}`;

  if (!state.currentLocation || !state.goalLocation) {
    el.result.textContent = "現在地と目的地を選択してください";
    state.pathEdgesByFloor = {};
    state.fullPath = [];
    draw();
    return;
  }

  if (state.currentLocation === state.goalLocation) {
    el.result.textContent = "現在地と目的地が同じです";
    state.pathEdgesByFloor = {};
    state.fullPath = [];
    draw();
    return;
  }

  let route;
  try {
    route = await api("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: state.currentLocation, goal: state.goalLocation }),
    });
  } catch (err) {
    el.result.textContent = `経路探索エラー: ${err.message}`;
    return;
  }

  if (!route.found) {
    el.result.textContent = route.message || "経路が見つかりませんでした";
    state.pathEdgesByFloor = {};
    state.fullPath = [];
    draw();
    return;
  }

  state.fullPath = route.path;
  state.pathEdgesByFloor = route.edges_by_floor;
  state.distance = route.distance;

  const routeStr = route.path_names.join(" → ");
  if (route.floors.length > 1) {
    const floorStr = route.floors.join(" → ");
    el.result.textContent = `経路 (${floorStr}): ${routeStr}\n(エレベーター/階段で移動してください)`;
  } else {
    el.result.textContent = `経路: ${routeStr}\n距離: ${route.distance} m`;
  }

  draw();
}

// =========================================================
// Canvas描画 (Kotlin版 ModernRouteView2.onDraw() 相当)
// =========================================================
let viewTransform = { scale: 1, offsetX: 0, offsetY: 0 };

function resizeCanvas() {
  const rect = el.canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  el.canvas.width = rect.width * dpr;
  el.canvas.height = rect.height * dpr;
  el.canvas.style.width = `${rect.width}px`;
  el.canvas.style.height = `${rect.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function computeTransform() {
  const g = state.floorGraph;
  const w = el.canvas.clientWidth;
  const h = el.canvas.clientHeight;
  if (!g || g.nodes.length === 0) return { scale: 1, offsetX: w / 2, offsetY: h / 2 };

  const xs = g.nodes.map((n) => n.x);
  const ys = g.nodes.map((n) => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const logicalW = maxX - minX || 1;
  const logicalH = maxY - minY || 1;

  const scaleX = w / logicalW;
  const scaleY = h / logicalH;
  const scale = Math.min(scaleX, scaleY) * 0.85; // Kotlin版の 0.9 相当の余白確保

  return {
    scale,
    offsetX: w / 2 - ((minX + maxX) / 2) * scale,
    offsetY: h / 2 + ((minY + maxY) / 2) * scale, // Y軸反転(画面下が+)を考慮
  };
}

// 論理座標 -> 画面座標 (Y軸反転: ModernRouteView2 の canvas.scale(1, -1) 相当)
function toScreen(x, y) {
  const t = viewTransform;
  return { sx: x * t.scale + t.offsetX, sy: -(y * t.scale) + t.offsetY };
}

function draw() {
  const w = el.canvas.clientWidth;
  const h = el.canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);

  const g = state.floorGraph;
  if (!g) return;

  viewTransform = computeTransform();

  // 背景の地図画像
  if (g.map_image) {
    const img = getMapImage(g.map_image);
    if (img && img.complete) {
      ctx.globalAlpha = 0.8;
      const scale = Math.min(w / img.width, h / img.height) * 0.9;
      const dw = img.width * scale, dh = img.height * scale;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.globalAlpha = 1.0;
    }
  }

  const nodeMap = {};
  g.nodes.forEach((n) => (nodeMap[n.id] = n));

  // 1. エッジ（グレー線）
  ctx.strokeStyle = "#9aa5b1";
  ctx.lineWidth = 2;
  g.edges.forEach(([from, to]) => {
    drawLine(nodeMap[from], nodeMap[to]);
  });

  // 2. 最短経路（赤線＋矢印）
  const pathEdges = state.pathEdgesByFloor[state.currentFloor] || [];
  ctx.strokeStyle = "#e63946";
  ctx.lineWidth = 4;
  pathEdges.forEach(([from, to]) => {
    drawLine(nodeMap[from], nodeMap[to]);
    drawArrow(nodeMap[from], nodeMap[to]);
  });

  // 3. ノード（点）
  g.nodes.forEach((n) => {
    const { sx, sy } = toScreen(n.x, n.y);
    ctx.fillStyle = n.id === state.currentLocation ? "#2ecc71" : n.id === state.goalLocation ? "#e63946" : "#2c7be5";
    ctx.beginPath();
    ctx.arc(sx, sy, 7, 0, Math.PI * 2);
    ctx.fill();
  });

  // 4. 吹き出し（一番手前）
  if (state.selectedNodeId && nodeMap[state.selectedNodeId]) {
    drawPopup(nodeMap[state.selectedNodeId]);
  }
}

function drawLine(a, b) {
  if (!a || !b) return;
  const p1 = toScreen(a.x, a.y);
  const p2 = toScreen(b.x, b.y);
  ctx.beginPath();
  ctx.moveTo(p1.sx, p1.sy);
  ctx.lineTo(p2.sx, p2.sy);
  ctx.stroke();
}

function drawArrow(a, b) {
  if (!a || !b) return;
  const p1 = toScreen(a.x, a.y);
  const p2 = toScreen(b.x, b.y);
  const angle = Math.atan2(p2.sy - p1.sy, p2.sx - p1.sx);
  const len = 14;
  const endX = p2.sx - len * Math.cos(angle);
  const endY = p2.sy - len * Math.sin(angle);
  ctx.fillStyle = "#e63946";
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - 10 * Math.cos(angle - Math.PI / 6), endY - 10 * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(endX - 10 * Math.cos(angle + Math.PI / 6), endY - 10 * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

// Kotlin版 ModernRouteView2.drawPopUp() の移植版。
// 画像あり: 吹き出し内に写真＋テキスト。画像なし: テキストのみ。
// 画面端でのはみ出し防止と、ノード上下どちらに出すかの自動判定も再現。
function drawPopup(node) {
  const { sx, sy } = toScreen(node.x, node.y);
  const label = node.label || `地点: ${node.id}`;
  const hasImage = !!node.image_name;

  const imgW = 160;
  const imgH = 120;
  const padding = 12;
  const textH = 20;

  ctx.font = "14px sans-serif";
  const textW = ctx.measureText(label).width;
  const boxW = Math.max(hasImage ? imgW : 0, textW) + padding * 2;
  const boxH = hasImage ? padding * 3 + imgH + textH : padding * 2 + textH;

  const canvasW = el.canvas.clientWidth;
  const canvasH = el.canvas.clientHeight;
  const edgeMargin = 8;
  const nodeRadius = 7;
  const marginFromNode = 8; // ノードと吹き出し/矢印の隙間

  // 横位置: ノード中心に合わせつつ、画面端でクランプ
  let boxX = sx - boxW / 2;
  boxX = Math.min(Math.max(boxX, edgeMargin), canvasW - edgeMargin - boxW);

  // 縦位置: 基本はノードの上に表示、上に入りきらなければ下に表示
  const spaceAbove = sy - nodeRadius - marginFromNode;
  const showBelow = spaceAbove - boxH < edgeMargin;
  let boxY = showBelow ? sy + nodeRadius + marginFromNode : spaceAbove - boxH;
  boxY = Math.min(Math.max(boxY, edgeMargin), canvasH - edgeMargin - boxH);

  const boxCenterX = boxX + boxW / 2;

  // 吹き出しの矢印（尻尾）
  const arrowHalf = 9;
  ctx.fillStyle = "rgba(51,51,51,0.88)";
  ctx.beginPath();
  if (showBelow) {
    ctx.moveTo(sx, sy + nodeRadius + marginFromNode);
    ctx.lineTo(Math.max(boxX + arrowHalf, sx - arrowHalf), boxY);
    ctx.lineTo(Math.min(boxX + boxW - arrowHalf, sx + arrowHalf), boxY);
  } else {
    ctx.moveTo(sx, sy - nodeRadius - marginFromNode);
    ctx.lineTo(Math.max(boxX + arrowHalf, sx - arrowHalf), boxY + boxH);
    ctx.lineTo(Math.min(boxX + boxW - arrowHalf, sx + arrowHalf), boxY + boxH);
  }
  ctx.closePath();
  ctx.fill();

  // 吹き出し本体
  roundRect(ctx, boxX, boxY, boxW, boxH, 10);
  ctx.fill();

  let contentY = boxY + padding;

  if (hasImage) {
    const img = getNodeImage(node.image_name);
    const imgX = boxCenterX - imgW / 2;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.save();
      roundRect(ctx, imgX, contentY, imgW, imgH, 6);
      ctx.clip();
      ctx.drawImage(img, imgX, contentY, imgW, imgH);
      ctx.restore();
    } else {
      // 読み込み中のプレースホルダー
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      roundRect(ctx, imgX, contentY, imgW, imgH, 6);
      ctx.fill();
    }
    contentY += imgH + padding;
  }

  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, boxCenterX, contentY + textH / 2);
}

// --- 地点写真のキャッシュ（image_name は拡張子なしで保存されているため .jpg を付与） ---
const nodeImageCache = {};
function getNodeImage(imageName) {
  if (!nodeImageCache[imageName]) {
    const img = new Image();
    img.src = `static/images/${imageName}.jpg`;
    img.onload = () => draw();
    img.onerror = () => {
      // 画像が存在しない場合は握りつぶす（プレースホルダーのまま）
      console.warn(`地点写真が見つかりません: ${imageName}.jpg`);
    };
    nodeImageCache[imageName] = img;
  }
  return nodeImageCache[imageName];
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function onCanvasClick(e) {
  const g = state.floorGraph;
  if (!g) return;
  const rect = el.canvas.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const clickY = e.clientY - rect.top;

  let closest = null;
  let closestDist = 25; // タッチ許容範囲(px)
  g.nodes.forEach((n) => {
    const { sx, sy } = toScreen(n.x, n.y);
    const d = Math.hypot(clickX - sx, clickY - sy);
    if (d < closestDist) {
      closestDist = d;
      closest = n.id;
    }
  });

  state.selectedNodeId = state.selectedNodeId === closest ? null : closest;
  draw();
}

// --- 地図画像のキャッシュ ---
const imageCache = {};
function getMapImage(fileName) {
  if (!imageCache[fileName]) {
    const img = new Image();
    img.src = `static/images/${fileName}`;
    img.onload = () => draw();
    imageCache[fileName] = img;
  }
  return imageCache[fileName];
}

// =========================================================
// NFC関連 (Kotlin版 onResume/onNewIntent/handleIntent 相当)
// =========================================================

// 実機のNFCタグに "https://<ドメイン>/?loc=<nodeId>" や "nfctest://<nodeId>" のようなURLを
// 書き込んでおくと、ページを開いている間は Web NFC API (Android Chrome, HTTPS必須) 経由で読み取れる。
async function setupWebNfc() {
  if (!("NDEFReader" in window)) {
    console.info("Web NFC はこのブラウザでは利用できません（NFCシミュレーターを使用してください）");
    return;
  }
  try {
    const reader = new NDEFReader();
    await reader.scan();
    reader.onreading = (event) => {
      for (const record of event.message.records) {
        if (record.recordType === "url" || record.recordType === "text") {
          const decoder = new TextDecoder(record.encoding || "utf-8");
          const raw = decoder.decode(record.data);
          onNfcRead(raw);
        }
      }
    };
  } catch (err) {
    console.warn("NFCスキャンの開始に失敗しました:", err);
  }
}

// Kotlin版 handleIntent() 相当: 読み取ったURI/文字列からノードIDを抽出し検証する
async function onNfcRead(raw) {
  let nodeId = raw;
  try {
    const url = new URL(raw);
    // https://<ドメイン>/?loc=F7-3 形式なら loc を、nfctest://F7-3 形式ならホスト部分を使う
    nodeId = url.searchParams.get("loc") || url.host || url.pathname.replace(/^\//, "");
  } catch {
    // URL形式でなければ raw をそのままノードIDとして扱う
  }

  try {
    const node = await api(`/api/nodes/${encodeURIComponent(nodeId)}`);
    state.currentLocation = node.id;
    el.location.textContent = `現在地: ${node.name}`;

    if (state.currentFloor !== node.floor) {
      state.currentFloor = node.floor;
      el.floorSpinner.value = node.floor;
      await onFloorChanged();
    } else {
      await updateRoute();
    }
  } catch {
    alert(`未登録の地点です: ${nodeId}`);
  }
}

// 開発・デモ用: 実機NFCがない環境で現在地を疑似的に設定するセレクトボックス
async function setupNfcSimulator() {
  const nodes = await api("/api/nodes");
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  el.nfcSimSelect.innerHTML =
    `<option value="">-- 選択 --</option>` +
    sorted.map((n) => `<option value="${n.id}">${n.id} (${n.name})</option>`).join("");

  el.nfcSimSelect.addEventListener("change", (e) => {
    if (e.target.value) onNfcRead(e.target.value);
  });
}

init();
