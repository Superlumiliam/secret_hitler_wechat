const CLOUD_ASSET_ROOT =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/";
const DEFAULT_AVATAR_FILE_ID = `${CLOUD_ASSET_ROOT}man-in-black.webp`;
const LOBBY_BACKGROUND_FILE_ID = `${CLOUD_ASSET_ROOT}background-room-prepare.webp`;
const LOBBY_POLL_INTERVAL_MS = 2000;
const {
  LOBBY_PAGE_TIMEOUT_MS,
  clearPageTimeout,
  handlePageTimeout,
  schedulePageTimeout,
  setupPageTimeout,
  syncPageTimeoutDeadline,
} = require("../../../utils/pageTimeout");
const REFRESH_AFTER_ERROR_CODES = [
  "VERSION_CONFLICT",
  "PHASE_MISMATCH",
  "DUPLICATE_COMMAND",
  "ACTION_NOT_ALLOWED",
  "NOT_ROOM_HOST",
  "NOT_ALL_READY",
  "GAME_ALREADY_STARTED",
];

function createCommandId(prefix) {
  return `cmd_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isCloudFileId(fileId) {
  return typeof fileId === "string" && fileId.indexOf("cloud://") === 0;
}

function createServiceError(result, fallbackMessage) {
  const error = (result && result.error) || {};
  const code = error.code || "";
  const messageByCode = {
    INVALID_PAYLOAD: "请求参数有误",
    ROOM_NOT_FOUND: "房间不存在",
    ROOM_EXPIRED: "房间已失效",
    NOT_ROOM_MEMBER: "当前用户不在房间中",
    NOT_ROOM_HOST: "只有房主可执行该操作",
    NOT_ALL_READY: "还有玩家未准备",
    GAME_ALREADY_STARTED: "对局已开始，正在为你恢复",
    ACTION_NOT_ALLOWED: "当前状态不允许执行该操作",
    INTERNAL_ERROR: "系统繁忙，请稍后重试",
  };
  const err = new Error(messageByCode[code] || fallbackMessage || "操作失败");
  err.code = code;
  err.retryable = Boolean(error.retryable);
  err.isBusinessFailure = true;
  return err;
}

function isRoomUnavailableError(err) {
  return Boolean(err && ["ROOM_EXPIRED", "ROOM_NOT_FOUND", "NOT_ROOM_MEMBER"].includes(err.code));
}

function takeInitialLobbySnapshot(roomId) {
  const app = getApp();
  const snapshots = app.globalData.initialLobbySnapshots || {};
  const cached = snapshots[roomId];
  if (!cached) {
    return null;
  }

  delete snapshots[roomId];
  if (cached.expiresAt && cached.expiresAt < Date.now()) {
    return null;
  }

  return cached;
}

function normalizeLobbyView(lobby) {
  if (!lobby) {
    return lobby;
  }

  if (lobby.viewerState) {
    return lobby;
  }

  return {
    ...lobby,
    viewerState: {
      myMemberId: lobby.myMemberId || "",
      isHost: Boolean(lobby.isHost),
      myIsReady: Boolean(lobby.myIsReady),
      canStart: Boolean(lobby.canStart),
    },
  };
}

Page({
  refreshTimer: null,

  data: {
    roomId: "",
    memberId: "",
    lobby: null,
    isLoading: true,
    isSubmitting: false,
    isDevActionSubmitting: false,
    isLeaving: false,
    defaultAvatarSrc: "",
    backgroundSrc: "",
    backgroundVisible: false,
    seats: [],
  },

  onLoad(options) {
    const roomId = options.roomId || "";
    const initialLobby = takeInitialLobbySnapshot(roomId);
    this.setData({
      roomId,
      memberId: (initialLobby && initialLobby.memberId) || options.memberId || "",
    });
    setupPageTimeout(this, {
      timeoutMs: LOBBY_PAGE_TIMEOUT_MS,
      beforeRedirect: () => this.stopRefreshTimer(),
    });
    this.loadPageAssets();
    if (initialLobby && initialLobby.lobbySnapshot) {
      this.hydrateLobby(initialLobby.lobbySnapshot).then(() => {
        this.setData({
          isLoading: false,
        });
      });
      this.loadLobbySnapshot({ silent: true });
      return;
    }

    this.loadLobbySnapshot();
  },

  onShow() {
    schedulePageTimeout(this, {
      timeoutMs: LOBBY_PAGE_TIMEOUT_MS,
      beforeRedirect: () => this.stopRefreshTimer(),
    });
    if (this.data.roomId) {
      this.loadLobbySnapshot({ silent: true });
      this.startRefreshTimer();
    }
  },

  onHide() {
    this.stopRefreshTimer();
    clearPageTimeout(this);
  },

  onUnload() {
    this.stopRefreshTimer();
    clearPageTimeout(this);
  },

  onShareAppMessage() {
    const roomCode = this.data.lobby && this.data.lobby.roomCode;
    return {
      title: `加入 secret dictator 房间 ${roomCode || ""}`.trim(),
      path: `/pages/home/index?roomCode=${encodeURIComponent(roomCode || "")}`,
    };
  },

  redirectToBoard() {
    this.stopRefreshTimer();
    wx.redirectTo({
      url: `/packageRoom/pages/board/index?roomId=${encodeURIComponent(this.data.roomId)}`,
    });
  },

  startRefreshTimer() {
    this.stopRefreshTimer();
    this.refreshTimer = setInterval(() => {
      this.loadLobbySnapshot({ silent: true });
    }, LOBBY_POLL_INTERVAL_MS);
  },

  stopRefreshTimer() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  },

  buildSeats(lobby, avatarUrlByFileId = {}) {
    const members = (lobby && lobby.seatOrder) || [];
    const memberBySeat = {};
    members.forEach((member) => {
      memberBySeat[member.seatIndex] = member;
    });

    return Array.from({ length: lobby.targetPlayerCount }, (_, index) => {
      const seatIndex = index + 1;
      const member = memberBySeat[seatIndex];
      if (!member) {
        return {
          seatIndex,
          isEmpty: true,
          displayName: "邀请好友",
          avatarSrc: this.data.defaultAvatarSrc,
        };
      }

      return {
        ...member,
        isEmpty: false,
        avatarSrc: avatarUrlByFileId[member.avatarUrl] || member.avatarUrl || this.data.defaultAvatarSrc,
      };
    });
  },

  loadPageAssets() {
    if (!wx.cloud) {
      return;
    }

    wx.cloud.getTempFileURL({
      fileList: [DEFAULT_AVATAR_FILE_ID, LOBBY_BACKGROUND_FILE_ID],
      success: (res) => {
        const urlByFileId = {};
        (res.fileList || []).forEach((file) => {
          if (file.status === 0 && file.tempFileURL) {
            urlByFileId[file.fileID] = file.tempFileURL;
          } else {
            console.error("房间大厅云存储资源临时链接获取失败", file);
          }
        });

        this.setData({
          defaultAvatarSrc: urlByFileId[DEFAULT_AVATAR_FILE_ID] || "",
          backgroundSrc: urlByFileId[LOBBY_BACKGROUND_FILE_ID] || "",
          backgroundVisible: Boolean(urlByFileId[LOBBY_BACKGROUND_FILE_ID]),
        });

        if (this.data.lobby) {
          this.setData({
            seats: this.buildSeats(this.data.lobby),
          });
        }
      },
      fail: (err) => {
        console.error("房间大厅云存储资源临时链接获取失败", err);
      },
    });
  },

  async hydrateLobby(lobby) {
    const lobbyView = normalizeLobbyView(lobby);
    const cloudFileIds = ((lobbyView && lobbyView.seatOrder) || [])
      .map((member) => member.avatarUrl)
      .filter((avatarUrl) => isCloudFileId(avatarUrl));

    if (!cloudFileIds.length || !wx.cloud) {
      this.setData({
        lobby: lobbyView,
        seats: this.buildSeats(lobbyView),
      });
      return;
    }

    try {
      const tempRes = await wx.cloud.getTempFileURL({
        fileList: Array.from(new Set(cloudFileIds)),
      });
      const avatarUrlByFileId = {};
      (tempRes.fileList || []).forEach((file) => {
        if (file.status === 0 && file.tempFileURL) {
          avatarUrlByFileId[file.fileID] = file.tempFileURL;
        }
      });

      this.setData({
        lobby: lobbyView,
        seats: this.buildSeats(lobbyView, avatarUrlByFileId),
      });
    } catch (err) {
      console.error("大厅头像临时链接获取失败", err);
      this.setData({
        lobby: lobbyView,
        seats: this.buildSeats(lobbyView),
      });
    }
  },

  async loadLobbySnapshot(options = {}) {
    if (!this.data.roomId || !wx.cloud) {
      this.setData({
        isLoading: false,
      });
      return;
    }

    try {
      const res = await wx.cloud.callFunction({
        name: "roomService",
        data: {
          action: "getLobbySnapshot",
          payload: {
            roomId: this.data.roomId,
          },
        },
      });
      const result = res.result || {};

      if (!result.success) {
        throw createServiceError(result, "获取大厅失败");
      }

      syncPageTimeoutDeadline(this, result.data && result.data.expireAt, {
        beforeRedirect: () => this.stopRefreshTimer(),
      });
      await this.hydrateLobby(result.data);
      this.setData({
        isLoading: false,
      });
    } catch (err) {
      console.error("获取大厅失败", err);
      if (err.code === "ROOM_EXPIRED" || err.code === "ROOM_NOT_FOUND" || err.code === "NOT_ROOM_MEMBER") {
        handlePageTimeout(this, {
          beforeRedirect: () => this.stopRefreshTimer(),
        });
        return;
      }

      if (err.code === "GAME_ALREADY_STARTED") {
        this.redirectToBoard();
        return;
      }

      if (!options.silent) {
        wx.showToast({
          title: err.message || "获取大厅失败",
          icon: "none",
        });
      }
      this.setData({
        isLoading: false,
      });
    }
  },

  async onBackHome() {
    if (this.data.isLeaving) {
      return;
    }

    if (!this.data.roomId || !wx.cloud) {
      wx.reLaunch({
        url: "/pages/home/index",
      });
      return;
    }

    this.stopRefreshTimer();
    this.setData({
      isLeaving: true,
    });

    try {
      await this.callRoomService("leaveRoom", {
        commandId: createCommandId("leave_room"),
        roomId: this.data.roomId,
      });

      wx.reLaunch({
        url: "/pages/home/index",
      });
    } catch (err) {
      console.error("离开房间失败", err);
      wx.showToast({
        title: err.message || "离开房间失败",
        icon: "none",
      });
      this.setData({
        isLeaving: false,
      });
      this.startRefreshTimer();
    }
  },

  onTapRoomSettings() {
    wx.showToast({
      title: "房间设置待开放",
      icon: "none",
    });
  },

  onTapRules() {
    const timeoutDeadlineAt = this.__pageTimeoutDeadline || Date.now() + LOBBY_PAGE_TIMEOUT_MS;
    wx.navigateTo({
      url: `/packageRoom/pages/rules/index?roomId=${encodeURIComponent(this.data.roomId || "")}&memberId=${encodeURIComponent(
        this.data.memberId || "",
      )}&timeoutMs=${LOBBY_PAGE_TIMEOUT_MS}&timeoutDeadlineAt=${timeoutDeadlineAt}`,
    });
  },

  async callRoomService(action, payload) {
    const res = await wx.cloud.callFunction({
      name: "roomService",
      data: {
        action,
        payload,
      },
    });
    const result = res.result || {};
    if (!result.success) {
      throw createServiceError(result, "操作失败");
    }
    return result.data || {};
  },

  async callGameService(action, payload) {
    const res = await wx.cloud.callFunction({
      name: "gameService",
      data: {
        action,
        payload,
      },
    });
    const result = res.result || {};
    if (!result.success) {
      throw createServiceError(result, "操作失败");
    }
    return result.data || {};
  },

  shouldRefreshAfterError(err) {
    return Boolean(err && (err.retryable || REFRESH_AFTER_ERROR_CODES.includes(err.code)));
  },

  handleRoomUnavailable(err) {
    if (!isRoomUnavailableError(err)) {
      return false;
    }

    handlePageTimeout(this, {
      beforeRedirect: () => this.stopRefreshTimer(),
    });
    return true;
  },

  async onReadyAction() {
    const lobby = this.data.lobby;
    const viewerState = (lobby && lobby.viewerState) || {};
    if (!lobby || this.data.isSubmitting) {
      return;
    }

    if (viewerState.isHost && viewerState.myIsReady) {
      await this.onStartGame();
      return;
    }

    this.setData({
      isSubmitting: true,
    });

    try {
      const nextReady = viewerState.isHost ? true : !viewerState.myIsReady;
      const snapshot = await this.callRoomService("setReady", {
        commandId: createCommandId("set_ready"),
        roomId: this.data.roomId,
        isReady: nextReady,
      });

      await this.hydrateLobby(snapshot);
      await this.loadLobbySnapshot({ silent: true });
    } catch (err) {
      console.error("准备状态更新失败", err);
      if (this.handleRoomUnavailable(err)) {
        return;
      }
      wx.showToast({
        title: err.message || "操作失败",
        icon: "none",
      });
      if (this.shouldRefreshAfterError(err)) {
        this.loadLobbySnapshot({ silent: true });
      }
    } finally {
      this.setData({
        isSubmitting: false,
      });
    }
  },

  async onDevFillVirtualPlayers() {
    if (this.data.isDevActionSubmitting || !this.data.lobby || !this.data.lobby.isDevRoom) {
      return;
    }

    this.setData({
      isDevActionSubmitting: true,
    });

    try {
      const snapshot = await this.callRoomService("devFillVirtualPlayers", {
        commandId: createCommandId("dev_fill_virtual_players"),
        roomId: this.data.roomId,
      });
      await this.hydrateLobby(snapshot);
      await this.loadLobbySnapshot({ silent: true });
    } catch (err) {
      console.error("补齐虚拟玩家失败", err);
      if (this.handleRoomUnavailable(err)) {
        return;
      }
      wx.showToast({
        title: err.message || "补齐失败",
        icon: "none",
      });
      if (this.shouldRefreshAfterError(err)) {
        this.loadLobbySnapshot({ silent: true });
      }
    } finally {
      this.setData({
        isDevActionSubmitting: false,
      });
    }
  },

  async onDevReadyAllVirtualPlayers() {
    if (this.data.isDevActionSubmitting || !this.data.lobby || !this.data.lobby.isDevRoom) {
      return;
    }

    this.setData({
      isDevActionSubmitting: true,
    });

    try {
      const snapshot = await this.callRoomService("devReadyAllVirtualPlayers", {
        commandId: createCommandId("dev_ready_virtual_players"),
        roomId: this.data.roomId,
      });
      await this.hydrateLobby(snapshot);
      await this.loadLobbySnapshot({ silent: true });
    } catch (err) {
      console.error("虚拟玩家准备失败", err);
      if (this.handleRoomUnavailable(err)) {
        return;
      }
      wx.showToast({
        title: err.message || "准备失败",
        icon: "none",
      });
      if (this.shouldRefreshAfterError(err)) {
        this.loadLobbySnapshot({ silent: true });
      }
    } finally {
      this.setData({
        isDevActionSubmitting: false,
      });
    }
  },

  async onStartGame() {
    const lobby = this.data.lobby;
    const viewerState = (lobby && lobby.viewerState) || {};
    if (!lobby || !viewerState.canStart || this.data.isSubmitting) {
      return;
    }

    this.setData({
      isSubmitting: true,
    });

    try {
      const result = await this.callGameService("startGame", {
        commandId: createCommandId("start_game"),
        roomId: this.data.roomId,
      });
      const boardPath = result.boardPath || `/packageRoom/pages/board/index?roomId=${encodeURIComponent(this.data.roomId)}`;
      wx.redirectTo({
        url: boardPath,
      });
    } catch (err) {
      console.error("开始游戏失败", err);
      if (this.handleRoomUnavailable(err)) {
        return;
      }
      wx.showToast({
        title: err.message || "开始失败",
        icon: "none",
      });
      if (this.shouldRefreshAfterError(err)) {
        this.loadLobbySnapshot({ silent: true });
      }
      this.setData({
        isSubmitting: false,
      });
    }
  },
});
