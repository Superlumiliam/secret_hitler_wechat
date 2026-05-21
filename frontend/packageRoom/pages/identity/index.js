const CLOUD_ASSET_ROOT =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/";
const IDENTITY_BACKGROUND_FILE_ID = `${CLOUD_ASSET_ROOT}background-identity.webp`;
const IDENTITY_CARD_FILE_ID_BY_ROLE = {
  LIBERAL: `${CLOUD_ASSET_ROOT}identity-liberal.webp`,
  FASCIST: `${CLOUD_ASSET_ROOT}identity-fascist.webp`,
  HITLER: `${CLOUD_ASSET_ROOT}identity-hitler.webp`,
};
const {
  GAME_PAGE_TIMEOUT_MS,
  clearPageTimeout,
  handlePageTimeout,
  schedulePageTimeout,
  setupPageTimeout,
  syncPageTimeoutDeadline,
} = require("../../../utils/pageTimeout");

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
  LIBERAL: ["关注政府组合与投票记录", "重点留意关键回合的政策变化", "复盘页可帮助你回顾可疑行为"],
  FASCIST: ["协助独裁者隐藏身份", "必要时制造投票分歧", "推动极权派政策进入政策轨"],
  HITLER: ["谨慎接受总理提名", "隐藏真实身份，避免过早暴露", "三张极权派政策后争取当选总理"],
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
    if (!this.data.roomId || !wx.cloud) {
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

      syncPageTimeoutDeadline(this, result.data && result.data.expireAt);
      await this.hydrateIdentity(result.data);
    } catch (err) {
      console.error("获取身份信息失败", err);
      if (err.code === "ROOM_EXPIRED" || err.code === "ROOM_NOT_FOUND" || err.code === "NOT_ROOM_MEMBER") {
        handlePageTimeout(this);
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
      roleSymbol: rawIdentity.role === "LIBERAL" ? "鸽" : "印",
      cardSrc: tempUrlByFileId[cardFileId] || "",
      missionLine: this.createMissionLine(rawIdentity.role),
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
      cardFileId,
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

  createMissionLine(role) {
    if (role === "LIBERAL") {
      return "推动 5 项自由派政策，或找出处决独裁者";
    }
    if (role === "HITLER") {
      return "隐藏身份，并在关键时刻成为总理";
    }
    return "保护独裁者，并推动 6 项极权派政策";
  },

  createKnownMembers(knownMembers, tempUrlByFileId) {
    return (knownMembers || []).map((member) => {
      const meta = getRoleMeta(member.role);
      return {
        memberId: member.memberId,
        displayName: member.displayName || "未知玩家",
        initial: String(member.displayName || "？").slice(0, 1),
        roleLabel: meta.roleLabel,
        partyLabel: meta.partyLabel,
        avatarSrc: isCloudFileId(member.avatarUrl) ? tempUrlByFileId[member.avatarUrl] || "" : member.avatarUrl || "",
      };
    });
  },

  createInfoLines(identity) {
    const knownCount = (identity.knownMembers || []).length;
    if (identity.role === "LIBERAL") {
      return ["没有公开队友信息", "请根据投票、发言和政策结果判断身份", "隐藏身份，谨慎表达立场"];
    }

    if (identity.role === "HITLER") {
      if (knownCount > 0) {
        return ["5-6 人局中你知道普通极权派是谁", "普通极权派也知道你的身份", "你的阵营是极权派阵营"];
      }
      return ["7-10 人局中你不知道普通极权派是谁", "普通极权派知道你的身份", "你的阵营是极权派阵营"];
    }

    return ["你知道其他极权派成员", "你知道谁是独裁者", "你的阵营是极权派阵营"];
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

    wx.redirectTo({
      url: `/packageRoom/pages/board/index?roomId=${encodeURIComponent(this.data.roomId)}`,
    });
  },

  onTapRules() {
    const timeoutDeadlineAt = this.__pageTimeoutDeadline || Date.now() + GAME_PAGE_TIMEOUT_MS;
    wx.navigateTo({
      url: `/packageRoom/pages/rules/index?roomId=${encodeURIComponent(this.data.roomId || "")}&controlledMemberId=${encodeURIComponent(
        this.data.controlledMemberId || "",
      )}&timeoutMs=${GAME_PAGE_TIMEOUT_MS}&timeoutDeadlineAt=${timeoutDeadlineAt}`,
    });
  },

  onTapPrivacy() {
    wx.showToast({
      title: "身份信息请勿外泄",
      icon: "none",
    });
  },
});
