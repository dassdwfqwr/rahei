function sendRuntimeMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function setMessage(text, kind = "") {
  const node = document.getElementById("message");
  node.textContent = text || "";
  node.className = `message ${kind}`.trim();
}

function renderSummary(summary) {
  const counts = summary?.counts || {};
  const queue = summary?.queue || {};
  const done = (counts.blocked || 0) + (counts.alreadyBlocked || 0);

  document.getElementById("totalCount").textContent = counts.total || 0;
  document.getElementById("doneCount").textContent = done;
  document.getElementById("failedCount").textContent = counts.failed || 0;

  const stateText = queue.running
    ? `恢复中: ${queue.currentId || "准备中"}`
    : queue.paused
      ? "已暂停"
      : "空闲";
  document.getElementById("queueState").textContent = stateText;
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

async function startRestore() {
  setMessage("正在启动恢复队列...");
  const response = await sendRuntimeMessage({ type: "START_RESTORE", mode: "pending" });
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

document.getElementById("scanButton").addEventListener("click", scanCurrentPage);
document.getElementById("startButton").addEventListener("click", startRestore);
document.getElementById("pauseButton").addEventListener("click", pauseRestore);

refresh();
setInterval(refresh, 2000);
