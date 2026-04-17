"use strict";

const { createApp } = require("../services");
const { FixedRandomProvider } = require("../random");
const { InMemoryStore } = require("../store");

function createTestApp(seed = 1) {
  const store = new InMemoryStore();
  const nowValues = [];
  const app = createApp({
    store,
    randomProvider: new FixedRandomProvider(seed),
    nowProvider: () => {
      const value = new Date(Date.UTC(2026, 3, 12, 12, 0, nowValues.length));
      nowValues.push(value.toISOString());
      return value;
    }
  });

  async function call(openid, action, payload = {}) {
    const result = await app.run(action, payload, { openid });
    if (!result.success) {
      const error = new Error(result.error.code);
      error.result = result;
      throw error;
    }
    return result.data;
  }

  return {
    app,
    call,
    store
  };
}

module.exports = {
  createTestApp
};
