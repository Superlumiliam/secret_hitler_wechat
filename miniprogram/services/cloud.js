const { createCommandId, reuseOrCreateCommandId, clearCommandId } = require('../utils/command');
const { normalizeError } = require('../mappers/errorMapper');
const { logger } = require('../utils/logger');

function unwrapResult(result) {
  if (!result) {
    throw normalizeError({
      code: 'INTERNAL_ERROR',
      message: '云函数没有返回结果',
      retryable: true,
    });
  }

  if (result.success === false) {
    throw normalizeError({
      code: result.error && result.error.code,
      message: result.error && result.error.message,
      retryable: !!(result.error && result.error.retryable),
      requestId: result.requestId,
      raw: result.error,
    }, {
      requestId: result.requestId,
    });
  }

  if (result.success === true) {
    return result.data;
  }

  if (result.data !== undefined) {
    return result.data;
  }

  return result;
}

async function callCloudAction(functionName, action, payload) {
  try {
    const response = await wx.cloud.callFunction({
      name: functionName,
      data: {
        action,
        payload: payload || {},
      },
    });

    return unwrapResult(response.result);
  } catch (error) {
    logger.error('callCloudAction failed', functionName, action, error);
    throw normalizeError(error, {
      functionName,
      action,
      raw: error,
    });
  }
}

async function callWriteAction(functionName, action, payload, options) {
  const scope = options && options.scope ? options.scope : `${functionName}:${action}`;
  const commandId = payload.commandId || reuseOrCreateCommandId(scope);
  const nextPayload = Object.assign({}, payload, { commandId });
  try {
    const data = await callCloudAction(functionName, action, nextPayload);
    clearCommandId(scope);
    return data;
  } catch (error) {
    throw error;
  }
}

module.exports = {
  callCloudAction,
  callWriteAction,
  createCommandId,
};

