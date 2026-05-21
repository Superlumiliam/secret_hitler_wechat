const HOME_BACKGROUND_FILE_ID =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/background-home.webp";
const DEFAULT_AVATAR_FILE_ID =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/man-in-black.webp";
const PROFILE_STORAGE_KEY = "secret_hitler_user_profile";
const INITIAL_LOBBY_SNAPSHOT_TTL_MS = 30 * 1000;
const { showTimeoutModalIfNeeded } = require("../../utils/pageTimeout");

function createCommandId(prefix) {
  return `cmd_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getCachedUserProfile() {
  try {
    const profile = wx.getStorageSync(PROFILE_STORAGE_KEY);
    if (profile && profile.profileCompleted && profile.displayName) {
      return profile;
    }
  } catch (err) {
    console.error("读取用户资料缓存失败", err);
  }
  return null;
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

function decodeSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch (err) {
    return value;
  }
}

function parseJoinTarget(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return null;
  }

  const decodedValue = decodeSafe(rawValue);
  const roomCodeMatch = decodedValue.match(/[?&]roomCode=([^&#]+)/);
  if (roomCodeMatch && roomCodeMatch[1]) {
    const roomCode = decodeSafe(roomCodeMatch[1]).replace(/\s|-/g, "");
    if (/^\d{6}$/.test(roomCode)) {
      return { roomCode };
    }
  }

  const compactValue = decodedValue.replace(/\s|-/g, "");
  if (/^\d{6}$/.test(compactValue)) {
    return {
      roomCode: compactValue,
    };
  }

  const embeddedCodeMatch = decodedValue.match(/\b\d{6}\b/);
  if (embeddedCodeMatch) {
    return {
      roomCode: embeddedCodeMatch[0],
    };
  }

  return null;
}

function createServiceError(result, fallbackMessage) {
  const error = (result && result.error) || {};
  const err = new Error(error.message || fallbackMessage);
  err.code = error.code || "";
  err.retryable = Boolean(error.retryable);
  err.isBusinessFailure = true;
  return err;
}

function getJoinErrorMessage(err) {
  const code = err && err.code;
  const messages = {
    INVALID_PAYLOAD: "请输入 6 位房间号",
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

const DEV_PLAYER_COUNTS = [5, 6, 7, 8, 9, 10].map((value) => ({
  value,
}));

function isDeveloperModeEnabled() {
  const app = getApp();
  const envId = app.globalData && app.globalData.env;
  const developerMode = (app.globalData && app.globalData.developerMode) || {};
  const enabledEnvIds = developerMode.enabledEnvIds || [];
  const storageKey = developerMode.storageKey || "secret_hitler_developer_mode_enabled";
  let localEnabled = false;
  try {
    localEnabled = wx.getStorageSync(storageKey) === true;
  } catch (err) {
    localEnabled = false;
  }
  return Boolean(localEnabled && envId && enabledEnvIds.includes(envId));
}

function enableDeveloperModeFromOptions(options = {}) {
  if (String(options.devMode || "") !== "1") {
    return;
  }

  const app = getApp();
  const developerMode = (app.globalData && app.globalData.developerMode) || {};
  const storageKey = developerMode.storageKey || "secret_hitler_developer_mode_enabled";
  try {
    wx.setStorageSync(storageKey, true);
  } catch (err) {
    console.error("启用开发者模式缓存失败", err);
  }
}

Page({
  data: {
    homeBackgroundSrc: "",
    homeBackgroundVisible: true,
    profileAvatarSrc: "",
    developerModeEnabled: false,
    devPlayerCounts: DEV_PLAYER_COUNTS,
    selectedDevPlayerCount: 6,
    joinCode: "",
    joinDialogVisible: false,
    isJoining: false,
    isCreatingDevRoom: false,
  },

  onLoad(options = {}) {
    enableDeveloperModeFromOptions(options);
    showTimeoutModalIfNeeded(options);

    const sharedRoomCode = parseJoinTarget(options.roomCode);
    if (sharedRoomCode && sharedRoomCode.roomCode) {
      this.setData({
        joinCode: sharedRoomCode.roomCode,
      });
    }

    this.setData({
      developerModeEnabled: isDeveloperModeEnabled(),
    });
    this.loadHomeBackground();
  },

  onShow() {
    this.loadProfileAvatar();
  },

  loadHomeBackground() {
    if (!wx.cloud) {
      this.setData({
        homeBackgroundVisible: false,
      });
      return;
    }

    wx.cloud.getTempFileURL({
      fileList: [HOME_BACKGROUND_FILE_ID],
      success: (res) => {
        const file = res.fileList && res.fileList[0];
        if (!file || file.status !== 0 || !file.tempFileURL) {
          console.error("首页背景图云存储临时链接获取失败", file);
          this.setData({
            homeBackgroundVisible: false,
          });
          return;
        }

        this.setData({
          homeBackgroundSrc: file.tempFileURL,
          homeBackgroundVisible: true,
        });
      },
      fail: (err) => {
        console.error("首页背景图云存储临时链接获取失败", err);
        this.setData({
          homeBackgroundVisible: false,
        });
      },
    });
  },

  onBackgroundError() {
    console.error("首页背景图加载失败", this.data.homeBackgroundSrc);
    this.setData({
      homeBackgroundVisible: false,
    });
  },

  loadProfileAvatar() {
    const profile = getCachedUserProfile();
    const avatarUrl = profile && profile.avatarUrl ? profile.avatarUrl : DEFAULT_AVATAR_FILE_ID;
    this.loadCloudAvatar(avatarUrl, avatarUrl !== DEFAULT_AVATAR_FILE_ID);
  },

  loadCloudAvatar(avatarUrl, canFallbackToDefault) {
    if (!isCloudFileId(avatarUrl)) {
      this.setData({
        profileAvatarSrc: avatarUrl,
      });
      return;
    }

    if (!wx.cloud) {
      this.setData({
        profileAvatarSrc: "",
      });
      return;
    }

    wx.cloud.getTempFileURL({
      fileList: [avatarUrl],
      success: (res) => {
        const file = res.fileList && res.fileList[0];
        if (!file || file.status !== 0 || !file.tempFileURL) {
          console.error("首页头像云存储临时链接获取失败", file);
          if (canFallbackToDefault) {
            this.loadCloudAvatar(DEFAULT_AVATAR_FILE_ID, false);
            return;
          }
          this.setData({
            profileAvatarSrc: "",
          });
          return;
        }

        this.setData({
          profileAvatarSrc: file.tempFileURL,
        });
      },
      fail: (err) => {
        console.error("首页头像云存储临时链接获取失败", err);
        if (canFallbackToDefault) {
          this.loadCloudAvatar(DEFAULT_AVATAR_FILE_ID, false);
          return;
        }
        this.setData({
          profileAvatarSrc: "",
        });
      },
    });
  },

  onProfileEntry() {
    wx.navigateTo({
      url: "/pages/user-profile/index",
    });
  },

  onCreateRoom() {
    if (!getCachedUserProfile()) {
      wx.navigateTo({
        url: "/pages/user-profile/index",
      });
      return;
    }

    wx.navigateTo({
      url: "/pages/create-room/index",
    });
  },

  onSelectDevPlayerCount(event) {
    const count = Number(event.currentTarget.dataset.count);
    if (count < 5 || count > 10) {
      return;
    }

    this.setData({
      selectedDevPlayerCount: count,
    });
  },

  async onCreateDevRoom() {
    if (this.data.isCreatingDevRoom) {
      return;
    }

    const profile = getCachedUserProfile();
    if (!profile) {
      wx.navigateTo({
        url: "/pages/user-profile/index",
      });
      return;
    }

    if (!wx.cloud) {
      wx.showToast({
        title: "当前基础库不支持云能力",
        icon: "none",
      });
      return;
    }

    const app = getApp();
    const developerMode = (app.globalData && app.globalData.developerMode) || {};
    if (!isDeveloperModeEnabled()) {
      return;
    }

    this.setData({
      isCreatingDevRoom: true,
    });

    let uploadedAvatarFileId = "";
    try {
      const commandId = createCommandId("dev_create_room");
      uploadedAvatarFileId = await this.uploadRoomAvatarIfNeeded(profile, commandId);

      const res = await wx.cloud.callFunction({
        name: "roomService",
        data: {
          action: "devCreateRoom",
          payload: {
            commandId,
            targetPlayerCount: this.data.selectedDevPlayerCount || developerMode.targetPlayerCount || 6,
            displayName: profile.displayName,
            avatarUrl: uploadedAvatarFileId,
          },
        },
      });
      const result = res.result || {};

      if (!result.success) {
        await this.deleteUploadedAvatar(uploadedAvatarFileId);
        uploadedAvatarFileId = "";
        throw createServiceError(result, "创建开发者房间失败");
      }

      const room = result.data || {};
      cacheInitialLobbySnapshot(room);
      wx.redirectTo({
        url: `/packageRoom/pages/lobby/index?roomId=${encodeURIComponent(room.roomId)}&memberId=${encodeURIComponent(room.memberId || "")}`,
      });
    } catch (err) {
      console.error("创建开发者房间失败", err);
      wx.showToast({
        title: err.message || "创建开发者房间失败",
        icon: "none",
      });
      this.setData({
        isCreatingDevRoom: false,
      });
    }
  },

  onOpenJoinDialog() {
    this.setData({
      joinDialogVisible: true,
    });
  },

  onCloseJoinDialog() {
    if (this.data.isJoining) {
      return;
    }

    this.setData({
      joinDialogVisible: false,
    });
  },

  onJoinInput(event) {
    this.setData({
      joinCode: event.detail.value,
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

  async onJoinRoom() {
    if (this.data.isJoining) {
      return;
    }

    const joinTarget = parseJoinTarget(this.data.joinCode);
    if (!getCachedUserProfile()) {
      const homeUrl =
        joinTarget && joinTarget.roomCode
          ? `/pages/home/index?roomCode=${encodeURIComponent(joinTarget.roomCode)}`
          : "/pages/home/index";
      wx.navigateTo({
        url: `/pages/user-profile/index?redirect=${encodeURIComponent(homeUrl)}`,
      });
      return;
    }

    if (!wx.cloud) {
      wx.showToast({
        title: "当前基础库不支持云能力",
        icon: "none",
      });
      return;
    }

    if (!joinTarget) {
      wx.showToast({
        title: "请输入 6 位房间号",
        icon: "none",
      });
      return;
    }

    this.setData({
      isJoining: true,
    });

    let uploadedAvatarFileId = "";
    try {
      const profile = getCachedUserProfile();
      const commandId = createCommandId("join_room");
      uploadedAvatarFileId = await this.uploadRoomAvatarIfNeeded(profile, commandId);

      const res = await wx.cloud.callFunction({
        name: "roomService",
        data: {
          action: "joinRoom",
          payload: {
            commandId,
            ...joinTarget,
            displayName: profile.displayName,
            avatarUrl: uploadedAvatarFileId,
          },
        },
      });
      const result = res.result || {};

      if (!result.success) {
        throw createServiceError(result, "加入房间失败");
      }

      const room = result.data || {};
      cacheInitialLobbySnapshot(room);
      this.setData({
        joinDialogVisible: false,
      });
      wx.redirectTo({
        url: `/packageRoom/pages/lobby/index?roomId=${encodeURIComponent(room.roomId)}&memberId=${encodeURIComponent(room.memberId || "")}`,
      });
    } catch (err) {
      if (err.isBusinessFailure) {
        await this.deleteUploadedAvatar(uploadedAvatarFileId);
        uploadedAvatarFileId = "";
      }
      console.error("加入房间失败", err);
      wx.showToast({
        title: getJoinErrorMessage(err),
        icon: "none",
      });
      this.setData({
        isJoining: false,
      });
    }
  },
});
