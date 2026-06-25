const CLOUD_ASSET_ROOT =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/";
const IDENTITY_BACKGROUND_FILE_ID = `${CLOUD_ASSET_ROOT}background-identity.webp`;
const IDENTITY_CARD_FILE_ID_BY_ROLE = {
  LIBERAL: `${CLOUD_ASSET_ROOT}identity-liberal.webp`,
  FASCIST: `${CLOUD_ASSET_ROOT}identity-fascist.webp`,
  HITLER: `${CLOUD_ASSET_ROOT}identity-hitler.webp`,
};
const IDENTITY_PANEL_FRAME_FILE_ID = `${CLOUD_ASSET_ROOT}identity-frame.webp`;
const IDENTITY_PANEL_FRAME_WIDE_FILE_ID = `${CLOUD_ASSET_ROOT}identity-frame-wide.webp`;
const IDENTITY_TEAMMATE_PANEL_FILE_ID = `${CLOUD_ASSET_ROOT}identity-teammate.webp`;
const IDENTITY_BUTTON_FILE_IDS = {
  primary: `${CLOUD_ASSET_ROOT}button-blue.webp`,
  secondary: `${CLOUD_ASSET_ROOT}button-normal.webp`,
};
const DEFAULT_AVATAR_FILE_ID = `${CLOUD_ASSET_ROOT}man-in-black.webp`;
const {
  GAME_PAGE_TIMEOUT_MS,
  clearPageTimeout,
  handlePageTimeout,
  schedulePageTimeout,
  setupPageTimeout,
  syncPageTimeoutDeadline,
} = require("../../../utils/pageTimeout");
const { getGameSnapshotCache } = require("../../../utils/gameSnapshotCache");
const { reLaunchPage } = require("../../../utils/protectedPageRoute");

const ROLE_META = {
  LIBERAL: {
    roleLabel: "自由派",
    partyLabel: "自由派阵营",
    cardClass: "liberal-card",
    sealText: "机密",
  },
  FASCIST: {
    roleLabel: "极权派",
    partyLabel: "极权派阵营",
    cardClass: "fascist-card",
    sealText: "机密",
  },
  HITLER: {
    roleLabel: "独裁者",
    partyLabel: "极权派阵营",
    cardClass: "dictator-card",
    sealText: "绝密",
  },
};

const ACTION_TIPS = {
  LIBERAL: ["记录每轮提名、投票和政策结果。", "保护可信玩家，逼迫可疑组合解释矛盾。", "当处决权出现时，集中信息找出独裁者。"],
  FASCIST: ["保护独裁者的身份，不要让线索过早汇聚。", "用投票和发言制造合理分歧。", "在关键回合推动极权派政策上轨。"],
  HITLER: ["前期隐藏立场，避免成为公开焦点。", "三张极权派政策后，争取以可信身份当选总理。", "让队友替你制造空间，但不要暴露配合痕迹。"],
};

const ERROR_MESSAGE_MAP = {
  ROOM_NOT_FOUND: "房间不存在或已失效",
  ROOM_EXPIRED: "房间已过期",
  GAME_ALREADY_ENDED: "对局已结束",
  FORBIDDEN: "你当前不能查看该信息",
  ACTION_NOT_ALLOWED: "当前状态不允许查看该信息",
  INTERNAL_ERROR: "服务暂时异常，请稍后再试",
};

function isCloudFileId(fileId) {
  return typeof fileId === "string" && fileId.indexOf("cloud://") === 0;
}

function getRoleMeta(role) {
  return ROLE_META[role] || ROLE_META.LIBERAL;
}

