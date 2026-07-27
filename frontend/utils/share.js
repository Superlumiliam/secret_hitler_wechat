const SHARE_MENUS = ["shareAppMessage", "shareTimeline"];

function enableShareMenu(options = {}) {
  if (!wx.showShareMenu) {
    return;
  }

  wx.showShareMenu({
    withShareTicket: true,
    menus: options.includeTimeline === false ? ["shareAppMessage"] : SHARE_MENUS,
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

function buildRoomShare(roomCode, roomId) {
  const safeRoomCode = String(roomCode || "").trim();
  const safeRoomId = String(roomId || "").trim();
  const query = safeRoomCode
    ? [
        safeRoomId ? `roomId=${encodeURIComponent(safeRoomId)}` : "",
        `roomCode=${encodeURIComponent(safeRoomCode)}`,
      ]
        .filter(Boolean)
        .join("&")
    : "";
  const title = `加入《揭秘独裁者》房间 ${safeRoomCode}`.trim();

  return {
    title,
    path: query ? `/packageRoom/pages/lobby/index?${query}` : "/pages/home/index",
    query,
  };
}

module.exports = {
  buildHomeShare,
  buildRoomShare,
  enableShareMenu,
};
