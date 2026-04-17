"use strict";

const { CloudDbStore } = require("./cloud-store");
const { createApp } = require("./services");

function createCloudRuntimeApp(db) {
  return createApp({
    store: new CloudDbStore(db)
  });
}

module.exports = {
  createCloudRuntimeApp
};