Page({
  data: {
    roomId: "",
    controlledMemberId: "",
    isLoading: true,
    errorText: "",
    backgroundSrc: "",
    backgroundVisible: true,
    panelFrameSrc: "",
    infoPanelFrameSrc: "",
    teammatePanelSrc: "",
    actionButtonAssets: {},
    identity: null,
    knownMembers: [],
    infoLines: [],
    actionTips: [],
  },

  onLoad(options = {}) {
    this.setData({
      roomId: options.roomId || "",
      controlledMemberId: options.controlledMemberId || "",
    });
    setupPageTimeout(this, {
      timeoutMs: GAME_PAGE_TIMEOUT_MS,
      deadlineAt: options.timeoutDeadlineAt,
    });
    this.loadIdentitySnapshot();
  },

  onShow() {
    schedulePageTimeout(this, {
      timeoutMs: GAME_PAGE_TIMEOUT_MS,
    });
  },

  onHide() {
    clearPageTimeout(this);
  },

  onUnload() {
    clearPageTimeout(this);
  },

  async loadIdentitySnapshot() {
    if (!this.data.roomId) {
      this.setData({
        isLoading: false,
        errorText: "房间信息缺失",
        backgroundVisible: false,
      });
      return;
    }

    const cachedSnapshot = getGameSnapshotCache(this.data.roomId, this.data.controlledMemberId || "");
    if (!cachedSnapshot && !wx.cloud) {
      this.setData({
        isLoading: false,
        errorText: "房间信息缺失",
        backgroundVisible: false,
      });
      return;
    }

    this.setData({
      isLoading: true,
      errorText: "",
    });

    try {
      let snapshot = cachedSnapshot;
      if (!snapshot) {
        const res = await wx.cloud.callFunction({
          name: "gameService",
          data: {
            action: "getGameSnapshot",
            payload: {
              roomId: this.data.roomId,
              controlledMemberId: this.data.controlledMemberId || "",
            },
          },
        });
        const result = res.result || {};
        if (!result.success) {
          throw this.createServiceError(result, "获取身份信息失败");
        }
        snapshot = result.data;
      }

      syncPageTimeoutDeadline(this, snapshot && snapshot.expireAt);
      await this.hydrateIdentity(snapshot);
    } catch (err) {
      console.error("获取身份信息失败", err);
      if (err.code === "ROOM_EXPIRED" || err.code === "ROOM_NOT_FOUND" || err.code === "NOT_ROOM_MEMBER") {
        handlePageTimeout(this, {
          reasonCode: err.code,
        });
        return;
      }

      this.setData({
        errorText: err.message || "获取身份信息失败",
      });
      wx.showToast({
        title: err.message || "获取身份信息失败",
        icon: "none",
      });
    } finally {
      this.setData({
        isLoading: false,
      });
    }
  },

  async hydrateIdentity(snapshot) {
    const privateState = (snapshot && snapshot.privateState) || {};
    const rawIdentity = privateState.identity || {};
    if (!rawIdentity.role || !rawIdentity.party) {
      throw new Error("身份数据尚未就绪");
    }

    const knownMembers = rawIdentity.knownMembers || [];
    const roleMeta = getRoleMeta(rawIdentity.role);
    const cardFileId = IDENTITY_CARD_FILE_ID_BY_ROLE[rawIdentity.role] || IDENTITY_CARD_FILE_ID_BY_ROLE.LIBERAL;
    const tempUrlByFileId = await this.loadCloudAssets(knownMembers, cardFileId);
    const viewIdentity = {
      role: rawIdentity.role,
      party: rawIdentity.party,
      roleLabel: roleMeta.roleLabel,
      partyLabel: roleMeta.partyLabel,
      cardClass: roleMeta.cardClass,
      sealText: roleMeta.sealText,
      cardSrc: tempUrlByFileId[cardFileId] || "",
      missionLines: this.createMissionLines(rawIdentity.role),
    };

    this.setData({
      identity: viewIdentity,
      knownMembers: this.createKnownMembers(knownMembers, tempUrlByFileId),
      infoLines: this.createInfoLines(rawIdentity),
      actionTips: ACTION_TIPS[rawIdentity.role] || ACTION_TIPS.LIBERAL,
    });
  },

  loadCloudAssets(knownMembers, cardFileId) {
    if (!wx.cloud) {
      this.setData({
        backgroundVisible: false,
      });
      return Promise.resolve({});
    }

    const fileList = [
      IDENTITY_BACKGROUND_FILE_ID,
      IDENTITY_PANEL_FRAME_FILE_ID,
      IDENTITY_PANEL_FRAME_WIDE_FILE_ID,
      IDENTITY_TEAMMATE_PANEL_FILE_ID,
      cardFileId,
      IDENTITY_BUTTON_FILE_IDS.primary,
      IDENTITY_BUTTON_FILE_IDS.secondary,
      DEFAULT_AVATAR_FILE_ID,
    ].filter(Boolean);
    (knownMembers || []).forEach((member) => {
      if (isCloudFileId(member.avatarUrl)) {
        fileList.push(member.avatarUrl);
      }
    });

    return wx.cloud
      .getTempFileURL({
        fileList: Array.from(new Set(fileList)),
      })
      .then((res) => {
        const urlByFileId = {};
        (res.fileList || []).forEach((file) => {
          if (file.status === 0 && file.tempFileURL) {
            urlByFileId[file.fileID] = file.tempFileURL;
          } else {
            console.error("身份页云存储临时链接获取失败", file);
          }
        });

        this.setData({
          backgroundSrc: urlByFileId[IDENTITY_BACKGROUND_FILE_ID] || "",
          backgroundVisible: Boolean(urlByFileId[IDENTITY_BACKGROUND_FILE_ID]),
          panelFrameSrc: urlByFileId[IDENTITY_PANEL_FRAME_FILE_ID] || "",
          infoPanelFrameSrc:
            (knownMembers || []).length > 1
              ? urlByFileId[IDENTITY_PANEL_FRAME_WIDE_FILE_ID] || urlByFileId[IDENTITY_PANEL_FRAME_FILE_ID] || ""
              : urlByFileId[IDENTITY_PANEL_FRAME_FILE_ID] || "",
          teammatePanelSrc: urlByFileId[IDENTITY_TEAMMATE_PANEL_FILE_ID] || "",
          actionButtonAssets: {
            primary: urlByFileId[IDENTITY_BUTTON_FILE_IDS.primary] || "",
            secondary: urlByFileId[IDENTITY_BUTTON_FILE_IDS.secondary] || "",
          },
        });

        return urlByFileId;
      })
      .catch((err) => {
        console.error("身份页云存储临时链接获取失败", err);
        this.setData({
          backgroundVisible: false,
        });
        return {};
      });
  },

  createMissionLines(role) {
    if (role === "LIBERAL") {
      return ["推动 5 项自由派政策完成胜利。", "或在处决阶段找出并处决独裁者。"];
    }
    if (role === "HITLER") {
      return ["协助极权派推动 6 项极权派政策。", "或在 3 项极权派政策后当选总理。"];
    }
    return ["保护独裁者，并推动 6 项极权派政策。", "或在 3 项极权派政策后让独裁者当选总理。"];
  },

  createKnownMembers(knownMembers, tempUrlByFileId) {
    const defaultAvatarSrc = tempUrlByFileId[DEFAULT_AVATAR_FILE_ID] || "";
    return (knownMembers || []).map((member) => {
      const meta = getRoleMeta(member.role);
      const avatarSrc = isCloudFileId(member.avatarUrl)
        ? tempUrlByFileId[member.avatarUrl] || defaultAvatarSrc
        : member.avatarUrl || defaultAvatarSrc;
      return {
        memberId: member.memberId,
        displayName: member.displayName || "未知玩家",
        initial: String(member.displayName || "？").slice(0, 1),
        roleLabel: meta.roleLabel,
        knownLabel: member.role === "HITLER" ? "独裁者" : "极权派队友",
        avatarSrc,
      };
    });
  },

  createInfoLines(identity) {
    const knownCount = (identity.knownMembers || []).length;
    if (knownCount > 0) {
      return ["你当前可确认的队友如下："];
    }

    if (identity.role === "HITLER") {
      return ["本局你无法获知普通极权派队友。"];
    }

    if (identity.role === "LIBERAL") {
      return ["自由派没有开局可见队友信息。"];
    }

    return ["当前没有可见队友信息。"];
  },

  createServiceError(result, fallbackMessage) {
    const error = (result && result.error) || {};
    const code = error.code || "";
    const err = new Error(ERROR_MESSAGE_MAP[code] || fallbackMessage || "操作失败");
    err.code = code;
    err.retryable = Boolean(error.retryable);
    err.isBusinessFailure = true;
    return err;
  },

  onBackgroundError() {
    console.error("身份页背景图加载失败", this.data.backgroundSrc);
    this.setData({
      backgroundVisible: false,
    });
  },

  onIdentityAssetError(event) {
    console.error("身份页素材加载失败", event);
  },

  onBackBoard() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({
        delta: 1,
      });
      return;
    }

    reLaunchPage(`/packageRoom/pages/board/index?roomId=${encodeURIComponent(this.data.roomId)}`);
  },

  onTapRules() {
    const timeoutDeadlineAt = this.__pageTimeoutDeadline || Date.now() + GAME_PAGE_TIMEOUT_MS;
    wx.navigateTo({
      url: `/packageRoom/pages/rules/index?roomId=${encodeURIComponent(this.data.roomId || "")}&controlledMemberId=${encodeURIComponent(
        this.data.controlledMemberId || "",
      )}&timeoutMs=${GAME_PAGE_TIMEOUT_MS}&timeoutDeadlineAt=${timeoutDeadlineAt}`,
    });
  },

});
