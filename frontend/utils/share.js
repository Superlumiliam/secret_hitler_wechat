const SHARE_MENUS = ["shareAppMessage", "shareTimeline"];

function enableShareMenu() {
  if (!wx.showShareMenu) {
    return;
  }

  wx.showShareMenu({
    withShareTicket: true,
    menus: SHARE_MENUS,
    fail(err) {
      console.error("启用分享菜单失败", err);
    },
  });
}

function buildHomeShare() {
  return {
    title: "一起玩《揭秘独裁者》",
    path: "/pages/home/index",
  };
}

function buildRoomShare(roomCode) {
  const safeRoomCode = String(roomCode || "").trim();
  const query = safeRoomCode ? `roomCode=${encodeURIComponent(safeRoomCode)}` : "";
  const title = `加入《揭秘独裁者》房间 ${safeRoomCode}`.trim();

  return {
    title,
    path: query ? `/pages/home/index?${query}` : "/pages/home/index",
    query,
  };
}

module.exports = {
  buildHomeShare,
  buildRoomShare,
  enableShareMenu,
};
