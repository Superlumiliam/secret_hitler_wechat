const {
  FASCIST_POWER_MAP,
  POLICY_TRACK_ASSET_FILE_IDS,
  POWER_BADGE_ASSET_KEY_MAP,
} = require("../../utils/policyTrack");

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
