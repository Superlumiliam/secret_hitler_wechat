const HOME_TIMEOUT_QUERY = "pageTimedOut=1";
const HOME_ROOM_EXPIRED_QUERY = "pageTimedOut=roomExpired";
const PAGE_TIMEOUT_MAX_TIMER_MS = 30 * 1000;
const { clearGameSnapshotCache } = require("./gameSnapshotCache");

function clearRuntimeRoomState() {
  clearGameSnapshotCache();
  const app = typeof getApp === "function" ? getApp() : null;
  if (!app || !app.globalData) {
    return;
  }

  app.globalData.activeRoom = null;
  app.globalData.initialLobbySnapshots = {};
}

async function clearActiveRoomOnServer(roomId) {
  if (!wx.cloud) {
    return;
  }

  try {
    const res = await wx.cloud.callFunction({
      name: "bootstrapService",
      data: {
        action: "clearActiveRoom",
        payload: roomId ? { roomId } : {},
      },
    });
    const result = res.result || {};
    if (!result.success) {
      console.error("清理活跃房间失败", result.error || result);
    }
  } catch (err) {
    console.error("清理活跃房间失败", err);
  }
}

function redirectHomeWithTimeoutNotice(reasonCode) {
  const query = reasonCode === "ROOM_EXPIRED" ? HOME_ROOM_EXPIRED_QUERY : HOME_TIMEOUT_QUERY;
  wx.reLaunch({
    url: `/pages/home/index?${query}`,
  });
}

async function handlePageTimeout(page, options = {}) {
  if (page.__pageTimeoutHandling) {
    return;
  }

  page.__pageTimeoutHandling = true;
  if (typeof options.beforeRedirect === "function") {
    options.beforeRedirect();
  }

  clearRuntimeRoomState();
  await clearActiveRoomOnServer(page && page.data && page.data.roomId);
  redirectHomeWithTimeoutNotice(options.reasonCode);
}

function setupPageTimeout(page, options) {
  const timeoutMs = options && options.timeoutMs;
  const deadlineAt = Number(options && options.deadlineAt);
  if (Number.isFinite(deadlineAt) && deadlineAt > 0) {
    page.__pageTimeoutDeadline = deadlineAt;
    schedulePageTimeout(page, options);
    return;
  }

  if (!timeoutMs || timeoutMs <= 0) {
    return;
  }

  page.__pageTimeoutDeadline = Date.now() + timeoutMs;
  schedulePageTimeout(page, options);
}

function syncPageTimeoutDeadline(page, expireAt, options = {}) {
  const deadline = Date.parse(expireAt || "");
  if (!Number.isFinite(deadline)) {
    return;
  }

  page.__pageTimeoutDeadline = deadline;
  schedulePageTimeout(page, options);
}

function schedulePageTimeout(page, options) {
  clearPageTimeout(page);

  const deadline = page.__pageTimeoutDeadline;
  if (!deadline || page.__pageTimeoutHandling) {
    return;
  }

  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    handlePageTimeout(page, options);
    return;
  }

  page.__pageTimeoutTimer = setTimeout(() => {
    schedulePageTimeout(page, options);
  }, Math.min(remainingMs, PAGE_TIMEOUT_MAX_TIMER_MS));
}

function clearPageTimeout(page) {
  if (page.__pageTimeoutTimer) {
    clearTimeout(page.__pageTimeoutTimer);
    page.__pageTimeoutTimer = null;
  }
}

function showTimeoutModalIfNeeded(options = {}) {
  if (!options.pageTimedOut) {
    return;
  }

  if (options.pageTimedOut === "roomExpired") {
    wx.showModal({
      title: "房间已过期",
      content: "请回到首页开始新的对局。",
      showCancel: false,
      confirmText: "确认",
    });
    return;
  }

  wx.showModal({
    title: "页面已超时",
    content: "页面停留时间过长，请回到首页开始新的对局。",
    showCancel: false,
    confirmText: "确认",
  });
}

module.exports = {
  LOBBY_PAGE_TIMEOUT_MS: 30 * 60 * 1000,
  GAME_PAGE_TIMEOUT_MS: 3 * 60 * 60 * 1000,
  RESULT_PAGE_TIMEOUT_MS: 30 * 60 * 1000,
  clearPageTimeout,
  handlePageTimeout,
  schedulePageTimeout,
  setupPageTimeout,
  syncPageTimeoutDeadline,
  showTimeoutModalIfNeeded,
};
