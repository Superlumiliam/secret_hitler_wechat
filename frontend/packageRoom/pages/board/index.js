const FASCIST_POWER_MAP = {
  5: ["无", "无", "政策预览", "处决", "处决"],
  6: ["无", "无", "政策预览", "处决", "处决"],
  7: ["无", "调查忠诚", "特别选举", "处决", "处决"],
  8: ["无", "调查忠诚", "特别选举", "处决", "处决"],
  9: ["调查忠诚", "调查忠诚", "特别选举", "处决", "处决"],
  10: ["调查忠诚", "调查忠诚", "特别选举", "处决", "处决"],
};

const POWER_ICON_MAP = {
  无: "○",
  政策预览: "览",
  调查忠诚: "查",
  特别选举: "选",
  处决: "锤",
  极权派胜利: "冠",
};

const SAMPLE_PLAYERS = [
  { seatNo: 1, name: "xz1", voteStatus: "已投票", avatarInitial: "X", alignment: "liberal" },
  { seatNo: 2, name: "墨染", voteStatus: "已投票", avatarInitial: "墨", alignment: "fascist" },
  { seatNo: 3, name: "Echo", voteStatus: "已投票", avatarInitial: "E", roleLabel: "总统候选人", isCurrent: true, alignment: "liberal" },
  { seatNo: 4, name: "老K", voteStatus: "已投票", avatarInitial: "K", alignment: "fascist" },
  { seatNo: 5, name: "白夜行者", voteStatus: "未投票", avatarInitial: "白", roleLabel: "总理候选人", isNominee: true, alignment: "liberal" },
  { seatNo: 6, name: "冷静的观察者", voteStatus: "未投票", avatarInitial: "冷", alignment: "liberal" },
];

