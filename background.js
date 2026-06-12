importScripts("storage.js");

const Store = globalThis.MercariBlocklistStore;

let restoreRunner = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRuntimeError() {
  return chrome.runtime.lastError?.message || "";
}

function sendMessageToTab(tabId, message, retries = 20) {
  return new Promise((resolve, reject) => {
    const attempt = (remaining) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const error = isRuntimeError();
        if (!error && response) {
          resolve(response);
          return;
        }

        if (remaining <= 0) {
          reject(new Error(error || "no_response"));
          return;
        }

        setTimeout(() => attempt(remaining - 1), 500);
      });
    };

    attempt(retries);
  });
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = isRuntimeError();
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve(tabs[0] || null);
    });
  });
}

function updateTab(tabId, updateProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProperties, (tab) => {
      const error = isRuntimeError();
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve(tab);
    });
  });
}

function waitForTabComplete(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const interval = setInterval(() => {
      chrome.tabs.get(tabId, (tab) => {
        const error = isRuntimeError();
        if (error) {
          clearInterval(interval);
          reject(new Error(error));
          return;
        }

        if (tab.status === "complete") {
          clearInterval(interval);
          resolve();
          return;
        }

        if (Date.now() - startedAt > timeout) {
          clearInterval(interval);
          reject(new Error("timeout:tab_load"));
        }
      });
    }, 500);
  });
}

async function scanCurrentTab() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new Error("active_tab_not_found");
  }

  const response = await sendMessageToTab(tab.id, { type: "SCAN_BLOCKED_USERS" });
  if (!response.ok) {
    throw new Error(response.error || "scan_failed");
  }

  const merged = await Store.mergeAndSaveUsers(response.users, "blocked_users_page");
  const reconciled = await reconcileTasksWithCurrentBlockedUsers(response.users);
  return {
    ok: true,
    ...reconciled,
    ...merged
  };
}

async function scanTabById(tabId) {
  const response = await sendMessageToTab(tabId, { type: "SCAN_BLOCKED_USERS" });
  if (!response.ok) {
    throw new Error(response.error || "scan_failed");
  }

  const merged = await Store.mergeAndSaveUsers(response.users, "blocked_users_page");
  const reconciled = await reconcileTasksWithCurrentBlockedUsers(response.users);
  return {
    ok: true,
    ...reconciled,
    ...merged
  };
}

async function reconcileTasksWithCurrentBlockedUsers(currentBlockedUsers) {
  const currentBlockedIds = new Set((currentBlockedUsers || []).map((user) => user.id).filter(Boolean));
  const users = await Store.getUsers();
  const pendingUsers = users.filter((user) => user?.id && !currentBlockedIds.has(user.id));

  await Store.resetTasksForUsers(pendingUsers, true);

  for (const user of users) {
    if (!currentBlockedIds.has(user.id)) continue;
    await Store.upsertTask(user.id, {
      status: Store.TASK_STATUSES.alreadyBlocked,
      lastError: ""
    });
  }

  return {
    currentBlockedCount: currentBlockedIds.size,
    pendingCount: pendingUsers.length
  };
}

async function scanCurrentAccountBlockedUsers(tabId) {
  await updateTab(tabId, { url: "https://jp.mercari.com/mypage/personal_info/blocked_users" });
  await waitForTabComplete(tabId, 45000);
  await sleep(1200);

  const response = await sendMessageToTab(tabId, { type: "SCAN_BLOCKED_USERS" }, 30);
  if (!response.ok) {
    throw new Error(response.error || "scan_failed");
  }

  await Store.mergeAndSaveUsers(response.users, "current_account_blocked_scan");
  return response.users || [];
}

async function reconcileCurrentAccountFromTab(tabId, startedAt) {
  const queueState = await Store.getQueueState();
  await Store.setQueueState({
    running: true,
    paused: queueState.paused === true,
    currentId: "复核当前账号",
    startedAt
  });

  const currentBlockedUsers = await scanCurrentAccountBlockedUsers(tabId);
  return reconcileTasksWithCurrentBlockedUsers(currentBlockedUsers);
}

async function goBlockedUsersPage() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new Error("active_tab_not_found");
  }

  await updateTab(tab.id, { url: "https://jp.mercari.com/mypage/personal_info/blocked_users" });
  await waitForTabComplete(tab.id, 45000);
  await sleep(1200);

  const scanned = await scanTabById(tab.id);
  return { ok: true, ...scanned };
}

async function oneClickCollect() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new Error("active_tab_not_found");
  }

  await updateTab(tab.id, { url: "https://jp.mercari.com/mypage/personal_info/blocked_users" });
  await waitForTabComplete(tab.id, 45000);
  await sleep(1200);

  return scanTabById(tab.id);
}

function buildRestoreCandidates(users, tasks, mode) {
  return users.filter((user) => {
    const status = tasks[user.id]?.status || Store.TASK_STATUSES.pending;

    if (mode === "failed") {
      return status === Store.TASK_STATUSES.failed;
    }

    if (mode === "all") {
      return true;
    }

    return status !== Store.TASK_STATUSES.blocked && status !== Store.TASK_STATUSES.alreadyBlocked;
  });
}

