const CLOUD_ASSET_ROOT =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/";

const ROOM_ROLE_DATA = {
  5: {
    liberalCards: [
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-young-male.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-young-female.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-middle-male.webp` },
    ],
    fascistCards: [
      { roleName: "极权派", fileId: `${CLOUD_ASSET_ROOT}room-fascist-male-1.webp` },
      { roleName: "独裁者", fileId: `${CLOUD_ASSET_ROOT}room-fascist-hitler.webp`, isDictator: true },
    ],
  },
  6: {
    liberalCards: [
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-young-male.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-young-female.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-middle-male.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-middle-female.webp` },
    ],
    fascistCards: [
      { roleName: "极权派", fileId: `${CLOUD_ASSET_ROOT}room-fascist-male-1.webp` },
      { roleName: "独裁者", fileId: `${CLOUD_ASSET_ROOT}room-fascist-hitler.webp`, isDictator: true },
    ],
  },
  7: {
    liberalCards: [
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-young-male.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-young-female.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-middle-male.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-middle-female.webp` },
    ],
    fascistCards: [
      { roleName: "极权派", fileId: `${CLOUD_ASSET_ROOT}room-fascist-male-1.webp` },
      { roleName: "极权派", fileId: `${CLOUD_ASSET_ROOT}room-fascist-male-2.webp` },
      { roleName: "独裁者", fileId: `${CLOUD_ASSET_ROOT}room-fascist-hitler.webp`, isDictator: true },
    ],
  },
  8: {
    liberalCards: [
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-young-male.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-young-female.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-middle-male.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-middle-female.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-elder-male.webp` },
    ],
    fascistCards: [
      { roleName: "极权派", fileId: `${CLOUD_ASSET_ROOT}room-fascist-male-1.webp` },
      { roleName: "极权派", fileId: `${CLOUD_ASSET_ROOT}room-fascist-male-2.webp` },
      { roleName: "独裁者", fileId: `${CLOUD_ASSET_ROOT}room-fascist-hitler.webp`, isDictator: true },
    ],
  },
  9: {
    liberalCards: [
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-young-male.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-young-female.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-middle-male.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-middle-female.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-elder-male.webp` },
    ],
    fascistCards: [
      { roleName: "极权派", fileId: `${CLOUD_ASSET_ROOT}room-fascist-male-1.webp` },
      { roleName: "极权派", fileId: `${CLOUD_ASSET_ROOT}room-fascist-male-2.webp` },
      { roleName: "极权派", fileId: `${CLOUD_ASSET_ROOT}room-fascist-female.webp` },
      { roleName: "独裁者", fileId: `${CLOUD_ASSET_ROOT}room-fascist-hitler.webp`, isDictator: true },
    ],
  },
  10: {
    liberalCards: [
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-young-male.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-young-female.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-middle-male.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-middle-female.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-elder-male.webp` },
      { roleName: "自由派", fileId: `${CLOUD_ASSET_ROOT}room-liberal-elder-female.webp` },
    ],
    fascistCards: [
      { roleName: "极权派", fileId: `${CLOUD_ASSET_ROOT}room-fascist-male-1.webp` },
      { roleName: "极权派", fileId: `${CLOUD_ASSET_ROOT}room-fascist-male-2.webp` },
      { roleName: "极权派", fileId: `${CLOUD_ASSET_ROOT}room-fascist-female.webp` },
      { roleName: "独裁者", fileId: `${CLOUD_ASSET_ROOT}room-fascist-hitler.webp`, isDictator: true },
    ],
  },
};

const playerCounts = [5, 6, 7, 8, 9, 10].map((value) => ({ value }));
const ALL_ROOM_AVATAR_FILE_IDS = [
  `${CLOUD_ASSET_ROOT}room-liberal-young-male.webp`,
  `${CLOUD_ASSET_ROOT}room-liberal-young-female.webp`,
  `${CLOUD_ASSET_ROOT}room-liberal-middle-male.webp`,
  `${CLOUD_ASSET_ROOT}room-liberal-middle-female.webp`,
  `${CLOUD_ASSET_ROOT}room-liberal-elder-male.webp`,
  `${CLOUD_ASSET_ROOT}room-liberal-elder-female.webp`,
  `${CLOUD_ASSET_ROOT}room-fascist-male-1.webp`,
  `${CLOUD_ASSET_ROOT}room-fascist-male-2.webp`,
  `${CLOUD_ASSET_ROOT}room-fascist-female.webp`,
  `${CLOUD_ASSET_ROOT}room-fascist-hitler.webp`,
];
const DEFAULT_AVATAR_FILE_ID = `${CLOUD_ASSET_ROOT}man-in-black.webp`;
const INITIAL_LOBBY_SNAPSHOT_TTL_MS = 30 * 1000;
const { resolveTempFileUrls } = require("../../utils/tempFileUrlCache");
const userProfileStore = require("../../utils/userProfileStore");

