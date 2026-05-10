const CLOUD_ASSET_ROOT =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/";
const DEFAULT_AVATAR_FILE_ID = `${CLOUD_ASSET_ROOT}man-in-black.webp`;
const LOBBY_BACKGROUND_FILE_ID = `${CLOUD_ASSET_ROOT}bacnground-room-prepare.webp`;
const PROFILE_STORAGE_KEY = "secret_hitler_user_profile";

function createCommandId(prefix) {
  return `cmd_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isCloudFileId(fileId) {
  return typeof fileId === "string" && fileId.indexOf("cloud://") === 0;
}

function readCachedProfile() {
  try {
    return wx.getStorageSync(PROFILE_STORAGE_KEY) || null;
  } catch (err) {
    console.error("读取用户资料缓存失败", err);
    return null;
  }
}

function createServiceError(result, fallbackMessage) {
  const error = (result && result.error) || {};
  const err = new Error(error.message || fallbackMessage);
  err.code = error.code || "";
  err.retryable = Boolean(error.retryable);
  return err;
}

Page({
  refreshTimer: null,
  hasTriedJoinRoom: false,

  data: {
    roomId: "",
    memberId: "",
    lobby: null,
    isLoading: true,
    isSubmitting: false,
    isLeaving: false,
    defaultAvatarSrc: "",
    backgroundSrc: "",
    backgroundVisible: false,
    seats: [],
  },

  onLoad(options) {
    this.setData({
      roomId: options.roomId || "",
      memberId: options.memberId || "",
    });
    this.loadPageAssets();
    this.loadLobbySnapshot();
  },

  onShow() {
    if (this.data.roomId) {
      this.startRefreshTimer();
    }
  },

  onHide() {
    this.stopRefreshTimer();
  },

  onUnload() {
    this.stopRefreshTimer();
  },

  onShareAppMessage() {
    const roomCode = this.data.lobby && this.data.lobby.roomCode;
    return {
      title: `加入 secret hitler 房间 ${roomCode || ""}`.trim(),
      path: `/packageRoom/pages/lobby/index?roomId=${encodeURIComponent(this.data.roomId)}`,
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
    }, 3000);
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
    const cloudFileIds = ((lobby && lobby.seatOrder) || [])
      .map((member) => member.avatarUrl)
      .filter((avatarUrl) => isCloudFileId(avatarUrl));

    if (!cloudFileIds.length || !wx.cloud) {
      this.setData({
        lobby,
        seats: this.buildSeats(lobby),
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
        lobby,
        seats: this.buildSeats(lobby, avatarUrlByFileId),
      });
    } catch (err) {
      console.error("大厅头像临时链接获取失败", err);
      this.setData({
        lobby,
        seats: this.buildSeats(lobby),
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

      await this.hydrateLobby(result.data);
      this.setData({
        isLoading: false,
      });
    } catch (err) {
      console.error("获取大厅失败", err);
      if (err.code === "GAME_ALREADY_STARTED") {
        this.redirectToBoard();
        return;
      }

      if (err.code === "NOT_ROOM_MEMBER" && !this.hasTriedJoinRoom) {
        await this.joinRoom(options);
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

  async joinRoom(options = {}) {
    this.hasTriedJoinRoom = true;
    const profile = readCachedProfile();
    if (!profile || !profile.profileCompleted || !profile.displayName) {
      wx.redirectTo({
        url: `/pages/user-profile/index?redirect=${encodeURIComponent(
          `/packageRoom/pages/lobby/index?roomId=${encodeURIComponent(this.data.roomId)}`,
        )}`,
      });
      return;
    }

    try {
      const result = await this.callRoomService("joinRoom", {
        commandId: createCommandId("join_room"),
        roomId: this.data.roomId,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl || "",
      });

      this.setData({
        memberId: result.memberId || "",
      });
      await this.hydrateLobby(result.lobbySnapshot);
      this.setData({
        isLoading: false,
      });
    } catch (err) {
      console.error("加入房间失败", err);
      if (err.code === "GAME_ALREADY_STARTED") {
        this.redirectToBoard();
        return;
      }

      if (!options.silent) {
        wx.showToast({
          title: err.message || "加入房间失败",
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
    wx.showToast({
      title: "规则说明待开放",
      icon: "none",
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

  async onReadyAction() {
    const lobby = this.data.lobby;
    if (!lobby || this.data.isSubmitting) {
      return;
    }

    if (lobby.isHost && lobby.myIsReady) {
      await this.onStartGame();
      return;
    }

    this.setData({
      isSubmitting: true,
    });

    try {
      const nextReady = lobby.isHost ? true : !lobby.myIsReady;
      const snapshot = await this.callRoomService("setReady", {
        commandId: createCommandId("set_ready"),
        roomId: this.data.roomId,
        isReady: nextReady,
      });

      await this.hydrateLobby(snapshot);
    } catch (err) {
      console.error("准备状态更新失败", err);
      wx.showToast({
        title: err.message || "操作失败",
        icon: "none",
      });
    } finally {
      this.setData({
        isSubmitting: false,
      });
    }
  },

  async onStartGame() {
    const lobby = this.data.lobby;
    if (!lobby || !lobby.canStart || this.data.isSubmitting) {
      return;
    }

    this.setData({
      isSubmitting: true,
    });

    try {
      const result = await this.callRoomService("startGame", {
        commandId: createCommandId("start_game"),
        roomId: this.data.roomId,
      });
      const boardPath = result.boardPath || `/packageRoom/pages/board/index?roomId=${encodeURIComponent(this.data.roomId)}`;
      wx.redirectTo({
        url: boardPath,
      });
    } catch (err) {
      console.error("开始游戏失败", err);
      wx.showToast({
        title: err.message || "开始失败",
        icon: "none",
      });
      this.setData({
        isSubmitting: false,
      });
    }
  },
});
