function createServiceError(result, fallbackMessage) {
  const error = (result && result.error) || {};
  const err = new Error(error.message || fallbackMessage);
  err.code = error.code || "";
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
