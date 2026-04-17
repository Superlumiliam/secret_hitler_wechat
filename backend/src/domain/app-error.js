"use strict";

const { ERROR_CODES, RETRYABLE_CODES } = require("../config/error-codes");

class AppError extends Error {
  constructor(code, message, options = {}) {
    super(message || code);
    this.name = "AppError";
    this.code = code || ERROR_CODES.INTERNAL_ERROR;
    this.retryable = typeof options.retryable === "boolean"
      ? options.retryable
      : RETRYABLE_CODES.has(this.code);
    this.details = options.details || null;
  }
}

function assert(condition, code, message, options) {
  if (!condition) {
    throw new AppError(code, message, options);
  }
}

module.exports = {
  AppError,
  assert
};
