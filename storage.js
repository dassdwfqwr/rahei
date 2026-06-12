(function initMercariBlocklistStore(globalScope) {
  const STORAGE_KEYS = {
    users: "blockedUsers",
    tasks: "restoreTasks",
    queue: "restoreQueueState"
  };

  const TASK_STATUSES = {
    pending: "pending",
    processing: "processing",
    blocked: "blocked",
    alreadyBlocked: "alreadyBlocked",
    failed: "failed",
    skipped: "skipped"
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeUser(rawUser) {
    const id = String(rawUser?.id || "").trim();
    if (!id) return null;

    const url = rawUser.url || `https://jp.mercari.com/user/profile/${id}`;

    return {
      id,
      name: String(rawUser.name || "").trim(),
      url,
      imageUrl: rawUser.imageUrl || "",
      savedAt: rawUser.savedAt || nowIso(),
      updatedAt: rawUser.updatedAt || nowIso(),
      source: rawUser.source || "imported"
    };
  }

  function storageGet(keys) {
    return chrome.storage.local.get(keys);
  }

  function storageSet(values) {
    return chrome.storage.local.set(values);
  }

  async function getUsers() {
    const result = await storageGet({ [STORAGE_KEYS.users]: [] });
    return Array.isArray(result[STORAGE_KEYS.users]) ? result[STORAGE_KEYS.users] : [];
  }

  async function setUsers(users) {
    await storageSet({ [STORAGE_KEYS.users]: users });
    return users;
  }

  function mergeUsers(existingUsers, incomingUsers, source) {
    const byId = new Map();
    const timestamp = nowIso();

    for (const user of existingUsers || []) {
      const normalized = normalizeUser(user);
      if (normalized) byId.set(normalized.id, normalized);
    }

    let added = 0;
    let updated = 0;

    for (const user of incomingUsers || []) {
      const normalized = normalizeUser({
        ...user,
        source: source || user.source || "unknown"
      });
      if (!normalized) continue;

      const oldUser = byId.get(normalized.id);
      if (!oldUser) {
        added += 1;
        byId.set(normalized.id, {
          ...normalized,
          savedAt: normalized.savedAt || timestamp,
          updatedAt: timestamp
        });
      } else {
        updated += 1;
        byId.set(normalized.id, {
          ...oldUser,
          ...normalized,
          savedAt: oldUser.savedAt || normalized.savedAt || timestamp,
          updatedAt: timestamp
        });
      }
    }

    return {
      users: Array.from(byId.values()).sort((a, b) => (a.savedAt || "").localeCompare(b.savedAt || "")),
      added,
      updated
    };
  }

  async function mergeAndSaveUsers(incomingUsers, source) {
    const existingUsers = await getUsers();
    const merged = mergeUsers(existingUsers, incomingUsers, source);
    await setUsers(merged.users);
    return merged;
  }

  async function getTasks() {
    const result = await storageGet({ [STORAGE_KEYS.tasks]: {} });
    const tasks = result[STORAGE_KEYS.tasks];
    return tasks && typeof tasks === "object" && !Array.isArray(tasks) ? tasks : {};
  }

  async function setTasks(tasks) {
    await storageSet({ [STORAGE_KEYS.tasks]: tasks });
    return tasks;
  }

  async function upsertTask(id, patch) {
    const tasks = await getTasks();
    const oldTask = tasks[id] || {
      id,
      status: TASK_STATUSES.pending,
      attempts: 0,
      lastError: "",
      updatedAt: nowIso()
    };

    tasks[id] = {
      ...oldTask,
      ...patch,
      id,
      updatedAt: nowIso()
    };

    await setTasks(tasks);
    return tasks[id];
  }

  async function resetTasksForUsers(users, includeCompleted) {
    const tasks = await getTasks();
    const timestamp = nowIso();

    for (const user of users) {
      if (!user?.id) continue;
      const current = tasks[user.id];
      const isDone = current?.status === TASK_STATUSES.blocked || current?.status === TASK_STATUSES.alreadyBlocked;

      if (isDone && !includeCompleted) continue;

      tasks[user.id] = {
        id: user.id,
        status: TASK_STATUSES.pending,
        attempts: current?.attempts || 0,
        lastError: "",
        updatedAt: timestamp
      };
    }

    await setTasks(tasks);
    return tasks;
  }

  async function getQueueState() {
    const result = await storageGet({
      [STORAGE_KEYS.queue]: {
        running: false,
        paused: false,
        currentId: "",
        startedAt: "",
        updatedAt: ""
      }
    });

    return result[STORAGE_KEYS.queue];
  }

  async function setQueueState(queueState) {
    const nextState = {
      running: false,
      paused: false,
      currentId: "",
      startedAt: "",
      updatedAt: nowIso(),
      ...queueState
    };
    await storageSet({ [STORAGE_KEYS.queue]: nextState });
    return nextState;
  }

  async function getSummary() {
    const users = await getUsers();
    const tasks = await getTasks();
    const queue = await getQueueState();
    const counts = {
      total: users.length,
      pending: 0,
      processing: 0,
      blocked: 0,
      alreadyBlocked: 0,
      failed: 0,
      skipped: 0
    };

    for (const user of users) {
      const status = tasks[user.id]?.status || TASK_STATUSES.pending;
      if (counts[status] === undefined) counts[status] = 0;
      counts[status] += 1;
    }

    return { users, tasks, queue, counts };
  }

  globalScope.MercariBlocklistStore = {
    STORAGE_KEYS,
    TASK_STATUSES,
    getUsers,
    setUsers,
    mergeUsers,
    mergeAndSaveUsers,
    getTasks,
    setTasks,
    upsertTask,
    resetTasksForUsers,
    getQueueState,
    setQueueState,
    getSummary,
    normalizeUser,
    nowIso
  };
})(globalThis);
