const { ERROR_CODE } = require('../constants/phase');

const ERROR_COPY = {
  [ERROR_CODE.INVALID_PAYLOAD]: '提交内容不完整或格式不正确',
  [ERROR_CODE.ROOM_NOT_FOUND]: '房间不存在',
  [ERROR_CODE.ROOM_EXPIRED]: '房间已失效',
  [ERROR_CODE.ROOM_FULL]: '房间已满',
  [ERROR_CODE.ROOM_NOT_JOINABLE]: '房间当前不可加入',
  [ERROR_CODE.NOT_ROOM_MEMBER]: '你不是该房间成员',
  [ERROR_CODE.NOT_ROOM_HOST]: '只有房主可以执行该操作',
  [ERROR_CODE.INVALID_PLAYER_COUNT]: '玩家人数不符合开局条件',
  [ERROR_CODE.NOT_ALL_READY]: '还有玩家尚未准备',
  [ERROR_CODE.GAME_NOT_STARTED]: '对局还未开始',
  [ERROR_CODE.GAME_ALREADY_STARTED]: '对局已经开始',
  [ERROR_CODE.GAME_ALREADY_ENDED]: '对局已经结束',
  [ERROR_CODE.PHASE_MISMATCH]: '当前阶段已变化，请刷新后重试',
  [ERROR_CODE.VERSION_CONFLICT]: '状态已更新，请刷新后重试',
  [ERROR_CODE.DUPLICATE_COMMAND]: '重复提交已被系统识别',
  [ERROR_CODE.NOT_CURRENT_ACTOR]: '当前不是你的可操作阶段',
  [ERROR_CODE.INVALID_TARGET]: '目标已不可选',
  [ERROR_CODE.TARGET_ALREADY_DEAD]: '目标已经出局',
  [ERROR_CODE.TARGET_ALREADY_INVESTIGATED]: '该玩家已经被调查过',
  [ERROR_CODE.ACTION_NOT_ALLOWED]: '当前状态不允许这个操作',
  [ERROR_CODE.INTERNAL_ERROR]: '系统繁忙，请稍后重试',
};

function normalizeError(error, extra) {
  if (!error) {
    return {
      code: ERROR_CODE.INTERNAL_ERROR,
      message: '系统繁忙，请稍后重试',
      retryable: true,
      ...extra,
    };
  }

  if (typeof error === 'string') {
    return {
      code: ERROR_CODE.INTERNAL_ERROR,
      message: error,
      retryable: true,
      ...extra,
    };
  }

  return {
    code: error.code || ERROR_CODE.INTERNAL_ERROR,
    message: error.message || ERROR_COPY[error.code] || '系统繁忙，请稍后重试',
    retryable: typeof error.retryable === 'boolean' ? error.retryable : error.code === ERROR_CODE.INTERNAL_ERROR,
    requestId: error.requestId,
    raw: error.raw,
    ...extra,
  };
}

function getErrorCopy(code, fallback) {
  return ERROR_COPY[code] || fallback || '系统繁忙，请稍后重试';
}

function shouldRefreshOnError(code) {
  return [
    ERROR_CODE.VERSION_CONFLICT,
    ERROR_CODE.PHASE_MISMATCH,
    ERROR_CODE.DUPLICATE_COMMAND,
    ERROR_CODE.NOT_CURRENT_ACTOR,
  ].includes(code);
}

function shouldReturnHomeOnError(code) {
  return [ERROR_CODE.ROOM_EXPIRED, ERROR_CODE.ROOM_NOT_FOUND].includes(code);
}

module.exports = {
  normalizeError,
  getErrorCopy,
  shouldRefreshOnError,
  shouldReturnHomeOnError,
};

