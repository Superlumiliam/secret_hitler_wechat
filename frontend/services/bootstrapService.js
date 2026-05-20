const ERROR_MESSAGE_MAP = {
  INVALID_PAYLOAD: "请求参数有误",
  ROOM_NOT_FOUND: "房间不存在",
  ROOM_EXPIRED: "房间已失效",
  NOT_ROOM_MEMBER: "当前用户不在房间中",
  ACTION_NOT_ALLOWED: "当前状态不允许执行该操作",
  INTERNAL_ERROR: "系统繁忙，请稍后重试",
};

function createServiceError(result, fallbackMessage) {
  const error = (result && result.error) || {};
  const code = error.code || "";
  const err = new Error(ERROR_MESSAGE_MAP[code] || fallbackMessage || "操作失败");
  err.code = code;
  err.retryable = Boolean(error.retryable);
  err.isBusinessFailure = true;
  return err;
}

async function callBootstrapService(action, payload = {}, fallbackMessage) {
  if (!wx.cloud) {
    throw new Error("当前基础库不支持云能力");
  }

  const res = await wx.cloud.callFunction({
    name: "bootstrapService",
    data: {
      action,
      payload,
    },
  });
  const result = res.result || {};
  if (!result.success) {
    throw createServiceError(result, fallbackMessage);
  }
  return result.data || {};
}

async function ensureSession() {
  return await callBootstrapService("ensureSession", {}, "会话初始化失败");
}

async function recoverActiveRoom() {
  return await callBootstrapService("recoverActiveRoom", {}, "恢复房间失败");
}

module.exports = {
  ensureSession,
  recoverActiveRoom,
};
