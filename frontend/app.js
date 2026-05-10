App({
  globalData: {
    env: "cloud1-9gcbbsjv4ce11da4",
    developerMode: {
      enabledEnvIds: ["cloud1-9gcbbsjv4ce11da4"],
      storageKey: "secret_hitler_developer_mode_enabled",
      targetPlayerCount: 6,
    },
    userProfileStorageKey: "secret_hitler_user_profile",
  },
  onLaunch() {
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
      return;
    }

    wx.cloud.init({
      env: this.globalData.env,
      traceUser: true,
    });
  },
});
