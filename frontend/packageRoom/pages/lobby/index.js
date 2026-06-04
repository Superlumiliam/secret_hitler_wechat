const CLOUD_ASSET_ROOT =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/";
const DEFAULT_AVATAR_FILE_ID = `${CLOUD_ASSET_ROOT}man-in-black.webp`;
const LOBBY_BACKGROUND_FILE_ID = `${CLOUD_ASSET_ROOT}background-room-prepare.webp`;
const LOBBY_ASSET_FILE_IDS = {
  roomPlayerFrame: `${CLOUD_ASSET_ROOT}room-player-frame.webp`,
  roomIdentity: `${CLOUD_ASSET_ROOT}room-identity.webp`,
  logoRoomAdjust: `${CLOUD_ASSET_ROOT}logo-room-adjust.webp`,
  logoRule: `${CLOUD_ASSET_ROOT}logo-rule.webp`,
};
const LOBBY_POLL_INTERVAL_MS = 2000;
const {
  LOBBY_PAGE_TIMEOUT_MS,
  clearPageTimeout,
  handlePageTimeout,
  schedulePageTimeout,
  setupPageTimeout,
  syncPageTimeoutDeadline,
} = require("../../../utils/pageTimeout");
const { buildRoomShare, enableShareMenu } = require("../../../utils/share");
const userProfileStore = require("../../../utils/userProfileStore");
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

function buildProfileRedirectUrl(targetUrl) {
  return `/pages/user-profile/index?redirect=${encodeURIComponent(targetUrl)}`;
}

function isCloudFileId(fileId) {
  return typeof fileId === "string" && fileId.indexOf("cloud://") === 0;
}

function getFileExtension(filePath) {
  const cleanPath = String(filePath || "").split("?")[0];
  const matched = cleanPath.match(/\.([a-zA-Z0-9]+)$/);
  return matched ? matched[1].toLowerCase() : "jpg";
}

function buildRoomAvatarCloudPath(commandId, filePath) {
  const ext = getFileExtension(filePath);
  return `room_assets/pending/${commandId}/avatars/avatar_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 10)}.${ext}`;
}

