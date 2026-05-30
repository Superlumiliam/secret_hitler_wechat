const { rulesContent } = require("../../static/rulesContent");
const CLOUD_ASSET_ROOT =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/";
const RULE_ASSET_FILE_IDS_BY_KEY = {
  story: [`${CLOUD_ASSET_ROOT}rule-story.webp`],
  oneFlow: [`${CLOUD_ASSET_ROOT}rule-one-flow.webp`, `${CLOUD_ASSET_ROOT}rule-one-flow.webp`],
  identityLiberal: [`${CLOUD_ASSET_ROOT}identity-liberal.webp`],
  identityAuthoritarian: [`${CLOUD_ASSET_ROOT}identity-fascist.webp`],
  identityDictator: [`${CLOUD_ASSET_ROOT}identity-hitler.webp`],
};
const {
  GAME_PAGE_TIMEOUT_MS,
  clearPageTimeout,
  schedulePageTimeout,
  setupPageTimeout,
} = require("../../../utils/pageTimeout");

function normalizeTimeoutMs(value) {
  const timeoutMs = Number(value);
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : GAME_PAGE_TIMEOUT_MS;
}

function getActiveSection(sectionId) {
  return rulesContent.find((section) => section.id === sectionId) || rulesContent[0] || null;
}

function getActiveSectionIndex(sectionId) {
  const sectionIndex = rulesContent.findIndex((section) => section.id === sectionId);
  return sectionIndex >= 0 ? sectionIndex : 0;
}

function getSectionImageSrc(section, urlByAssetKey) {
  if (!section || !section.imageAssetKey) {
    return "";
  }
  return urlByAssetKey[section.imageAssetKey] || "";
}

function hydrateSectionAssets(section, urlByAssetKey) {
  if (!section) {
    return null;
  }
  return {
    ...section,
    groups: (section.groups || []).map((group) => ({
      ...group,
      imageSrc: group.imageAssetKey ? urlByAssetKey[group.imageAssetKey] || "" : "",
    })),
  };
}

Page({
  pageTimeoutMs: GAME_PAGE_TIMEOUT_MS,

  data: {
    roomId: "",
    controlledMemberId: "",
    sections: rulesContent,
    activeSectionId: rulesContent[0] ? rulesContent[0].id : "",
    activeSection: rulesContent[0] || null,
    activeSectionIndex: 0,
    ruleStorySrc: "",
    ruleAssetSrcByKey: {},
    activeSectionImageSrc: "",
  },

  onLoad(options = {}) {
    this.pageTimeoutMs = normalizeTimeoutMs(options.timeoutMs);
    this.setData({
      roomId: options.roomId || "",
      controlledMemberId: options.controlledMemberId || "",
    });
    setupPageTimeout(this, {
      timeoutMs: this.pageTimeoutMs,
      deadlineAt: options.timeoutDeadlineAt,
    });
    this.loadRuleAssets();
  },

  onShow() {
    schedulePageTimeout(this, {
      timeoutMs: this.pageTimeoutMs,
    });
  },

  onHide() {
    clearPageTimeout(this);
  },

  onUnload() {
    clearPageTimeout(this);
  },

  onTapBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({
        delta: 1,
      });
      return;
    }

    if (!this.data.roomId) {
      wx.reLaunch({
        url: "/pages/home/index",
      });
      return;
    }

    wx.redirectTo({
      url: `/packageRoom/pages/board/index?roomId=${encodeURIComponent(
        this.data.roomId,
      )}&controlledMemberId=${encodeURIComponent(this.data.controlledMemberId || "")}`,
    });
  },

  onTapSection(event) {
    const sectionId = event.currentTarget.dataset.sectionId || "";
    if (!sectionId) {
      return;
    }
    const activeSection = getActiveSection(sectionId);
    this.setData({
      activeSectionId: sectionId,
      activeSection: hydrateSectionAssets(activeSection, this.data.ruleAssetSrcByKey || {}),
      activeSectionIndex: getActiveSectionIndex(sectionId),
      activeSectionImageSrc: getSectionImageSrc(activeSection, this.data.ruleAssetSrcByKey || {}),
    });
  },

  loadRuleAssets() {
    if (!wx.cloud || !wx.cloud.getTempFileURL) {
      return;
    }

    wx.cloud
      .getTempFileURL({
        fileList: Object.keys(RULE_ASSET_FILE_IDS_BY_KEY).reduce(
          (fileList, key) => fileList.concat(RULE_ASSET_FILE_IDS_BY_KEY[key]),
          [],
        ),
      })
      .then((res) => {
        const srcByKey = {};
        (res.fileList || []).forEach((file) => {
          const assetKey = Object.keys(RULE_ASSET_FILE_IDS_BY_KEY).find((key) =>
            RULE_ASSET_FILE_IDS_BY_KEY[key].includes(file.fileID),
          );
          if (!assetKey) {
            return;
          }
          if (file.status !== 0 || !file.tempFileURL) {
            return;
          }
          if (!srcByKey[assetKey]) {
            srcByKey[assetKey] = file.tempFileURL;
          }
        });
        Object.keys(RULE_ASSET_FILE_IDS_BY_KEY).forEach((key) => {
          if (!srcByKey[key]) {
            console.error("规则页云存储临时链接获取失败", {
              assetKey: key,
              fileList: RULE_ASSET_FILE_IDS_BY_KEY[key],
            });
          }
        });

        this.setData({
          ruleStorySrc: srcByKey.story || "",
          ruleAssetSrcByKey: srcByKey,
          activeSection: hydrateSectionAssets(this.data.activeSection, srcByKey),
          activeSectionImageSrc: getSectionImageSrc(this.data.activeSection, srcByKey),
        });
      })
      .catch((err) => {
        console.error("规则页云存储临时链接获取失败", err);
      });
  },

  onRuleAssetError(event) {
    console.error("规则页素材加载失败", event && event.detail);
    const assetKey = event.currentTarget.dataset.assetKey || "";
    if (assetKey !== "story") {
      return;
    }
    this.setData({
      ruleStorySrc: "",
    });
  },
});
