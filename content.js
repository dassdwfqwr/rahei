(function initMercariBlocklistContent() {
  const PROFILE_URL_RE = /\/user\/profile\/(\d+)/;
  const BLOCKED_LIST_PATH = "/mypage/personal_info/blocked_users";
  const WAIT_INTERVAL_MS = 250;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getCurrentUserId() {
    return location.pathname.match(PROFILE_URL_RE)?.[1] || "";
  }

  function isBlockedUsersPage() {
    return location.pathname === BLOCKED_LIST_PATH;
  }

  function isProfilePage() {
    return PROFILE_URL_RE.test(location.pathname);
  }

  function cleanText(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  async function waitForCondition(check, timeout = 15000, reason = "condition") {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
      const value = check();
      if (value) return value;
      await sleep(WAIT_INTERVAL_MS);
    }

    throw new Error(`timeout:${reason}`);
  }

  function extractBlockedUsers() {
    const list = document.querySelector('[data-testid="blocked-account-list"]');
    if (!list) {
      return {
        foundList: false,
        users: []
      };
    }

    const seen = new Set();
    const users = [...list.querySelectorAll('a[href^="/user/profile/"], a[href*="/user/profile/"]')]
      .map((link) => {
        const url = new URL(link.getAttribute("href"), location.origin).href;
        const id = url.match(PROFILE_URL_RE)?.[1] || "";
        const name = cleanText(link.querySelector("p")?.textContent || link.textContent);
        const imageUrl = link.querySelector("img")?.src || "";

        return {
          id,
          name,
          url,
          imageUrl,
          source: "blocked_users_page"
        };
      })
      .filter((user) => user.id && !seen.has(user.id) && seen.add(user.id));

    return {
      foundList: true,
      users
    };
  }

  async function scanBlockedUsersPage() {
    if (!isBlockedUsersPage()) {
      return {
        ok: false,
        error: "not_blocked_users_page",
        users: []
      };
    }

    const startedAt = Date.now();
    await waitForCondition(
      () => {
        const text = document.body?.innerText || "";
        return (
          document.querySelector('[data-testid="blocked-account-list"]') ||
          text.includes("ブロックした一覧") ||
          text.includes("ブロックしたユーザー") ||
          (document.readyState === "complete" && Date.now() - startedAt > 5000)
        );
      },
      20000,
      "blocked_list"
    );

    const result = extractBlockedUsers();
    if (!result.foundList) {
      return {
        ok: true,
        error: "",
        users: []
      };
    }

    return {
      ok: true,
      error: "",
      users: result.users
    };
  }

  function getProfileInfo() {
    const userId = getCurrentUserId();
    const root = document.querySelector('[data-testid="profile-info"]') || document.querySelector("main") || document.body;
    const name = cleanText(root?.querySelector('[data-testid="mer-profile-heading"] h1')?.textContent || document.querySelector("h1")?.textContent);
    const imageUrl = root?.querySelector('[data-testid="mer-avatar"] img')?.src || "";

    return {
      id: userId,
      name,
      url: userId ? `https://jp.mercari.com/user/profile/${userId}` : location.href,
      imageUrl
    };
  }

  function getBlockState() {
    const profileRoot = document.querySelector('[data-testid="profile-info"]') || document.body;
    const text = profileRoot?.innerText || document.body?.innerText || "";

    if (text.includes("ブロック中") || text.includes("ブロックを解除")) {
      return "blocked";
    }

    if (text.includes("このユーザーをブロック")) {
      return "not_blocked";
    }

    return "unknown";
  }

  function getUserActionMenuButton() {
    return (
      document.querySelector('[data-testid="user-actions-menu-button"] button') ||
      [...document.querySelectorAll("button")].find((button) => cleanText(button.getAttribute("aria-label")).includes("メニュー"))
    );
  }

  function findButtonByText(text) {
    return [...document.querySelectorAll("button")]
      .find((button) => cleanText(button.textContent).includes(text));
  }

  function getBlockActionButton() {
    return (
      [...document.querySelectorAll('[data-testid="merActionRow"] button')]
        .find((button) => cleanText(button.textContent).includes("このユーザーをブロック")) ||
      findButtonByText("このユーザーをブロック")
    );
  }

  function getUnblockActionButton() {
    return (
      [...document.querySelectorAll('[data-testid="merActionRow"] button')]
        .find((button) => cleanText(button.textContent).includes("ブロックを解除")) ||
      findButtonByText("ブロックを解除")
    );
  }

  function clickMercariElement(element) {
    if (!element) return;
    element.scrollIntoView?.({ block: "center", inline: "nearest" });
    element.focus?.();
    const events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
    for (const type of events) {
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    if (typeof element.click === "function") {
      element.click();
    }
  }

  async function openUserActionMenu() {
    const menuButton = await waitForCondition(getUserActionMenuButton, 20000, "menu_button");
    clickMercariElement(menuButton);

    await waitForCondition(
      () => getBlockActionButton() || getUnblockActionButton() || document.body?.innerText.includes("このユーザーを報告"),
      10000,
      "menu_actions"
    );
  }

  async function clickConfirmationIfPresent() {
    const confirmTexts = ["ブロックする", "はい", "OK"];
    const cancelTexts = ["キャンセル", "閉じる"];

    for (let i = 0; i < 20; i += 1) {
      const buttons = [...document.querySelectorAll("button")];
      const confirmButton = buttons.find((button) => {
        const text = cleanText(button.textContent);
        return confirmTexts.some((label) => text === label || text.includes(label));
      });
      const cancelButton = buttons.find((button) => {
        const text = cleanText(button.textContent);
        return cancelTexts.some((label) => text === label || text.includes(label));
      });

      if (confirmButton && cancelButton) {
        clickMercariElement(confirmButton);
        return true;
      }

      await sleep(150);
    }

    return false;
  }

  async function blockCurrentProfile() {
    if (!isProfilePage()) {
      return {
        ok: false,
        status: "failed",
        error: "not_profile_page",
        profile: getProfileInfo()
      };
    }

    await waitForCondition(
      () => document.querySelector('[data-testid="profile-info"]') || getCurrentUserId(),
      20000,
      "profile_info"
    );

    const profile = getProfileInfo();
    if (!profile.id) {
      return {
        ok: false,
        status: "failed",
        error: "profile_not_found",
        profile
      };
    }

    await openUserActionMenu();

    if (getUnblockActionButton() || getBlockState() === "blocked") {
      return {
        ok: true,
        status: "alreadyBlocked",
        error: "",
        profile
      };
    }

    const blockButton = getBlockActionButton();
    if (!blockButton) {
      return {
        ok: false,
        status: "failed",
        error: "block_button_not_found",
        profile
      };
    }

    clickMercariElement(blockButton);
    await sleep(300);
    await clickConfirmationIfPresent();

    try {
      await waitForCondition(
        () => getBlockState() === "blocked" || document.body?.innerText.includes("ブロックしました"),
        12000,
        "blocked_state"
      );
    } catch (error) {
      return {
        ok: false,
        status: "failed",
        error: "confirm_failed",
        profile
      };
    }

    return {
      ok: true,
      status: "blocked",
      error: "",
      profile
    };
  }

  function getPageState() {
    return {
      url: location.href,
      path: location.pathname,
      isBlockedUsersPage: isBlockedUsersPage(),
      isProfilePage: isProfilePage(),
      userId: getCurrentUserId(),
      blockState: isProfilePage() ? getBlockState() : "unknown"
    };
  }

  function isExtensionContextInvalidated(error) {
    return String(error?.message || error || "").includes("Extension context invalidated");
  }

  function showExtensionReloadNotice() {
    const message = document.querySelector("#mbb-panel [data-mbb-message]");
    const state = document.querySelector("#mbb-panel [data-mbb-state]");
    if (message) {
      message.textContent = "扩展已重新加载，请刷新当前 Mercari 页面。";
      message.className = "mbb-message bad";
    }
    if (state) {
      state.textContent = "需要刷新页面";
    }
  }

  async function runtimeMessage(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        showExtensionReloadNotice();
        return { ok: false, error: "扩展已重新加载，请刷新当前 Mercari 页面。" };
      }
      throw error;
    }
  }

  async function storageGet(values) {
    try {
      return await chrome.storage.local.get(values);
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        showExtensionReloadNotice();
        return values || {};
      }
      throw error;
    }
  }

  async function storageSet(values) {
    try {
      return await chrome.storage.local.set(values);
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        showExtensionReloadNotice();
        return null;
      }
      throw error;
    }
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

  function injectFloatingStyles() {
    if (document.getElementById("mbb-floating-styles")) return;

    const style = document.createElement("style");
    style.id = "mbb-floating-styles";
    style.textContent = `
      #mbb-fab {
        position: fixed;
        right: max(14px, env(safe-area-inset-right));
        bottom: calc(88px + env(safe-area-inset-bottom));
        z-index: 2147483647;
        width: 52px;
        height: 52px;
        border: 0;
        border-radius: 18px;
        background: rgba(255, 59, 48, 0.96);
        color: #fff;
        box-shadow: 0 14px 32px rgba(255, 59, 48, 0.28), 0 6px 18px rgba(0, 0, 0, 0.16);
        font: 700 14px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
        letter-spacing: 0;
      }

      #mbb-panel {
        position: fixed;
        left: max(10px, env(safe-area-inset-left));
        right: max(10px, env(safe-area-inset-right));
        bottom: max(10px, env(safe-area-inset-bottom));
        z-index: 2147483647;
        display: none;
        height: 45vh;
        max-height: calc(100vh - 22px);
        margin-left: auto;
        border: 1px solid rgba(60, 60, 67, 0.16);
        border-radius: 28px;
        background: rgba(248, 248, 250, 0.86);
        color: #1d1d1f;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.22);
        font: 14px/1.42 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
        overflow: hidden;
        touch-action: none;
        backdrop-filter: blur(24px) saturate(1.45);
        -webkit-backdrop-filter: blur(24px) saturate(1.45);
      }

      #mbb-panel.open {
        display: flex;
        flex-direction: column;
      }

      #mbb-panel[data-size="mini"] {
        height: 28vh;
      }

      #mbb-panel[data-size="normal"] {
        height: 45vh;
      }

      #mbb-panel[data-size="large"] {
        height: 75vh;
      }

      .mbb-grabber {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 22px;
        cursor: ns-resize;
        touch-action: none;
      }

      .mbb-grabber::before {
        content: "";
        width: 44px;
        height: 4px;
        border-radius: 999px;
        background: rgba(60, 60, 67, 0.22);
      }

      .mbb-head {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 2px 22px 16px;
        border-bottom: 1px solid rgba(60, 60, 67, 0.12);
      }

      .mbb-title {
        margin: 0;
        font-size: 22px;
        font-weight: 750;
        line-height: 1.2;
        letter-spacing: 0;
      }

      .mbb-close {
        width: 38px;
        height: 38px;
        border: 1px solid rgba(60, 60, 67, 0.14);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.72);
        color: #1d1d1f;
        font-size: 18px;
      }

      .mbb-body {
        display: grid;
        flex: 1 1 auto;
        gap: 14px;
        padding: 16px 22px 22px;
        overflow: auto;
        overscroll-behavior: contain;
      }

      .mbb-view {
        display: none;
      }

      .mbb-view.open {
        display: grid;
        gap: 14px;
      }

      .mbb-local-head {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .mbb-back {
        width: 38px;
        min-height: 34px;
        border-radius: 12px;
        padding: 0;
      }

      .mbb-local-title {
        display: grid;
        gap: 2px;
      }

      .mbb-local-title strong {
        font-size: 17px;
      }

      .mbb-local-title span {
        color: rgba(60, 60, 67, 0.62);
        font-size: 12px;
        font-weight: 600;
      }

      .mbb-stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 1px;
        overflow: hidden;
        border: 1px solid rgba(60, 60, 67, 0.14);
        border-radius: 18px;
        background: rgba(60, 60, 67, 0.13);
      }

      .mbb-stat {
        min-width: 0;
        border: 0;
        border-radius: 0;
        padding: 13px 16px;
        background: rgba(255, 255, 255, 0.76);
      }

      .mbb-stat span {
        display: block;
        color: rgba(60, 60, 67, 0.72);
        font-size: 13px;
        font-weight: 600;
      }

      .mbb-stat strong {
        display: block;
        margin-top: 4px;
        font-size: 24px;
        line-height: 1.08;
        font-weight: 760;
      }

      .mbb-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .mbb-actions .mbb-btn:first-child {
        grid-column: 1 / -1;
      }

      .mbb-primary-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }

      .mbb-action-card {
        min-height: 74px;
        border: 0;
        border-radius: 20px;
        color: #fff;
        text-align: left;
        padding: 14px 15px;
        font: inherit;
        box-shadow: 0 14px 28px rgba(0, 0, 0, 0.14);
      }

      .mbb-action-card strong,
      .mbb-action-card span {
        display: block;
      }

      .mbb-action-card strong {
        font-size: 17px;
        line-height: 1.2;
        font-weight: 780;
      }

      .mbb-action-card span {
        margin-top: 6px;
        color: rgba(255, 255, 255, 0.82);
        font-size: 12px;
        font-weight: 600;
      }

      .mbb-action-card.collect {
        background: linear-gradient(135deg, #0a84ff, #55befc);
      }

      .mbb-action-card.block {
        background: linear-gradient(135deg, #ff3b30, #ff6b5f);
      }

      .mbb-group {
        overflow: hidden;
        border: 1px solid rgba(60, 60, 67, 0.12);
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.66);
      }

      .mbb-group .mbb-btn {
        width: 100%;
        justify-content: space-between;
        border: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
      }

      .mbb-group .mbb-btn + .mbb-btn {
        border-top: 1px solid rgba(60, 60, 67, 0.1);
      }

      .mbb-btn {
        min-height: 42px;
        border: 1px solid rgba(60, 60, 67, 0.14);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.74);
        color: #1d1d1f;
        font: inherit;
        font-weight: 720;
        letter-spacing: 0;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
      }

      .mbb-btn.primary {
        border-color: rgba(255, 59, 48, 0.92);
        background: #0a84ff;
        color: #fff;
      }

      .mbb-btn.danger {
        border-color: rgba(28, 28, 30, 0.92);
        background: #1c1c1e;
        color: #fff;
      }

      .mbb-btn.secondary {
        border-color: rgba(10, 132, 255, 0.22);
        background: rgba(10, 132, 255, 0.08);
        color: #006edb;
      }

      .mbb-btn.quiet {
        border-color: rgba(60, 60, 67, 0.14);
        background: rgba(255, 255, 255, 0.72);
        color: #1d1d1f;
      }

      .mbb-btn.warn {
        border-color: rgba(255, 149, 0, 0.25);
        background: rgba(255, 204, 0, 0.16);
        color: #7a4f00;
      }

      .mbb-btn.strong {
        min-height: 58px;
        font-size: 16px;
        box-shadow: 0 12px 24px rgba(0, 0, 0, 0.12);
      }

      .mbb-section-label {
        color: rgba(60, 60, 67, 0.68);
        font-size: 13px;
        font-weight: 650;
        margin-top: 4px;
      }

      .mbb-btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }

      .mbb-action-card:disabled {
        opacity: 0.55;
        cursor: not-allowed;
        box-shadow: none;
      }

      .mbb-sub-actions {
        display: flex;
        gap: 10px;
      }

      .mbb-sub-actions .mbb-btn {
        flex: 1;
        min-height: 40px;
        font-weight: 500;
      }

      .mbb-data-actions {
        display: none;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        padding: 12px;
        border: 1px solid rgba(60, 60, 67, 0.12);
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.6);
      }

      .mbb-data-actions.open {
        display: grid;
      }

      .mbb-textbox {
        display: none;
        width: 100%;
        min-height: 110px;
        border: 1px solid rgba(60, 60, 67, 0.14);
        border-radius: 14px;
        padding: 10px;
        color: #1d1d1f;
        background: rgba(255, 255, 255, 0.78);
        font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }

      .mbb-textbox.open {
        display: block;
      }

      .mbb-local-list {
        overflow: hidden;
        border: 1px solid rgba(60, 60, 67, 0.12);
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.66);
      }

      .mbb-local-row {
        display: grid;
        grid-template-columns: 34px 1fr auto;
        gap: 10px;
        align-items: center;
        min-height: 48px;
        padding: 9px 12px;
      }

      .mbb-local-row + .mbb-local-row {
        border-top: 1px solid rgba(60, 60, 67, 0.1);
      }

      .mbb-local-avatar {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        object-fit: cover;
        background: rgba(118, 118, 128, 0.16);
      }

      .mbb-local-name {
        min-width: 0;
        font-size: 13px;
        font-weight: 720;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .mbb-local-id {
        color: rgba(60, 60, 67, 0.62);
        font-size: 11px;
        white-space: nowrap;
      }

      .mbb-local-status {
        border-radius: 999px;
        padding: 3px 8px;
        background: rgba(118, 118, 128, 0.12);
        color: rgba(60, 60, 67, 0.68);
        font-size: 11px;
        font-weight: 700;
      }

      .mbb-local-empty {
        padding: 14px;
        color: rgba(60, 60, 67, 0.62);
        font-size: 13px;
      }

      .mbb-state,
      .mbb-message {
        color: #687076;
        font-size: 13px;
        word-break: break-word;
      }

      .mbb-state {
        display: inline-flex;
        align-items: center;
        width: fit-content;
        max-width: 100%;
        min-height: 34px;
        padding: 6px 13px;
        border-radius: 999px;
        background: rgba(118, 118, 128, 0.12);
        color: rgba(60, 60, 67, 0.72);
        font-weight: 600;
      }

      .mbb-message {
        min-height: 20px;
      }

      .mbb-message.ok {
        color: #1a7f37;
      }

      .mbb-message.bad {
        color: #cf222e;
      }

      @media (min-width: 720px) {
        #mbb-panel {
          left: auto;
          right: 18px;
          width: 440px;
        }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function createFloatingPanel() {
    if (document.getElementById("mbb-fab")) return;

    injectFloatingStyles();

    const button = document.createElement("button");
    button.id = "mbb-fab";
    button.type = "button";
    button.textContent = "拉黑";

    const panel = document.createElement("section");
    panel.id = "mbb-panel";
    panel.dataset.size = "normal";
    panel.innerHTML = `
      <div class="mbb-grabber" data-mbb-grabber aria-label="拖动调整高度"></div>
      <div class="mbb-head">
        <h2 class="mbb-title">Mercari 拉黑工具</h2>
        <button class="mbb-close" type="button" aria-label="关闭">×</button>
      </div>
      <div class="mbb-body">
        <div class="mbb-view open" data-mbb-view="main">
          <div class="mbb-stats">
            <div class="mbb-stat"><span>名单</span><strong data-mbb-total>0</strong></div>
            <div class="mbb-stat"><span>完成</span><strong data-mbb-done>0</strong></div>
            <div class="mbb-stat"><span>失败</span><strong data-mbb-failed>0</strong></div>
          </div>
          <div class="mbb-state" data-mbb-state>读取中</div>
          <div class="mbb-primary-actions">
            <button class="mbb-action-card collect" type="button" data-mbb-one-collect>
              <strong>一键采集</strong>
              <span>同步已拉黑名单</span>
            </button>
            <button class="mbb-action-card block" type="button" data-mbb-one-restore>
              <strong>一键拉黑</strong>
              <span>按缓存自动处理</span>
            </button>
          </div>
          <div class="mbb-section-label">手动步骤</div>
          <div class="mbb-actions mbb-group">
            <button class="mbb-btn quiet" type="button" data-mbb-go>跳转到拉黑界面</button>
            <button class="mbb-btn secondary" type="button" data-mbb-restore>批量拉黑</button>
            <button class="mbb-btn quiet" type="button" data-mbb-scan>采集拉黑数据</button>
          </div>
          <div class="mbb-sub-actions">
            <button class="mbb-btn warn" type="button" data-mbb-pause>暂停</button>
            <button class="mbb-btn quiet" type="button" data-mbb-refresh>查看进度</button>
          </div>
          <button class="mbb-btn quiet" type="button" data-mbb-local-toggle>本地名单</button>
          <button class="mbb-btn quiet" type="button" data-mbb-data-toggle>数据管理：导入 / 导出</button>
          <div class="mbb-data-actions" data-mbb-data-actions>
            <button class="mbb-btn secondary" type="button" data-mbb-export-file>导出 JSON</button>
            <button class="mbb-btn quiet" type="button" data-mbb-copy-json>复制 JSON</button>
            <button class="mbb-btn secondary" type="button" data-mbb-import-file>导入 JSON</button>
            <button class="mbb-btn quiet" type="button" data-mbb-paste-toggle>粘贴导入</button>
          </div>
          <input type="file" accept="application/json,.json" data-mbb-import-input hidden>
          <textarea class="mbb-textbox" data-mbb-copy-fallback readonly></textarea>
          <textarea class="mbb-textbox" data-mbb-paste-box placeholder="把 JSON 粘贴到这里"></textarea>
          <button class="mbb-btn secondary" type="button" data-mbb-paste-import hidden>导入粘贴内容</button>
          <div class="mbb-message" data-mbb-message></div>
        </div>
        <div class="mbb-view" data-mbb-view="local">
          <div class="mbb-local-head">
            <button class="mbb-btn quiet mbb-back" type="button" data-mbb-local-back>‹</button>
            <div class="mbb-local-title">
              <strong>本地名单</strong>
              <span data-mbb-local-count>插件缓存的拉黑用户</span>
            </div>
          </div>
          <div class="mbb-local-list" data-mbb-local-list></div>
        </div>
      </div>
    `;

    document.body.appendChild(button);
    document.body.appendChild(panel);

    const setMessage = (text, kind = "") => {
      const message = panel.querySelector("[data-mbb-message]");
      if (!message) return;
      message.textContent = text || "";
      message.className = `mbb-message ${kind}`.trim();
    };

    const setView = (name) => {
      for (const view of panel.querySelectorAll("[data-mbb-view]")) {
        view.classList.toggle("open", view.dataset.mbbView === name);
      }
    };

    const setPanelOpen = async (isOpen) => {
      panel.classList.toggle("open", isOpen);
      await storageSet({ mbbPanelOpen: isOpen });
      if (isOpen) {
        await refreshSummary();
      }
    };

    const setPanelSize = async (size) => {
      panel.dataset.size = size;
      await storageSet({ mbbPanelSize: size });
    };

    const getNearestPanelSize = () => {
      const vh = window.innerHeight || document.documentElement.clientHeight || 1;
      const ratio = panel.getBoundingClientRect().height / vh;
      const sizes = [
        { name: "mini", value: 0.28 },
        { name: "normal", value: 0.45 },
        { name: "large", value: 0.75 }
      ];
      return sizes.reduce((best, item) => (
        Math.abs(item.value - ratio) < Math.abs(best.value - ratio) ? item : best
      ), sizes[0]).name;
    };

    const setPanelDragHeight = (heightPx) => {
      const minHeight = Math.max(190, window.innerHeight * 0.24);
      const maxHeight = Math.max(minHeight, window.innerHeight * 0.82);
      const nextHeight = Math.min(maxHeight, Math.max(minHeight, heightPx));
      panel.style.height = `${Math.round(nextHeight)}px`;
    };

    const finishPanelDrag = async () => {
      const nextSize = getNearestPanelSize();
      panel.style.height = "";
      await setPanelSize(nextSize);
    };

    const getTaskLabel = (status) => {
      const labels = {
        pending: "待处理",
        processing: "处理中",
        blocked: "已拉黑",
        alreadyBlocked: "已存在",
        failed: "失败",
        skipped: "跳过"
      };
      return labels[status] || status || "待处理";
    };

    const escapeHtml = (value) => String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

    const renderLocalList = (summary) => {
      const list = panel.querySelector("[data-mbb-local-list]");
      const users = summary?.users || [];
      const tasks = summary?.tasks || {};
      panel.querySelector("[data-mbb-local-count]").textContent = `${users.length} 个缓存用户`;

      if (!users.length) {
        list.innerHTML = '<div class="mbb-local-empty">本地还没有缓存名单。先采集或导入 JSON。</div>';
        return;
      }

      const rows = users.slice(0, 30).map((user) => {
        const task = tasks[user.id] || { status: "pending" };
        const errorText = task.status === "failed" && task.lastError
          ? `<div class="mbb-local-id">失败原因: ${escapeHtml(task.lastError)}</div>`
          : "";
        const avatar = user.imageUrl
          ? `<img class="mbb-local-avatar" src="${escapeHtml(user.imageUrl)}" alt="">`
          : '<div class="mbb-local-avatar"></div>';

        return `
          <div class="mbb-local-row">
            ${avatar}
            <div>
              <div class="mbb-local-name">${escapeHtml(user.name || "(no name)")}</div>
              <div class="mbb-local-id">${escapeHtml(user.id)}</div>
              ${errorText}
            </div>
            <span class="mbb-local-status">${escapeHtml(getTaskLabel(task.status))}</span>
          </div>
        `;
      }).join("");

      const more = users.length > 30
        ? `<div class="mbb-local-empty">还有 ${users.length - 30} 个未显示，可导出 JSON 查看完整名单。</div>`
        : "";
      list.innerHTML = rows + more;
    };

    const renderSummary = (summary) => {
      const counts = summary?.counts || {};
      const queue = summary?.queue || {};
      const isRunning = queue.running === true;
      const done = (counts.blocked || 0) + (counts.alreadyBlocked || 0);
      panel.querySelector("[data-mbb-total]").textContent = counts.total || 0;
      panel.querySelector("[data-mbb-done]").textContent = done;
      panel.querySelector("[data-mbb-failed]").textContent = counts.failed || 0;
      panel.querySelector("[data-mbb-state]").textContent = queue.running
        ? `恢复中: ${queue.currentId || "准备中"}`
        : queue.paused
          ? "已暂停"
          : `空闲，当前页: ${isBlockedUsersPage() ? "拉黑列表" : isProfilePage() ? "用户主页" : "Mercari"}`;
      for (const selector of [
        "[data-mbb-one-collect]",
        "[data-mbb-one-restore]",
        "[data-mbb-go]",
        "[data-mbb-restore]",
        "[data-mbb-scan]",
        "[data-mbb-import-file]",
        "[data-mbb-paste-toggle]",
        "[data-mbb-paste-import]"
      ]) {
        const control = panel.querySelector(selector);
        if (control) control.disabled = isRunning;
      }
      if (panel.querySelector('[data-mbb-view="local"]').classList.contains("open")) {
        renderLocalList(summary);
      }
    };

    const refreshSummary = async () => {
      const response = await runtimeMessage({ type: "GET_SUMMARY" });
      if (response.ok) renderSummary(response.summary);
    };

    button.addEventListener("click", async () => {
      await setPanelOpen(!panel.classList.contains("open"));
    });

    panel.querySelector(".mbb-close").addEventListener("click", () => {
      setPanelOpen(false).catch(() => {});
    });

    panel.querySelector("[data-mbb-go]").addEventListener("click", async () => {
      setMessage("正在跳转并检测当前账号拉黑列表...");
      const response = await runtimeMessage({ type: "GO_BLOCKED_USERS_PAGE" });
      if (!response.ok) {
        setMessage(`跳转失败: ${response.error}`, "bad");
        return;
      }
      renderSummary(response.summary);
      setMessage(`已检测当前账号：已拉黑 ${response.result.currentBlockedCount || 0} 个`, "ok");
    });

    panel.querySelector("[data-mbb-one-collect]").addEventListener("click", async () => {
      setMessage("正在一键采集...");
      const response = await runtimeMessage({ type: "ONE_CLICK_COLLECT" });
      if (!response.ok) {
        setMessage(`一键采集失败: ${response.error}`, "bad");
        return;
      }
      renderSummary(response.summary);
      setMessage(`一键采集完成：新增 ${response.result.added} 个，更新 ${response.result.updated} 个`, "ok");
    });

    panel.querySelector("[data-mbb-one-restore]").addEventListener("click", async () => {
      setMessage("正在检查当前账号已拉黑名单...");
      const response = await runtimeMessage({ type: "START_RESTORE", mode: "pending" });
      if (!response.ok) {
        setMessage(`一键拉黑失败: ${response.error}`, "bad");
        return;
      }
      renderSummary(response.summary);
      setMessage(response.alreadyRunning ? "一键拉黑已在运行" : "一键拉黑已启动", "ok");
    });

    panel.querySelector("[data-mbb-restore]").addEventListener("click", async () => {
      setMessage("正在检查当前账号已拉黑名单...");
      const response = await runtimeMessage({ type: "START_RESTORE", mode: "pending" });
      if (!response.ok) {
        setMessage(`启动失败: ${response.error}`, "bad");
        return;
      }
      renderSummary(response.summary);
      setMessage(response.alreadyRunning ? "批量拉黑已在运行" : "批量拉黑已启动", "ok");
    });

    panel.querySelector("[data-mbb-scan]").addEventListener("click", async () => {
      setMessage("正在采集拉黑数据...");
      const response = await runtimeMessage({ type: "SCAN_CURRENT_TAB" });
      if (!response.ok) {
        setMessage(`采集失败: ${response.error}`, "bad");
        return;
      }
      renderSummary(response.summary);
      setMessage(`新增 ${response.result.added} 个，更新 ${response.result.updated} 个`, "ok");
    });

    panel.querySelector("[data-mbb-pause]").addEventListener("click", async () => {
      const response = await runtimeMessage({ type: "PAUSE_RESTORE" });
      if (!response.ok) {
        setMessage(`暂停失败: ${response.error}`, "bad");
        return;
      }
      renderSummary(response.summary);
      setMessage("已暂停", "ok");
    });

    panel.querySelector("[data-mbb-refresh]").addEventListener("click", async () => {
      await refreshSummary();
      setMessage("进度已刷新", "ok");
    });

    panel.querySelector("[data-mbb-local-toggle]").addEventListener("click", async () => {
      setView("local");
      await setPanelSize("large");
      const response = await runtimeMessage({ type: "GET_SUMMARY" });
      if (response.ok) {
        renderSummary(response.summary);
        renderLocalList(response.summary);
      }
    });

    panel.querySelector("[data-mbb-local-back]").addEventListener("click", () => {
      setView("main");
    });

    const getExportJsonText = async () => {
      const response = await runtimeMessage({ type: "GET_EXPORT_DATA" });
      if (!response.ok) {
        throw new Error(response.error || "export_failed");
      }
      return JSON.stringify(response.data, null, 2);
    };

    const parseImportUsers = (text) => {
      const parsed = JSON.parse(text);
      const users = Array.isArray(parsed) ? parsed : parsed.users;
      if (!Array.isArray(users)) {
        throw new Error("json_users_not_found");
      }
      return users;
    };

    const importUsers = async (users) => {
      const response = await runtimeMessage({ type: "IMPORT_USERS", users });
      if (!response.ok) {
        throw new Error(response.error || "import_failed");
      }
      renderSummary(response.summary);
      return response.result;
    };

    panel.querySelector("[data-mbb-data-toggle]").addEventListener("click", () => {
      panel.querySelector("[data-mbb-data-actions]").classList.toggle("open");
      panel.querySelector("[data-mbb-copy-fallback]").classList.remove("open");
      panel.querySelector("[data-mbb-paste-box]").classList.remove("open");
      panel.querySelector("[data-mbb-paste-import]").hidden = true;
    });

    panel.querySelector("[data-mbb-export-file]").addEventListener("click", async () => {
      setMessage("正在导出 JSON...");
      let jsonText = "";
      try {
        jsonText = await getExportJsonText();
      } catch (error) {
        setMessage(`导出失败: ${error.message}`, "bad");
        return;
      }
      const blob = new Blob([jsonText], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `mercari-blocklist-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage("已导出 JSON", "ok");
    });

    panel.querySelector("[data-mbb-copy-json]").addEventListener("click", async () => {
      setMessage("正在复制 JSON...");
      let jsonText = "";
      try {
        jsonText = await getExportJsonText();
      } catch (error) {
        setMessage(`复制失败: ${error.message}`, "bad");
        return;
      }

      try {
        await navigator.clipboard.writeText(jsonText);
        panel.querySelector("[data-mbb-copy-fallback]").classList.remove("open");
        setMessage("已复制 JSON", "ok");
      } catch (error) {
        const fallback = panel.querySelector("[data-mbb-copy-fallback]");
        fallback.value = jsonText;
        fallback.classList.add("open");
        fallback.focus();
        fallback.select();
        setMessage("复制失败，已显示 JSON，可手动全选复制", "bad");
      }
    });

    panel.querySelector("[data-mbb-import-file]").addEventListener("click", () => {
      panel.querySelector("[data-mbb-import-input]").click();
    });

    panel.querySelector("[data-mbb-import-input]").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setMessage("正在导入 JSON...");
      try {
        const users = parseImportUsers(await file.text());
        const result = await importUsers(users);
        setMessage(`导入完成：新增 ${result.added} 个，更新 ${result.updated} 个`, "ok");
      } catch (error) {
        setMessage(`导入失败: ${error.message}`, "bad");
      } finally {
        event.target.value = "";
      }
    });

    panel.querySelector("[data-mbb-paste-toggle]").addEventListener("click", () => {
      const pasteBox = panel.querySelector("[data-mbb-paste-box]");
      const importButton = panel.querySelector("[data-mbb-paste-import]");
      pasteBox.classList.toggle("open");
      importButton.hidden = !pasteBox.classList.contains("open");
      if (pasteBox.classList.contains("open")) pasteBox.focus();
    });

    panel.querySelector("[data-mbb-paste-import]").addEventListener("click", async () => {
      const pasteBox = panel.querySelector("[data-mbb-paste-box]");
      setMessage("正在导入粘贴内容...");
      try {
        const users = parseImportUsers(pasteBox.value);
        const result = await importUsers(users);
        pasteBox.value = "";
        pasteBox.classList.remove("open");
        panel.querySelector("[data-mbb-paste-import]").hidden = true;
        setMessage(`粘贴导入完成：新增 ${result.added} 个，更新 ${result.updated} 个`, "ok");
      } catch (error) {
        setMessage(`粘贴导入失败: ${error.message}`, "bad");
      }
    });

    panel.querySelector("[data-mbb-grabber]").addEventListener("pointerdown", (event) => {
      event.preventDefault();
      panel.setPointerCapture(event.pointerId);
      const startY = event.clientY;
      const startHeight = panel.getBoundingClientRect().height;

      const onMove = (moveEvent) => {
        const delta = startY - moveEvent.clientY;
        setPanelDragHeight(startHeight + delta);
      };

      const onUp = async (upEvent) => {
        panel.releasePointerCapture(upEvent.pointerId);
        panel.removeEventListener("pointermove", onMove);
        panel.removeEventListener("pointerup", onUp);
        panel.removeEventListener("pointercancel", onUp);
        await finishPanelDrag();
      };

      panel.addEventListener("pointermove", onMove);
      panel.addEventListener("pointerup", onUp);
      panel.addEventListener("pointercancel", onUp);
    });

    storageGet({ mbbPanelOpen: false, mbbPanelSize: "normal" })
      .then(async (result) => {
        await setPanelSize(result.mbbPanelSize || "normal");
        await setPanelOpen(result.mbbPanelOpen === true);
      })
      .catch(() => refreshSummary().catch(() => {}));
    setInterval(() => {
      if (panel.classList.contains("open")) refreshSummary().catch(() => {});
    }, 2500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createFloatingPanel, { once: true });
  } else {
    createFloatingPanel();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "SCAN_BLOCKED_USERS") {
      scanBlockedUsersPage().then(sendResponse).catch((error) => {
        sendResponse({ ok: false, error: error.message || "unknown", users: [] });
      });
      return true;
    }

    if (message?.type === "BLOCK_CURRENT_PROFILE") {
      blockCurrentProfile().then(sendResponse).catch((error) => {
        sendResponse({ ok: false, status: "failed", error: error.message || "unknown", profile: getProfileInfo() });
      });
      return true;
    }

    if (message?.type === "GET_PAGE_STATE") {
      sendResponse({ ok: true, state: getPageState() });
      return false;
    }

    return false;
  });
})();
