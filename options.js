let lastSummary = null;

function sendRuntimeMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function setMessage(text, kind = "") {
  const node = document.getElementById("message");
  node.textContent = text || "";
  node.className = `message ${kind}`.trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusLabel(status) {
  const labels = {
    pending: "待处理",
    processing: "处理中",
    blocked: "已拉黑",
    alreadyBlocked: "已存在",
    failed: "失败",
    skipped: "跳过"
  };
  return labels[status] || status || "待处理";
}

function renderSummary(summary) {
  lastSummary = summary;
  const counts = summary?.counts || {};
  const queue = summary?.queue || {};
  const users = summary?.users || [];
  const tasks = summary?.tasks || {};

  document.getElementById("totalCount").textContent = counts.total || 0;
  document.getElementById("pendingCount").textContent = counts.pending || 0;
  document.getElementById("processingCount").textContent = counts.processing || 0;
  document.getElementById("blockedCount").textContent = counts.blocked || 0;
  document.getElementById("alreadyCount").textContent = counts.alreadyBlocked || 0;
  document.getElementById("failedCount").textContent = counts.failed || 0;

  document.getElementById("queueState").textContent = queue.running
    ? `恢复中: ${queue.currentId || "准备中"}`
    : queue.paused
      ? "已暂停"
      : "空闲";

  document.getElementById("userRows").innerHTML = users.map((user) => {
    const task = tasks[user.id] || { status: "pending", lastError: "" };
    const avatar = user.imageUrl
      ? `<img class="avatar" src="${escapeHtml(user.imageUrl)}" alt="">`
      : '<div class="avatar"></div>';

    return `
      <tr>
        <td>${avatar}</td>
        <td><a href="${escapeHtml(user.url)}" target="_blank">${escapeHtml(user.name || "(no name)")}</a></td>
        <td>${escapeHtml(user.id)}</td>
        <td><span class="status ${escapeHtml(task.status)}">${escapeHtml(statusLabel(task.status))}</span></td>
        <td>${escapeHtml(task.lastError || "")}</td>
      </tr>
    `;
  }).join("");
}

async function refresh() {
  const response = await sendRuntimeMessage({ type: "GET_SUMMARY" });
  if (response.ok) renderSummary(response.summary);
}

async function scanCurrentPage() {
  setMessage("正在扫描当前页...");
  const response = await sendRuntimeMessage({ type: "SCAN_CURRENT_TAB" });
  if (!response.ok) {
    setMessage(`扫描失败: ${response.error}`, "bad");
    return;
  }
  renderSummary(response.summary);
  setMessage(`新增 ${response.result.added} 个，更新 ${response.result.updated} 个`, "ok");
}

async function startRestore(mode) {
  setMessage(mode === "failed" ? "正在重试失败项..." : "正在启动恢复队列...");
  const response = await sendRuntimeMessage({ type: "START_RESTORE", mode });
  if (!response.ok) {
    setMessage(`启动失败: ${response.error}`, "bad");
    return;
  }
  renderSummary(response.summary);
  setMessage(response.alreadyRunning ? "恢复队列已在运行" : "恢复队列已启动", "ok");
}

async function pauseRestore() {
  const response = await sendRuntimeMessage({ type: "PAUSE_RESTORE" });
  if (!response.ok) {
    setMessage(`暂停失败: ${response.error}`, "bad");
    return;
  }
  renderSummary(response.summary);
  setMessage("已暂停", "ok");
}

async function resetTasks() {
  const response = await sendRuntimeMessage({ type: "RESET_TASKS", includeCompleted: false });
  if (!response.ok) {
    setMessage(`重置失败: ${response.error}`, "bad");
    return;
  }
  renderSummary(response.summary);
  setMessage("未完成任务已重置", "ok");
}

function exportJson() {
  const users = lastSummary?.users || [];
  const payload = {
    app: "mercari-blocklist-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    users
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mercari-blocklist-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importJson(file) {
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const users = Array.isArray(parsed) ? parsed : parsed.users;

    if (!Array.isArray(users)) {
      throw new Error("json_users_not_found");
    }

    const response = await sendRuntimeMessage({ type: "IMPORT_USERS", users });
    if (!response.ok) {
      throw new Error(response.error || "import_failed");
    }

    renderSummary(response.summary);
    setMessage(`导入完成: 新增 ${response.result.added} 个，更新 ${response.result.updated} 个`, "ok");
  } catch (error) {
    setMessage(`导入失败: ${error.message}`, "bad");
  }
}

document.getElementById("scanButton").addEventListener("click", scanCurrentPage);
document.getElementById("startButton").addEventListener("click", () => startRestore("pending"));
document.getElementById("retryFailedButton").addEventListener("click", () => startRestore("failed"));
document.getElementById("pauseButton").addEventListener("click", pauseRestore);
document.getElementById("resetButton").addEventListener("click", resetTasks);
document.getElementById("exportButton").addEventListener("click", exportJson);
document.getElementById("importInput").addEventListener("change", (event) => importJson(event.target.files[0]));

refresh();
setInterval(refresh, 2000);
