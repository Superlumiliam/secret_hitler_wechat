function createServiceError(result, fallbackMessage) {
  const error = (result && result.error) || {};
  const code = error.code || "";
  const messageByCode = {
    ROOM_NOT_FOUND: "房间不存在或已失效",
    ROOM_EXPIRED: "房间已过期",
    GAME_ALREADY_ENDED: "对局已结束",
    ACTION_NOT_ALLOWED: "当前状态不允许执行该操作",
    FORBIDDEN: "你当前不能执行该操作",
    INTERNAL_ERROR: "服务暂时异常，请稍后再试",
  };
  const err = new Error(messageByCode[code] || fallbackMessage || "操作失败");
  err.code = code;
  err.retryable = Boolean(error.retryable);
  err.isBusinessFailure = true;
  return err;
}

async function callGameService(action, payload, fallbackMessage) {
  if (!wx.cloud) {
    throw new Error("当前基础库不支持云能力");
  }

  const res = await wx.cloud.callFunction({
    name: "gameService",
    data: {
      action,
      payload,
    },
  });
  const result = res.result || {};
  if (!result.success) {
    throw createServiceError(result, fallbackMessage || "操作失败");
  }
  return result.data || {};
}

async function getResultSnapshot(roomId) {
  return await callGameService(
    "getResultSnapshot",
    {
      roomId,
    },
    "获取结果失败",
  );
}

module.exports = {
  getResultSnapshot,
};
