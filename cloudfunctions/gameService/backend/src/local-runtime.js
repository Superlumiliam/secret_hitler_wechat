"use strict";

const { createApp } = require("./services");
const { InMemoryStore } = require("./store");

let singletonApp = null;

function getLocalRuntimeApp() {
  if (!singletonApp) {
    singletonApp = createApp({
      store: new InMemoryStore()
    });
  }
  return singletonApp;
}

module.exports = {
  getLocalRuntimeApp
};
