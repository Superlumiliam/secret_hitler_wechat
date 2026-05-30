const CLOUD_ASSET_ROOT =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/";

const FASCIST_POWER_MAP = {
  5: ["无", "无", "政策预览", "处决", "处决"],
  6: ["无", "无", "政策预览", "处决", "处决"],
  7: ["无", "调查忠诚", "特别选举", "处决", "处决"],
  8: ["无", "调查忠诚", "特别选举", "处决", "处决"],
  9: ["调查忠诚", "调查忠诚", "特别选举", "处决", "处决"],
  10: ["调查忠诚", "调查忠诚", "特别选举", "处决", "处决"],
};

const POLICY_TRACK_ASSET_FILE_IDS = {
  liberalBg: `${CLOUD_ASSET_ROOT}policy-track-liberal-bg.webp`,
  authoritarianBg: `${CLOUD_ASSET_ROOT}policy-track-authoritarian-bg.webp`,
  liberalCard: `${CLOUD_ASSET_ROOT}policy-card-liberal.webp`,
  authoritarianCard: `${CLOUD_ASSET_ROOT}policy-card-authoritarian.webp`,
  liberalSlot: `${CLOUD_ASSET_ROOT}slot-empty-liberal.webp`,
  authoritarianSlot: `${CLOUD_ASSET_ROOT}slot-empty-authoritarian.webp`,
  execution: `${CLOUD_ASSET_ROOT}power-badge-execution.webp`,
  investigate: `${CLOUD_ASSET_ROOT}power-badge-investigate.webp`,
  policyPeek: `${CLOUD_ASSET_ROOT}power-badge-policy-peek.webp`,
  specialElection: `${CLOUD_ASSET_ROOT}power-badge-special-election.webp`,
  playerSeat: `${CLOUD_ASSET_ROOT}player-seat.webp`,
  playerTabletPresident: `${CLOUD_ASSET_ROOT}player-tablet-president.webp`,
  playerTabletMinister: `${CLOUD_ASSET_ROOT}player-tablet-minister.webp`,
  stampFascist: `${CLOUD_ASSET_ROOT}stamp-fascist.webp`,
  stampLiberal: `${CLOUD_ASSET_ROOT}stamp-liberal.webp`,
  identityFascist: `${CLOUD_ASSET_ROOT}identity-fascist.webp`,
  identityLiberal: `${CLOUD_ASSET_ROOT}identity-liberal.webp`,
  liberalBadge: `${CLOUD_ASSET_ROOT}icon-liberal-badge.webp`,
  authoritarianBadge: `${CLOUD_ASSET_ROOT}icon-authoritarian-badge.webp`,
  frameNarrow: `${CLOUD_ASSET_ROOT}frame-narrow.webp`,
  buttonNormal: `${CLOUD_ASSET_ROOT}button-normal.webp`,
  buttonBlue: `${CLOUD_ASSET_ROOT}button-blue.webp`,
  buttonRed: `${CLOUD_ASSET_ROOT}button-red.webp`,
  nominationButtonFrame: `${CLOUD_ASSET_ROOT}nomination-button-frame.webp`,
  nominationButtonFrameBlue: `${CLOUD_ASSET_ROOT}nomination-button-frame-blue.webp`,
  modalFrameMobile: `${CLOUD_ASSET_ROOT}modal-frame-mobile.webp`,
  modalFrameButtonMobile: `${CLOUD_ASSET_ROOT}modal-frame-button-mobile.webp`,
  modalCancelButtonMobile: `${CLOUD_ASSET_ROOT}modal-cancel-button-mobile.webp`,
  defaultAvatar: `${CLOUD_ASSET_ROOT}man-in-black.webp`,
  electionTrackBg: `${CLOUD_ASSET_ROOT}election-track-bg.webp`,
  electionSlotEmpty: `${CLOUD_ASSET_ROOT}election-slot-empty.webp`,
  electionSlotActive: `${CLOUD_ASSET_ROOT}election-slot-active.webp`,
  drawPileBg: `${CLOUD_ASSET_ROOT}card-bg.webp`,
  discardPileBg: `${CLOUD_ASSET_ROOT}discard-bg.webp`,
  drawPileCard: `${CLOUD_ASSET_ROOT}card.webp`,
  discardPileCard: `${CLOUD_ASSET_ROOT}discard.webp`,
  logoSeal: `${CLOUD_ASSET_ROOT}logo-seal.webp`,
};

const POWER_BADGE_ASSET_KEY_MAP = {
  政策预览: "policyPeek",
  调查忠诚: "investigate",
  特别选举: "specialElection",
  处决: "execution",
};

const PHASE_NAME_MAP = {
  nomination: "总统候选人提名总理",
  voting: "政府投票",
  hitler_check: "独裁者当选检查",
  legislative_president: "总统立法",
  legislative_chancellor: "总理立法",
  veto_response: "总统回应否决",
  executive_action: "总统执行权力",
  round_result: "回合结算",
  game_ended: "对局结束",
};

const ERROR_MESSAGE_MAP = {
  VERSION_CONFLICT: "局势已更新，请按最新页面操作",
  PHASE_MISMATCH: "当前阶段已变化，请按最新页面操作",
  FORBIDDEN: "你当前不能执行该操作",
  ALREADY_ACTED: "你已经完成过该操作",
  ACTION_NOT_ALLOWED: "当前局势不允许执行该操作",
  ROOM_NOT_FOUND: "房间不存在或已失效",
  ROOM_EXPIRED: "房间已过期",
  NOT_ROOM_MEMBER: "当前用户不在房间中",
  GAME_NOT_STARTED: "房间尚未开局",
  GAME_ALREADY_ENDED: "对局已结束",
  INVALID_PAYLOAD: "请求参数有误",
  DUPLICATE_COMMAND: "该操作已提交，请勿重复操作",
  NOT_CURRENT_ACTOR: "当前不是你的操作阶段",
  INVALID_TARGET: "目标不符合当前规则",
  TARGET_ALREADY_DEAD: "目标已出局",
  TARGET_ALREADY_INVESTIGATED: "该玩家已被调查过",
  INTERNAL_ERROR: "服务暂时异常，请稍后再试",
};

module.exports = {
  FASCIST_POWER_MAP,
  POLICY_TRACK_ASSET_FILE_IDS,
  PHASE_NAME_MAP,
  POWER_BADGE_ASSET_KEY_MAP,
  ERROR_MESSAGE_MAP,
};
