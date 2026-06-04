const HOME_BACKGROUND_FILE_ID =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/background-home.webp";
const DEFAULT_AVATAR_FILE_ID =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/man-in-black.webp";
const INITIAL_LOBBY_SNAPSHOT_TTL_MS = 30 * 1000;
const { showTimeoutModalIfNeeded } = require("../../utils/pageTimeout");
const { buildHomeShare, enableShareMenu } = require("../../utils/share");
const userProfileStore = require("../../utils/userProfileStore");

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

Page({
  data: {
    homeBackgroundSrc: "",
    homeBackgroundVisible: true,
    profileAvatarSrc: "",
    joinCode: "",
    joinDialogVisible: false,
    isJoining: false,
  },

  onLoad(options = {}) {
    showTimeoutModalIfNeeded(options);
    enableShareMenu();

    const sharedRoomCode = parseJoinTarget(options.roomCode);
    if (sharedRoomCode && sharedRoomCode.roomCode) {
      this.setData({
        joinCode: sharedRoomCode.roomCode,
      });
    }

    this.loadHomeBackground();
  },

  onShow() {
    this.loadProfileAvatar();
  },

  onShareAppMessage() {
    return buildHomeShare();
  },

  onShareTimeline() {
    const share = buildHomeShare();
    return {
      title: share.title,
    };
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

  async loadProfileAvatar() {
    const profile = await userProfileStore.getCachedProfileAsync();
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

  async onCreateRoom() {
    if (!(await userProfileStore.getCachedProfileAsync())) {
      wx.navigateTo({
        url: buildProfileRedirectUrl("/pages/create-room/index"),
      });
      return;
    }

    wx.navigateTo({
      url: "/pages/create-room/index",
    });
  },

  async onCreateSoloRoom() {
    if (!(await userProfileStore.getCachedProfileAsync())) {
      wx.navigateTo({
        url: buildProfileRedirectUrl("/pages/create-room/index?mode=solo"),
      });
      return;
    }

    wx.navigateTo({
      url: "/pages/create-room/index?mode=solo",
    });
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
    const profile = await userProfileStore.getCachedProfileAsync();
    if (!profile) {
      const homeUrl =
        joinTarget && joinTarget.roomCode
          ? `/pages/home/index?roomCode=${encodeURIComponent(joinTarget.roomCode)}`
          : "/pages/home/index";
      wx.navigateTo({
        url: buildProfileRedirectUrl(homeUrl),
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
