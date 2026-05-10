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
const PROFILE_STORAGE_KEY = "secret_hitler_user_profile";
const DEFAULT_AVATAR_FILE_ID = `${CLOUD_ASSET_ROOT}man-in-black.webp`;

function createCommandId() {
  return `cmd_create_room_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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
    isSubmitting: false,
    preloadedAvatars: [],
    ...buildRoleData(6),
  },

  onLoad() {
    if (!getCachedUserProfile()) {
      wx.redirectTo({
        url: "/pages/user-profile/index",
      });
      return;
    }

    this.loadAllRoleAvatars();
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

    wx.cloud.getTempFileURL({
      fileList: ALL_ROOM_AVATAR_FILE_IDS,
      success: (res) => {
        const urlByFileId = {};
        (res.fileList || []).forEach((file) => {
          if (file.status === 0 && file.tempFileURL) {
            urlByFileId[file.fileID] = file.tempFileURL;
          } else {
            console.error("创建房间头像云存储临时链接获取失败", file);
          }
        });

        this.avatarUrlByFileId = urlByFileId;
        this.setData({
          ...buildRoleData(this.data.selectedCount, this.avatarUrlByFileId),
          preloadedAvatars: Object.keys(urlByFileId).map((fileId) => urlByFileId[fileId]),
        });
      },
      fail: (err) => {
        console.error("创建房间头像云存储临时链接获取失败", err);
      },
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

      const commandId = createCommandId();
      uploadedAvatarFileId = await this.uploadRoomAvatarIfNeeded(profile, commandId);

      const res = await wx.cloud.callFunction({
        name: "roomService",
        data: {
          action: "createRoom",
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
        throw new Error((result.error && result.error.message) || "创建房间失败");
      }

      const room = result.data || {};
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
});
