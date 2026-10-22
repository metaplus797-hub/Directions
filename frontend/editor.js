const API_BASE = "";

const state = {
  nodes: [],
};

const el = {
  status: document.getElementById("status"),
  tableBody: document.querySelector("#nodeTable tbody"),
  addRowBtn: document.getElementById("addRowBtn"),
  saveBtn: document.getElementById("saveBtn"),
};

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `API error: ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function createBlankNode() {
  return {
    id: "",
    name: "",
    x: "",
    y: "",
    adjacent_point: "",
    is_destination: "FALSE",
    Floor: "F6",
    imageName: "",
  };
}

function renderTable() {
  if (!el.tableBody) return;

  el.tableBody.innerHTML = state.nodes
    .map((node, index) => {
      const isDestination = String(node.is_destination ?? "FALSE").toUpperCase() === "TRUE";
      return `
        <tr data-index="${index}">
          <td><input name="id" value="${escapeHtml(node.id)}" /></td>
          <td><input name="name" value="${escapeHtml(node.name)}" /></td>
          <td><input name="x" value="${escapeHtml(node.x)}" /></td>
          <td><input name="y" value="${escapeHtml(node.y)}" /></td>
          <td><input name="adjacent_point" value="${escapeHtml(node.adjacent_point)}" /></td>
          <td>
            <select name="is_destination">
              <option value="TRUE" ${isDestination ? "selected" : ""}>TRUE</option>
              <option value="FALSE" ${!isDestination ? "selected" : ""}>FALSE</option>
            </select>
          </td>
          <td><input name="Floor" value="${escapeHtml(node.Floor)}" /></td>
          <td><input name="imageName" value="${escapeHtml(node.imageName)}" /></td>
          <td><button class="delete-row-btn" type="button" data-index="${index}">削除</button></td>
        </tr>
      `;
    })
    .join("");

  attachInputHandlers();
  attachDeleteHandlers();
}

function isEmptyRow(row) {
  return Object.values(row).every((value) => String(value ?? "").trim() === "");
}

function attachInputHandlers() {
  const rows = el.tableBody.querySelectorAll("tr");
  rows.forEach((row) => {
    row.querySelectorAll("input, select").forEach((input) => {
      input.addEventListener("input", (event) => {
        const rowIndex = Number(row.dataset.index);
        const field = event.target.name;
        state.nodes[rowIndex][field] = event.target.value;
      });
      input.addEventListener("change", (event) => {
        const rowIndex = Number(row.dataset.index);
        const field = event.target.name;
        state.nodes[rowIndex][field] = event.target.value;
      });
    });
  });
}

function attachDeleteHandlers() {
  const deleteButtons = el.tableBody.querySelectorAll(".delete-row-btn");
  deleteButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      state.nodes.splice(index, 1);
      renderTable();
    });
  });
}

async function loadNodes() {
  try {
    const rows = await api("/api/editor/nodes");
    state.nodes = rows || [];
    renderTable();
    el.status.textContent = `${state.nodes.length} 件のノードを読み込みました。編集して保存してください。`;
  } catch (error) {
    el.status.textContent = `読み込みエラー: ${error.message}`;
    console.error(error);
  }
}

async function saveNodes() {
  try {
    const payload = state.nodes
      .filter((row) => !isEmptyRow(row))
      .map((row) => ({
        ...row,
        id: String(row.id ?? "").trim(),
        name: String(row.name ?? "").trim(),
        x: String(row.x ?? "").trim(),
        y: String(row.y ?? "").trim(),
        adjacent_point: String(row.adjacent_point ?? "").trim(),
        is_destination: String(row.is_destination ?? "FALSE").trim().toUpperCase(),
        Floor: String(row.Floor ?? "").trim(),
        imageName: String(row.imageName ?? "").trim(),
      }));

    const result = await api("/api/editor/nodes", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    el.status.textContent = `保存しました: ${result.count} 件 / ${result.path}`;
    await loadNodes();
  } catch (error) {
    el.status.textContent = `保存エラー: ${error.message}`;
    console.error(error);
  }
}

el.addRowBtn.addEventListener("click", () => {
  state.nodes.push(createBlankNode());
  renderTable();
});

el.saveBtn.addEventListener("click", () => saveNodes());

loadNodes();
