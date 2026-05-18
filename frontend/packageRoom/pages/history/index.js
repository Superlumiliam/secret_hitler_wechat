const STATUS_LABELS = {
  nominating: "提名中",
  voting: "投票中",
  vote_failed: "未通过",
  legislating: "立法中",
  executing: "权力执行中",
  completed: "已完成",
  chaos: "混乱政策",
  game_ended: "对局结束",
};

const OUTCOME_CLASS_BY_TYPE = {
  pending_nomination: "is-pending",
  pending_vote: "is-pending",
  vote_failed: "is-failed",
  pending_legislation: "is-pending",
  liberal_policy: "is-liberal",
  fascist_policy: "is-fascist",
  vetoed: "is-veto",
  chaos_policy: "is-chaos",
  investigation: "is-power",
  special_election: "is-power",
  policy_peek: "is-power",
  execution: "is-execution",
  win: "is-win",
};

function getSeatLabel(member) {
  if (!member) {
    return "待定";
  }
  return `${member.seatIndex}号 ${member.displayName}`;
}

Page({
  data: {
    roomId: "",
    controlledMemberId: "",
    isLoading: true,
    errorText: "",
    header: null,
    summary: null,
    rounds: [],
  },

  onLoad(options = {}) {
    this.setData({
      roomId: options.roomId || "",
      controlledMemberId: options.controlledMemberId || "",
    });
    this.loadHistorySnapshot();
  },

  async loadHistorySnapshot() {
    if (!this.data.roomId || !wx.cloud) {
      this.setData({
        isLoading: false,
        errorText: "房间信息缺失",
      });
      return;
    }

    this.setData({
      isLoading: true,
      errorText: "",
    });

    try {
      const res = await wx.cloud.callFunction({
        name: "gameService",
        data: {
          action: "getGameSnapshot",
          payload: {
            roomId: this.data.roomId,
            controlledMemberId: this.data.controlledMemberId || "",
          },
        },
      });
      const result = res.result || {};
      if (!result.success) {
        throw this.createServiceError(result, "获取历史记录失败");
      }
      this.hydrateHistory(result.data);
    } catch (err) {
      console.error("获取历史记录失败", err);
      this.setData({
        errorText: err.message || "获取历史记录失败",
      });
      wx.showToast({
        title: err.message || "获取历史记录失败",
        icon: "none",
      });
    } finally {
      this.setData({
        isLoading: false,
      });
    }
  },

  hydrateHistory(snapshot) {
    const publicState = (snapshot && snapshot.publicState) || {};
    const history = publicState.history || {
      roundsStarted: snapshot.round || 1,
      roundsCompleted: 0,
      rounds: [],
    };
    const seatOrder = publicState.seatOrder || [];
    const memberById = {};
    seatOrder.forEach((member) => {
      memberById[member.memberId] = member;
    });

    this.setData({
      header: {
        roomCode: snapshot.roomCode || "",
        playerCount: seatOrder.length,
        round: snapshot.round || history.roundsStarted || 1,
      },
      summary: {
        roundsStarted: history.roundsStarted || 0,
        roundsCompleted: history.roundsCompleted || 0,
        liberalPolicyCount: publicState.liberalPolicyCount || 0,
        fascistPolicyCount: publicState.fascistPolicyCount || 0,
        electionTracker: publicState.electionTracker || 0,
        electionDots: this.createElectionDots(publicState.electionTracker || 0),
      },
      rounds: this.createRoundViews(history.rounds || [], seatOrder, memberById),
    });
  },

  createElectionDots(electionTracker) {
    return [1, 2, 3].map((slot) => ({
      slot,
      dotClass: `tracker-dot ${slot <= electionTracker ? "is-active" : ""}`,
    }));
  },

  createRoundViews(rounds, seatOrder, memberById) {
    return rounds.map((round) => {
      const president = memberById[round.presidentId] || null;
      const chancellor = memberById[round.chancellorId] || null;
      const outcome = round.outcome || {};
      const target = memberById[outcome.targetMemberId] || null;
      const voteSummary = round.voteSummary || {};

      return {
        round: round.round,
        statusText: STATUS_LABELS[round.status] || "进行中",
        presidentText: getSeatLabel(president),
        chancellorText: getSeatLabel(chancellor),
        voteText: voteSummary.revealed
          ? `${voteSummary.ja || 0} 赞成 / ${voteSummary.nein || 0} 反对`
          : this.getHiddenVoteText(round.status),
        outcomeText: this.createOutcomeText(outcome, target),
        outcomeClass: `outcome-badge ${OUTCOME_CLASS_BY_TYPE[outcome.type] || "is-pending"}`,
        votes: this.createVoteRows(round.votes || [], seatOrder),
      };
    });
  },

  getHiddenVoteText(status) {
    if (status === "nominating") {
      return "尚未开始";
    }
    if (status === "voting") {
      return "投票未公开";
    }
    return "未公开";
  },

  createOutcomeText(outcome, target) {
    const label = outcome.label || "等待进展";
    if (!target) {
      return label;
    }
    if (outcome.type === "execution") {
      return `处决 ${target.seatIndex}号玩家`;
    }
    if (outcome.type === "special_election") {
      return `特别选举 ${target.seatIndex}号玩家`;
    }
    if (outcome.type === "investigation") {
      return `调查 ${target.seatIndex}号玩家`;
    }
    return label;
  },

  createVoteRows(votes, seatOrder) {
    const voteByMemberId = {};
    votes.forEach((vote) => {
      voteByMemberId[vote.memberId] = vote.state;
    });

    return seatOrder.map((member) => {
      const state = voteByMemberId[member.memberId] || (member.isAlive === false ? "dead" : "not_started");
      return {
        memberId: member.memberId,
        seatIndex: member.seatIndex,
        state,
        mark: this.getVoteMark(state),
        cellClass: `vote-cell is-${state}`,
      };
    });
  },

  getVoteMark(state) {
    if (state === "ja") {
      return "✓";
    }
    if (state === "nein") {
      return "×";
    }
    if (state === "dead") {
      return "☠";
    }
    if (state === "pending") {
      return "…";
    }
    return "·";
  },

  createServiceError(result, fallbackMessage) {
    const error = (result && result.error) || {};
    const err = new Error(error.message || fallbackMessage);
    err.code = error.code || "";
    err.retryable = Boolean(error.retryable);
    return err;
  },

  onBackBoard() {
    wx.navigateBack({
      fail: () => {
        if (!this.data.roomId) {
          return;
        }
        wx.redirectTo({
          url: `/packageRoom/pages/board/index?roomId=${encodeURIComponent(
            this.data.roomId,
          )}&controlledMemberId=${encodeURIComponent(this.data.controlledMemberId || "")}`,
        });
      },
    });
  },
});