Page({
  data: {
    roomId: "",
    isLeaving: false,
    targetPlayerCount: 6,
    targetOptions: [5, 6, 7, 8, 9, 10],
    board: null,
    leftSeats: [],
    rightSeats: [],
    liberalTrack: [],
    fascistTrack: [],
    electionTrack: [],
    statusText: "",
  },

  onLoad(options) {
    const targetPlayerCount = this.normalizeTargetCount(options.targetPlayerCount || options.playerCount || 6);

    this.setData(
      {
        roomId: options.roomId || "C040E007",
        targetPlayerCount,
      },
      () => this.refreshBoard()
    );
  },

  normalizeTargetCount(value) {
    const count = Number(value);
    if (count < 5) {
      return 5;
    }
    if (count > 10) {
      return 10;
    }
    return Number.isFinite(count) ? Math.round(count) : 6;
  },

  refreshBoard() {
    const board = this.createMockBoard(this.data.targetPlayerCount);
    const seats = this.createSeats(board.targetPlayerCount);
    const splitIndex = Math.min(5, seats.length);

    this.setData({
      board,
      leftSeats: seats.slice(0, splitIndex),
      rightSeats: seats.slice(splitIndex),
      liberalTrack: this.createLiberalTrack(board.liberalPolicyCount),
      fascistTrack: this.createFascistTrack(board.targetPlayerCount, board.fascistPolicyCount),
      electionTrack: this.createElectionTrack(board.electionTracker),
      statusText: this.createStatusText(board),
    });
  },

  createMockBoard(targetPlayerCount) {
    return {
      roomCode: this.data.roomId || "C040E007",
      targetPlayerCount,
      roundNo: 4,
      phaseName: "议会进程",
      presidentSeatNo: 3,
      presidentName: "Echo",
      chancellorSeatNo: 5,
      chancellorName: "白夜行者",
      liberalPolicyCount: 2,
      fascistPolicyCount: 3,
      electionTracker: 1,
      pendingTaskText: "等待全员完成投票",
      vetoUnlocked: false,
    };
  },

  createSeats(targetPlayerCount) {
    return Array.from({ length: targetPlayerCount }, (_, index) => {
      const seatNo = index + 1;
      const player = SAMPLE_PLAYERS.find((item) => item.seatNo === seatNo);

      if (!player) {
        return {
          seatNo,
          isEmpty: true,
          name: "空位",
          voteStatus: "",
          avatarInitial: "",
          roleLabel: "",
          seatClass: "seat-card is-empty",
        };
      }

      return {
        ...player,
        isEmpty: false,
        seatClass: `seat-card ${player.isCurrent ? "is-current" : ""} ${player.isNominee ? "is-nominee" : ""}`,
      };
    });
  },

  createLiberalTrack(liberalPolicyCount) {
    return Array.from({ length: 5 }, (_, index) => {
      const slot = index + 1;
      const isVictory = slot === 5;
      const isEnacted = slot <= liberalPolicyCount;

      return {
        slot,
        label: isVictory ? "自由派胜利" : String(slot),
        isVictory,
        cellClass: `policy-cell liberal-cell ${isEnacted ? "is-enacted" : ""} ${isVictory ? "is-victory" : ""}`,
      };
    });
  },

  createFascistTrack(targetPlayerCount, fascistPolicyCount) {
    const powers = FASCIST_POWER_MAP[targetPlayerCount] || FASCIST_POWER_MAP[6];

    return Array.from({ length: 6 }, (_, index) => {
      const slot = index + 1;
      const isVictory = slot === 6;
      const isEnacted = slot <= fascistPolicyCount;

      return {
        slot,
        label: isVictory ? "极权派胜利" : String(slot),
        power: isVictory ? "极权派胜利" : powers[index],
        powerIcon: POWER_ICON_MAP[isVictory ? "极权派胜利" : powers[index]],
        isVictory,
        cellClass: `policy-cell fascist-cell ${isEnacted ? "is-enacted" : ""} ${isVictory ? "is-victory" : ""}`,
      };
    });
  },

  createElectionTrack(electionTracker) {
    return Array.from({ length: 3 }, (_, index) => {
      const slot = index + 1;
      return {
        slot,
        cellClass: `election-dot ${slot <= electionTracker ? "is-active" : ""}`,
      };
    });
  },

  createStatusText(board) {
    return `当前：${board.presidentSeatNo}号总统提名 ${board.chancellorSeatNo}号总理，${board.pendingTaskText}`;
  },

  onSelectTargetCount(event) {
    const targetPlayerCount = this.normalizeTargetCount(event.currentTarget.dataset.count);

    this.setData(
      {
        targetPlayerCount,
      },
      () => this.refreshBoard()
    );
  },

  onTapRules() {
    wx.showToast({
      title: "规则页待接入",
      icon: "none",
    });
  },

  onTapSettings() {
    wx.showToast({
      title: "设置待接入",
      icon: "none",
    });
  },

  onTapIdentity() {
    wx.showToast({
      title: "身份页待接入",
      icon: "none",
    });
  },

  onTapHistory() {
    wx.showToast({
      title: "历史记录待接入",
      icon: "none",
    });
  },

  onVoteJa() {
    wx.showToast({
      title: "已选择赞成",
      icon: "none",
    });
  },

  onVoteNein() {
    wx.showToast({
      title: "已选择反对",
      icon: "none",
    });
  },

  createCommandId(prefix) {
    return `cmd_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  },

  async onBackHome() {
    if (this.data.isLeaving) {
      return;
    }

    if (!this.data.roomId || !wx.cloud) {
      wx.reLaunch({
        url: "/pages/home/index",
      });
      return;
    }

    this.setData({
      isLeaving: true,
    });

    try {
      const res = await wx.cloud.callFunction({
        name: "roomService",
        data: {
          action: "leaveRoom",
          payload: {
            commandId: this.createCommandId("leave_board"),
            roomId: this.data.roomId,
          },
        },
      });
      const result = res.result || {};
      if (!result.success) {
        console.error("离开对局失败", result.error || result);
      }
    } catch (err) {
      console.error("离开对局失败", err);
    }

    wx.reLaunch({
      url: "/pages/home/index",
    });
  },
});