async function prepareAccountDiffRestoreQueue(tabId) {
  await Store.setQueueState({
    running: true,
    paused: false,
    currentId: "检查当前账号",
    startedAt: Store.nowIso()
  });

  const currentBlockedUsers = await scanCurrentAccountBlockedUsers(tabId);
  const currentBlockedIds = new Set(currentBlockedUsers.map((user) => user.id).filter(Boolean));
  const users = await Store.getUsers();
  const candidates = users.filter((user) => user?.id && !currentBlockedIds.has(user.id));

  await Store.resetTasksForUsers(candidates, true);

  for (const user of users) {
    if (!currentBlockedIds.has(user.id)) continue;
    await Store.upsertTask(user.id, {
      status: Store.TASK_STATUSES.alreadyBlocked,
      lastError: ""
    });
  }

  return candidates;
}

async function prepareRestoreQueue(tabId, mode = "pending") {
  if (mode === "pending" || mode === "accountDiff") {
    return prepareAccountDiffRestoreQueue(tabId);
  }

  const users = await Store.getUsers();
  const tasks = await Store.getTasks();
  const candidates = buildRestoreCandidates(users, tasks, mode);
  await Store.resetTasksForUsers(candidates, mode === "all");
  return candidates;
}

async function runRestoreQueue(tabId, mode) {
  const startedAt = Store.nowIso();
  await Store.setQueueState({
    running: true,
    paused: false,
    currentId: "准备中",
    startedAt
  });

  try {
    const candidates = await prepareRestoreQueue(tabId, mode);

    for (const user of candidates) {
      const queueState = await Store.getQueueState();
      if (!queueState.running || queueState.paused) break;
      const tasks = await Store.getTasks();

      await Store.upsertTask(user.id, {
        status: Store.TASK_STATUSES.processing,
        attempts: (tasks[user.id]?.attempts || 0) + 1,
        lastError: ""
      });

      await Store.setQueueState({
        running: true,
        paused: false,
        currentId: user.id,
        startedAt
      });

      try {
        await updateTab(tabId, { url: user.url || `https://jp.mercari.com/user/profile/${user.id}` });
        await waitForTabComplete(tabId, 45000);
        await sleep(1200);

        const response = await sendMessageToTab(tabId, { type: "BLOCK_CURRENT_PROFILE" }, 30);
        const status = response.status || (response.ok ? Store.TASK_STATUSES.blocked : Store.TASK_STATUSES.failed);
        const finalStatus = status === "alreadyBlocked" ? Store.TASK_STATUSES.alreadyBlocked : status;

        await Store.upsertTask(user.id, {
          status: response.ok ? finalStatus : Store.TASK_STATUSES.failed,
          lastError: response.ok ? "" : response.error || "unknown"
        });

        if (response.profile) {
          await Store.mergeAndSaveUsers([response.profile], "profile_page");
        }
      } catch (error) {
        await Store.upsertTask(user.id, {
          status: Store.TASK_STATUSES.failed,
          lastError: error.message || "unknown"
        });
      }

      await sleep(800);
    }
  } finally {
    try {
      await reconcileCurrentAccountFromTab(tabId, startedAt);
    } catch (error) {
      // Final reconciliation is best-effort. The per-user result is still kept if the list cannot be scanned.
    }

    const latestQueueState = await Store.getQueueState();
    await Store.setQueueState({
      running: false,
      paused: latestQueueState.paused === true,
      currentId: "",
      startedAt
    });

    restoreRunner = null;
  }
}

async function startRestore(message) {
  if (restoreRunner) {
    return { ok: true, alreadyRunning: true, summary: await Store.getSummary() };
  }

  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new Error("active_tab_not_found");
  }

  restoreRunner = runRestoreQueue(tab.id, message.mode || "pending");
  restoreRunner.catch(() => {
    restoreRunner = null;
  });

  return { ok: true, summary: await Store.getSummary() };
}

async function pauseRestore() {
  await Store.setQueueState({
    ...(await Store.getQueueState()),
    running: false,
    paused: true
  });
  return { ok: true, summary: await Store.getSummary() };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "GET_SUMMARY") {
      return { ok: true, summary: await Store.getSummary() };
    }

    if (message?.type === "GET_EXPORT_DATA") {
      return {
        ok: true,
        data: {
          app: "mercari-blocklist-backup",
          version: 1,
          exportedAt: Store.nowIso(),
          users: await Store.getUsers()
        }
      };
    }

    if (message?.type === "SCAN_CURRENT_TAB") {
      const result = await scanCurrentTab();
      return { ok: true, result, summary: await Store.getSummary() };
    }

    if (message?.type === "ONE_CLICK_COLLECT") {
      const result = await oneClickCollect();
      return { ok: true, result, summary: await Store.getSummary() };
    }

    if (message?.type === "GO_BLOCKED_USERS_PAGE") {
      const result = await goBlockedUsersPage();
      return { ok: true, result, summary: await Store.getSummary() };
    }

    if (message?.type === "IMPORT_USERS") {
      const merged = await Store.mergeAndSaveUsers(message.users || [], "imported_json");
      return { ok: true, result: merged, summary: await Store.getSummary() };
    }

    if (message?.type === "START_RESTORE") {
      return startRestore(message);
    }

    if (message?.type === "PAUSE_RESTORE") {
      return pauseRestore();
    }

    if (message?.type === "RESET_TASKS") {
      const users = await Store.getUsers();
      await Store.resetTasksForUsers(users, message.includeCompleted === true);
      return { ok: true, summary: await Store.getSummary() };
    }

    throw new Error("unknown_message");
  })()
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: error.message || "unknown" });
    });

  return true;
});
