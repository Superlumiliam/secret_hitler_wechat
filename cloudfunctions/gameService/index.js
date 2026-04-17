"use strict";

const cloud = require("wx-server-sdk");
const { createCloudRuntimeApp } = require("./backend/src/cloud-runtime");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

exports.main = async (event, context) => {
  const app = createCloudRuntimeApp(cloud.database());
  const wxContext = cloud.getWXContext();
  return app.run(event.action, event.payload || {}, {
    openid: wxContext.OPENID
  });
};