function createServiceError(result, fallbackMessage) {
  const error = (result && result.error) || {};
  const code = error.code || "";
  const messageByCode = {
    INVALID_PAYLOAD: "请求参数有误",
    ROOM_NOT_FOUND: "房间不存在",
    ROOM_EXPIRED: "房间已过期",
    NOT_ROOM_MEMBER: "当前用户不在房间中",
    NOT_ROOM_HOST: "只有房主可执行该操作",
    TARGET_COUNT_BELOW_SEATED: "选择人数小于已落座玩家数",
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

function getJoinErrorMessage(err) {
  const code = err && err.code;
  const messages = {
    INVALID_PAYLOAD: "房间链接无效",
    ROOM_NOT_FOUND: "房间不存在",
    ROOM_EXPIRED: "房间已过期",
    ROOM_FULL: "房间已满",
    ROOM_NOT_JOINABLE: "房间不可加入",
    ACTION_NOT_ALLOWED: "当前账号已有进行中的房间",
    PROFILE_REQUIRED: "请先创建用户资料",
    INTERNAL_ERROR: "系统繁忙，请稍后重试",
  };
  return messages[code] || (err && err.message) || "加入房间失败";
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

function parseRoomCode(value) {
  const roomCode = String(value || "").replace(/\s|-/g, "");
  return /^\d{6}$/.test(roomCode) ? roomCode : "";
}

Page({
  refreshTimer: null,
  initialSnapshotSettled: false,
  shouldStartRefreshAfterInitial: false,
  isPageVisible: false,
  isPageUnloaded: false,

  data: {
    roomId: "",
    memberId: "",
    shareRoomCode: "",
    lobby: null,
    isLoading: true,
    isJoiningFromShare: false,
    isSubmitting: false,
    isSoloActionSubmitting: false,
    isLeaving: false,
    defaultAvatarSrc: "",
    backgroundSrc: "",
    backgroundVisible: false,
    lobbyAssets: {},
    readyPlayerCount: 0,
    seats: [],
  },

  onLoad(options) {
    this.initialSnapshotSettled = false;
    this.shouldStartRefreshAfterInitial = false;
    this.isPageVisible = false;
    this.isPageUnloaded = false;
    const roomId = options.roomId || "";
    const shareRoomCode = parseRoomCode(options.roomCode);
    const initialLobby = takeInitialLobbySnapshot(roomId);
    enableShareMenu();
    this.setData({
      roomId,
      shareRoomCode,
      memberId: (initialLobby && initialLobby.memberId) || options.memberId || "",
    });
    setupPageTimeout(this, {
      timeoutMs: LOBBY_PAGE_TIMEOUT_MS,
      beforeRedirect: () => this.stopRefreshTimer(),
    });
    this.loadPageAssets();
    if (!roomId && shareRoomCode) {
      this.joinSharedRoom(shareRoomCode);
      return;
    }

    if (initialLobby && initialLobby.lobbySnapshot) {
      this.hydrateLobby(initialLobby.lobbySnapshot).then(() => {
        this.setData({
          isLoading: false,
        });
      });
      this.loadLobbySnapshot({ silent: true }).then((shouldContinuePolling) => {
        this.markInitialSnapshotSettled(shouldContinuePolling);
      });
      return;
    }

    this.loadLobbySnapshot().then((shouldContinuePolling) => {
      this.markInitialSnapshotSettled(shouldContinuePolling);
    });
  },

  onShow() {
    this.isPageVisible = true;
    schedulePageTimeout(this, {
      timeoutMs: LOBBY_PAGE_TIMEOUT_MS,
      beforeRedirect: () => this.stopRefreshTimer(),
    });
    if (this.data.roomId) {
      if (!this.initialSnapshotSettled) {
        this.shouldStartRefreshAfterInitial = true;
        return;
      }
      this.loadLobbySnapshot({ silent: true });
      this.startRefreshTimer();
    }
  },

  onHide() {
    this.isPageVisible = false;
    this.shouldStartRefreshAfterInitial = false;
    this.stopRefreshTimer();
    clearPageTimeout(this);
  },

  onUnload() {
    this.isPageVisible = false;
    this.isPageUnloaded = true;
    this.shouldStartRefreshAfterInitial = false;
    this.stopRefreshTimer();
    clearPageTimeout(this);
  },

  onShareAppMessage() {
    return buildRoomShare(this.data.lobby && this.data.lobby.roomCode);
  },

  onShareTimeline() {
    const share = buildRoomShare(this.data.lobby && this.data.lobby.roomCode);
    return {
      title: share.title,
      query: share.query,
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
    if (!this.isPageVisible || this.isPageUnloaded) {
      return;
    }
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

  markInitialSnapshotSettled(shouldStartRefresh) {
    this.initialSnapshotSettled = true;
    const canStartRefresh =
      shouldStartRefresh &&
      this.shouldStartRefreshAfterInitial &&
      this.isPageVisible &&
      !this.isPageUnloaded &&
      this.data.roomId &&
      !this.data.isLeaving;
    this.shouldStartRefreshAfterInitial = false;
    if (canStartRefresh) {
      this.startRefreshTimer();
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
          roleLabel: "",
        };
      }

      return {
        ...member,
        isEmpty: false,
        avatarSrc: avatarUrlByFileId[member.avatarUrl] || member.avatarUrl || this.data.defaultAvatarSrc,
        roleLabel: member.isHost ? "房主" : member.isVirtual ? "虚拟" : "",
      };
    });
  },

  countReadyPlayers(lobby) {
    return ((lobby && lobby.seatOrder) || []).filter((member) => member && member.isReady).length;
  },

  loadPageAssets() {
    if (!wx.cloud) {
      return;
    }

    const lobbyAssetFileIds = Object.keys(LOBBY_ASSET_FILE_IDS).map((key) => LOBBY_ASSET_FILE_IDS[key]);
    wx.cloud.getTempFileURL({
      fileList: [DEFAULT_AVATAR_FILE_ID, LOBBY_BACKGROUND_FILE_ID].concat(lobbyAssetFileIds),
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
          lobbyAssets: {
            roomPlayerFrame: urlByFileId[LOBBY_ASSET_FILE_IDS.roomPlayerFrame] || "",
            roomIdentity: urlByFileId[LOBBY_ASSET_FILE_IDS.roomIdentity] || "",
            logoRoomAdjust: urlByFileId[LOBBY_ASSET_FILE_IDS.logoRoomAdjust] || "",
            logoRule: urlByFileId[LOBBY_ASSET_FILE_IDS.logoRule] || "",
          },
        });

        if (this.data.lobby) {
          this.setData({
            seats: this.buildSeats(this.data.lobby),
            readyPlayerCount: this.countReadyPlayers(this.data.lobby),
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
        readyPlayerCount: this.countReadyPlayers(lobbyView),
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
        readyPlayerCount: this.countReadyPlayers(lobbyView),
      });
    } catch (err) {
      console.error("大厅头像临时链接获取失败", err);
      this.setData({
        lobby: lobbyView,
        seats: this.buildSeats(lobbyView),
        readyPlayerCount: this.countReadyPlayers(lobbyView),
      });
    }
  },

  async loadLobbySnapshot(options = {}) {
    if (!this.data.roomId || !wx.cloud) {
      this.setData({
        isLoading: false,
      });
      return false;
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
      return true;
    } catch (err) {
      console.error("获取大厅失败", err);
      if (err.code === "ROOM_EXPIRED" || err.code === "ROOM_NOT_FOUND" || err.code === "NOT_ROOM_MEMBER") {
        handlePageTimeout(this, {
          reasonCode: err.code,
          beforeRedirect: () => this.stopRefreshTimer(),
        });
        return false;
      }

      if (err.code === "GAME_ALREADY_STARTED") {
        this.redirectToBoard();
        return false;
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
      return true;
    }
  },

  cacheInitialLobbySnapshot(room) {
    if (!room || !room.roomId || !room.lobbySnapshot) {
      return;
    }

    const app = getApp();
    app.globalData.initialLobbySnapshots = app.globalData.initialLobbySnapshots || {};
    app.globalData.initialLobbySnapshots[room.roomId] = {
      memberId: room.memberId || "",
      lobbySnapshot: room.lobbySnapshot,
      expiresAt: Date.now() + 30 * 1000,
    };
  },

  async uploadRoomAvatarIfNeeded(profile, commandId) {
    const avatarUrl = profile && profile.avatarUrl;
    if (!avatarUrl || avatarUrl === DEFAULT_AVATAR_FILE_ID || isCloudFileId(avatarUrl)) {
      return "";
    }

    if (!wx.cloud || !wx.cloud.uploadFile) {
      throw new Error("当前基础库不支持头像上传");
    }

    const res = await wx.cloud.uploadFile({
      cloudPath: buildRoomAvatarCloudPath(commandId, avatarUrl),
      filePath: avatarUrl,
    });

    if (!res.fileID) {
      throw new Error("头像上传失败");
    }

    return res.fileID;
  },

  async deleteUploadedAvatar(fileID) {
    if (!fileID || !wx.cloud || !wx.cloud.deleteFile) {
      return;
    }

    try {
      await wx.cloud.deleteFile({
        fileList: [fileID],
      });
    } catch (err) {
      console.error("清理未使用房间头像失败", err);
    }
  },

  async joinSharedRoom(roomCode) {
    if (this.data.isJoiningFromShare) {
      return;
    }

    if (!roomCode) {
      wx.reLaunch({
        url: "/pages/home/index",
      });
      return;
    }

    const profile = await userProfileStore.getCachedProfileAsync();
    if (!profile) {
      wx.redirectTo({
        url: buildProfileRedirectUrl(`/packageRoom/pages/lobby/index?roomCode=${encodeURIComponent(roomCode)}`),
      });
      return;
    }

    if (!wx.cloud) {
      wx.showToast({
        title: "当前基础库不支持云能力",
        icon: "none",
      });
      this.setData({
        isLoading: false,
      });
      return;
    }

    this.setData({
      isJoiningFromShare: true,
      isLoading: true,
    });

    let uploadedAvatarFileId = "";
    try {
      const commandId = createCommandId("join_room");
      uploadedAvatarFileId = await this.uploadRoomAvatarIfNeeded(profile, commandId);
      const room = await this.callRoomService("joinRoom", {
        commandId,
        roomCode,
        displayName: profile.displayName,
        avatarUrl: uploadedAvatarFileId,
      });

      this.cacheInitialLobbySnapshot(room);
      wx.redirectTo({
        url: `/packageRoom/pages/lobby/index?roomId=${encodeURIComponent(room.roomId)}&memberId=${encodeURIComponent(room.memberId || "")}`,
      });
    } catch (err) {
      if (err.isBusinessFailure) {
        await this.deleteUploadedAvatar(uploadedAvatarFileId);
        uploadedAvatarFileId = "";
      }
      console.error("分享链接加入房间失败", err);
      wx.showToast({
        title: getJoinErrorMessage(err),
        icon: "none",
      });
      this.setData({
        isJoiningFromShare: false,
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
    const lobby = this.data.lobby;
    const viewerState = (lobby && lobby.viewerState) || {};
    if (!lobby || !this.data.roomId) {
      return;
    }

    if (!viewerState.isHost) {
      wx.showToast({
        title: "只有房主能使用房间设置功能",
        icon: "none",
      });
      return;
    }

    wx.navigateTo({
      url: `/pages/create-room/index?mode=roomSettings&roomId=${encodeURIComponent(this.data.roomId)}`,
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
      reasonCode: err.code,
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
      if (!viewerState.canStart) {
        wx.showToast({
          title: "房间未满或有玩家未准备",
          icon: "none",
        });
        return;
      }
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

  async onSoloFillVirtualPlayers() {
    if (this.data.isSoloActionSubmitting || !this.data.lobby || !this.data.lobby.isSoloRoom) {
      return;
    }

    this.setData({
      isSoloActionSubmitting: true,
    });

    try {
      const snapshot = await this.callRoomService("soloFillVirtualPlayers", {
        commandId: createCommandId("solo_fill_virtual_players"),
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
        isSoloActionSubmitting: false,
      });
    }
  },

  async onSoloReadyAllVirtualPlayers() {
    if (this.data.isSoloActionSubmitting || !this.data.lobby || !this.data.lobby.isSoloRoom) {
      return;
    }

    this.setData({
      isSoloActionSubmitting: true,
    });

    try {
      const snapshot = await this.callRoomService("soloReadyAllVirtualPlayers", {
        commandId: createCommandId("solo_ready_virtual_players"),
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
        isSoloActionSubmitting: false,
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
