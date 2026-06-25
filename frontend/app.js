const bootstrapService = require("./services/bootstrapService");
const { reLaunchPage } = require("./utils/protectedPageRoute");

function getCurrentPageRouteInfo() {
  const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
  const page = pages[pages.length - 1] || {};
  return {
    route: page.route || "",
    options: page.options || {},
  };
}

function buildRouteForActiveRoom(activeRoom) {
  if (!activeRoom || !activeRoom.roomId) {
    return "";
  }

  const roomId = encodeURIComponent(activeRoom.roomId);
  const memberId = encodeURIComponent(activeRoom.memberId || "");
  if (activeRoom.routeHint === "lobby") {
    return `/packageRoom/pages/lobby/index?roomId=${roomId}&memberId=${memberId}`;
  }
  if (activeRoom.routeHint === "board") {
    return `/packageRoom/pages/board/index?roomId=${roomId}`;
  }
  if (activeRoom.routeHint === "result") {
    return `/packageResult/pages/result/index?roomId=${roomId}&roomCode=${encodeURIComponent(activeRoom.roomCode || "")}`;
  }
  return "";
}

function getRoutePathForHint(routeHint) {
  const pathByHint = {
    lobby: "packageRoom/pages/lobby/index",
    board: "packageRoom/pages/board/index",
    result: "packageResult/pages/result/index",
  };
  return pathByHint[routeHint] || "";
}

App({
  globalData: {
    env: "cloud1-9gcbbsjv4ce11da4",
    userProfileStorageKey: "secret_hitler_user_profile",
    activeRoom: null,
    isRecoveringActiveRoom: false,
  },
  onLaunch(options = {}) {
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
      return;
    }

    wx.cloud.init({
      env: this.globalData.env,
      traceUser: true,
    });

    const query = options.query || {};
    this.ensureSessionAndRecover({
      source: "launch",
      skipRecoverRoute: Boolean(query.roomCode || query.pageTimedOut),
    });
  },

  onShow(options = {}) {
    const query = options.query || {};
    this.ensureSessionAndRecover({
      source: "show",
      skipRecoverRoute: Boolean(query.roomCode || query.pageTimedOut),
    });
  },

  async ensureSessionAndRecover(options = {}) {
    if (!wx.cloud || this.globalData.isRecoveringActiveRoom) {
      return;
    }

    this.globalData.isRecoveringActiveRoom = true;
    try {
      const recovered = options.skipRecoverRoute
        ? await bootstrapService.ensureSession()
        : await bootstrapService.recoverActiveRoom();
      const activeRoom = recovered.activeRoom || null;
      this.globalData.activeRoom = activeRoom;

      if (!options.skipRecoverRoute) {
        this.routeByActiveRoom(activeRoom);
      }
    } catch (err) {
      console.error("恢复活跃房间失败", err);
    } finally {
      this.globalData.isRecoveringActiveRoom = false;
    }
  },

  routeByActiveRoom(activeRoom) {
    const url = buildRouteForActiveRoom(activeRoom);
    if (!url) {
      return;
    }

    const current = getCurrentPageRouteInfo();
    const targetRoute = getRoutePathForHint(activeRoom.routeHint);
    const currentRoomId = current.options.roomId || "";
    if (current.route === targetRoute && currentRoomId === activeRoom.roomId) {
      return;
    }

    if (activeRoom.routeHint === "board" || activeRoom.routeHint === "result") {
      reLaunchPage(url);
      return;
    }

    const routeMethod = current.route ? "redirectTo" : "reLaunch";
    wx[routeMethod]({
      url,
    });
  },
});