function createCommandId(prefix = "create_room") {
  return `cmd_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createServiceError(result, fallbackMessage) {
  const error = (result && result.error) || {};
  const code = error.code || "";
  const messageByCode = {
    INVALID_PAYLOAD: "请求参数有误",
    ROOM_NOT_FOUND: "房间不存在",
    ROOM_EXPIRED: "房间已过期",
    NOT_ROOM_MEMBER: "当前用户不在房间中",
    NOT_ROOM_HOST: "只有房主能使用房间设置功能",
    TARGET_COUNT_BELOW_SEATED: "选择人数不能小于当前最高座位号",
    GAME_ALREADY_STARTED: "对局已开始",
    ACTION_NOT_ALLOWED: "当前状态不允许执行该操作",
    INTERNAL_ERROR: "系统繁忙，请稍后重试",
  };
  const err = new Error(messageByCode[code] || (error && error.message) || fallbackMessage || "操作失败");
  err.code = code;
  err.retryable = Boolean(error.retryable);
  return err;
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

function getCachedUserProfile() {
  return userProfileStore.getCachedProfile();
}

function cacheInitialLobbySnapshot(room) {
  if (!room || !room.roomId || !room.lobbySnapshot) {
    return;
  }

  const app = getApp();
  app.globalData.initialLobbySnapshots = app.globalData.initialLobbySnapshots || {};
  app.globalData.initialLobbySnapshots[room.roomId] = {
    memberId: room.memberId || "",
    lobbySnapshot: room.lobbySnapshot,
    expiresAt: Date.now() + INITIAL_LOBBY_SNAPSHOT_TTL_MS,
  };
}

function hydrateCards(cards, urlByFileId) {
  return cards.map((card) => ({
    ...card,
    avatarSrc: urlByFileId[card.fileId] || "",
  }));
}

function buildRoleData(count, urlByFileId = {}) {
  const config = ROOM_ROLE_DATA[count] || ROOM_ROLE_DATA[6];
  return {
    liberalCount: config.liberalCards.length,
    fascistTotal: config.fascistCards.length,
    liberalCards: hydrateCards(config.liberalCards, urlByFileId),
    fascistCards: hydrateCards(config.fascistCards, urlByFileId),
  };
}

Page({
  avatarUrlByFileId: {},

  data: {
    playerCounts,
    selectedCount: 6,
    mode: "normal",
    roomId: "",
    seatedPlayerCount: 0,
    highestOccupiedSeatIndex: 0,
    isSubmitting: false,
    isLoadingSettings: false,
    preloadedAvatars: [],
    ...buildRoleData(6),
  },

  async onLoad(options = {}) {
    const mode = options.mode === "solo" ? "solo" : options.mode === "roomSettings" ? "roomSettings" : "normal";
    const roomId = String(options.roomId || "");

    if (mode !== "roomSettings" && !(await userProfileStore.getCachedProfileAsync())) {
      wx.redirectTo({
        url: "/pages/user-profile/index",
      });
      return;
    }

    this.setData({
      mode,
      roomId,
    });
    this.loadAllRoleAvatars();
    if (mode === "roomSettings") {
      this.loadRoomSettings(roomId);
    }
  },

  onSelectCount(event) {
    const selectedCount = Number(event.currentTarget.dataset.count);
    this.setData({
      selectedCount,
      ...buildRoleData(selectedCount, this.avatarUrlByFileId),
    });
  },

  loadAllRoleAvatars() {
    if (!wx.cloud) {
      return;
    }

    resolveTempFileUrls(ALL_ROOM_AVATAR_FILE_IDS)
      .then((urlByFileId) => {
        ALL_ROOM_AVATAR_FILE_IDS.forEach((fileId) => {
          if (!urlByFileId[fileId]) {
            console.error("创建房间头像云存储临时链接获取失败", fileId);
          }
        });
        this.avatarUrlByFileId = urlByFileId;
        this.setData({
          ...buildRoleData(this.data.selectedCount, this.avatarUrlByFileId),
          preloadedAvatars: Object.keys(urlByFileId).map((fileId) => urlByFileId[fileId]),
        });
      })
      .catch((err) => {
        console.error("创建房间头像云存储临时链接获取失败", err);
      });
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

  onBackHome() {
    wx.navigateBack({
      delta: 1,
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

  async loadRoomSettings(roomId) {
    if (!roomId || !wx.cloud) {
      wx.showToast({
        title: "房间信息无效",
        icon: "none",
      });
      wx.navigateBack({ delta: 1 });
      return;
    }

    this.setData({
      isLoadingSettings: true,
    });

    try {
      const lobby = await this.callRoomService("getLobbySnapshot", {
        roomId,
      });
      const seatedPlayerCount = Number(lobby.playerCount || ((lobby.seatOrder || []).length || 0));
      const highestOccupiedSeatIndex = (lobby.seatOrder || []).reduce(
        (highestSeatIndex, member) => Math.max(highestSeatIndex, Number(member.seatIndex) || 0),
        0,
      );
      if (!lobby.viewerState || !lobby.viewerState.isHost) {
        wx.showToast({
          title: "只有房主能使用房间设置功能",
          icon: "none",
        });
        setTimeout(() => {
          wx.navigateBack({ delta: 1 });
        }, 600);
        return;
      }

      const selectedCount = Number(lobby.targetPlayerCount || 6);
      this.setData({
        selectedCount,
        seatedPlayerCount,
        highestOccupiedSeatIndex,
        isLoadingSettings: false,
        ...buildRoleData(selectedCount, this.avatarUrlByFileId),
      });
    } catch (err) {
      console.error("读取房间设置失败", err);
      wx.showToast({
        title: err.message || "读取房间失败",
        icon: "none",
      });
      this.setData({
        isLoadingSettings: false,
      });
      setTimeout(() => {
        wx.navigateBack({ delta: 1 });
      }, 800);
    }
  },

  async onCompleteRoomSettings() {
    if (this.data.isSubmitting || this.data.isLoadingSettings) {
      return;
    }

    if (
      this.data.selectedCount < this.data.seatedPlayerCount ||
      this.data.selectedCount < this.data.highestOccupiedSeatIndex
    ) {
      wx.showToast({
        title: "选择人数不能小于当前最高座位号",
        icon: "none",
      });
      return;
    }

    this.setData({
      isSubmitting: true,
    });

    try {
      const result = await this.callRoomService("updateRoomSettings", {
        commandId: createCommandId("update_room_settings"),
        roomId: this.data.roomId,
        targetPlayerCount: this.data.selectedCount,
      });
      const lobbySnapshot = result.lobbySnapshot || result;
      if (lobbySnapshot && lobbySnapshot.roomId) {
        cacheInitialLobbySnapshot({
          roomId: lobbySnapshot.roomId,
          memberId: lobbySnapshot.viewerState && lobbySnapshot.viewerState.myMemberId,
          lobbySnapshot,
        });
      }
      wx.navigateBack({
        delta: 1,
      });
    } catch (err) {
      console.error("更新房间设置失败", err);
      wx.showToast({
        title: err.message || "更新房间设置失败",
        icon: "none",
      });
      this.setData({
        isSubmitting: false,
      });
    }
  },

  async onCreateRoom() {
    if (this.data.isSubmitting) {
      return;
    }

    if (!wx.cloud) {
      wx.showToast({
        title: "当前基础库不支持云能力",
        icon: "none",
      });
      return;
    }

    this.setData({
      isSubmitting: true,
    });

    let uploadedAvatarFileId = "";
    try {
      const profile = getCachedUserProfile();
      if (!profile) {
        wx.redirectTo({
          url: "/pages/user-profile/index",
        });
        return;
      }

      const isSoloMode = this.data.mode === "solo";
      const commandId = createCommandId(isSoloMode ? "solo_create_room" : "create_room");
      uploadedAvatarFileId = await this.uploadRoomAvatarIfNeeded(profile, commandId);

      const res = await wx.cloud.callFunction({
        name: "roomService",
        data: {
          action: isSoloMode ? "soloCreateRoom" : "createRoom",
          payload: {
            commandId,
            targetPlayerCount: this.data.selectedCount,
            displayName: profile.displayName,
            avatarUrl: uploadedAvatarFileId,
          },
        },
      });
      const result = res.result || {};

      if (!result.success) {
        await this.deleteUploadedAvatar(uploadedAvatarFileId);
        uploadedAvatarFileId = "";
        throw createServiceError(result, "创建房间失败");
      }

      const room = result.data || {};
      cacheInitialLobbySnapshot(room);
      wx.redirectTo({
        url: `/packageRoom/pages/lobby/index?roomId=${encodeURIComponent(room.roomId)}&memberId=${encodeURIComponent(room.memberId || "")}`,
      });
    } catch (err) {
      console.error("创建房间失败", err);
      wx.showToast({
        title: err.message || "创建房间失败",
        icon: "none",
      });
      this.setData({
        isSubmitting: false,
      });
    }
  },

  onComplete() {
    if (this.data.mode === "roomSettings") {
      this.onCompleteRoomSettings();
      return;
    }
    this.onCreateRoom();
  },
});
