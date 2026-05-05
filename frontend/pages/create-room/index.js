const ROLE_CONFIG = {
  5: { liberals: 3, fascists: 1 },
  6: { liberals: 4, fascists: 1 },
  7: { liberals: 4, fascists: 2 },
  8: { liberals: 5, fascists: 2 },
  9: { liberals: 5, fascists: 3 },
  10: { liberals: 6, fascists: 3 },
};

const playerCounts = [5, 6, 7, 8, 9, 10].map((value) => ({ value }));

function createCommandId() {
  return `cmd_create_room_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildRoleData(count) {
  const config = ROLE_CONFIG[count] || ROLE_CONFIG[6];
  return {
    liberalCount: config.liberals,
    fascistTotal: config.fascists + 1,
    liberalCards: Array.from({ length: config.liberals }),
    fascistCards: Array.from({ length: config.fascists }),
  };
}

Page({
  data: {
    playerCounts,
    selectedCount: 6,
    isSubmitting: false,
    ...buildRoleData(6),
  },

  onSelectCount(event) {
    const selectedCount = Number(event.currentTarget.dataset.count);
    this.setData({
      selectedCount,
      ...buildRoleData(selectedCount),
    });
  },

  onBackHome() {
    wx.navigateBack({
      delta: 1,
    });
  },

  async onCreateRoom() {
    if (this.data.isSubmitting) {
      return;
    }

    if (!wx.cloud) {
      wx.showToast({
        title: "当前基础库不支持云能力",
        icon: "none",
      });
      return;
    }

    this.setData({
      isSubmitting: true,
    });

    try {
      const res = await wx.cloud.callFunction({
        name: "roomService",
        data: {
          action: "createRoom",
          payload: {
            commandId: createCommandId(),
            targetPlayerCount: this.data.selectedCount,
          },
        },
      });
      const result = res.result || {};

      if (!result.success) {
        throw new Error((result.error && result.error.message) || "创建房间失败");
      }

      const room = result.data || {};
      wx.redirectTo({
        url: `/packageRoom/pages/lobby/index?roomId=${encodeURIComponent(room.roomId)}&memberId=${encodeURIComponent(room.memberId || "")}`,
      });
    } catch (err) {
      console.error("创建房间失败", err);
      wx.showToast({
        title: err.message || "创建房间失败",
        icon: "none",
      });
      this.setData({
        isSubmitting: false,
      });
    }
  },
});
