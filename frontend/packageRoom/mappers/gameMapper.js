const {
  PHASE_NAME_MAP,
  POLICY_TRACK_ASSET_FILE_IDS,
} = require("../types/game");
const { createFascistTrack, createLiberalTrack } = require("../utils/policyTrack");
const taskMapper = require("./taskMapper");

function isCloudFileId(fileId) {
  return typeof fileId === "string" && fileId.indexOf("cloud://") === 0;
}

function createDeckPiles(policyDeck, assets = {}) {
  const drawCount = Math.max(0, Number(policyDeck && policyDeck.drawCount) || 0);
  const discardCount = Math.max(0, Number(policyDeck && policyDeck.discardCount) || 0);

  return [
    {
      key: "draw",
      label: "抽牌堆",
      count: drawCount,
      pileClass: `deck-pile is-draw ${drawCount > 0 ? "has-cards" : "is-empty"}`,
      countText: `${drawCount} 张`,
      bgSrc: assets.drawPileBg || POLICY_TRACK_ASSET_FILE_IDS.drawPileBg,
      cardSrc: assets.drawPileCard || POLICY_TRACK_ASSET_FILE_IDS.drawPileCard,
    },
    {
      key: "discard",
      label: "弃牌堆",
      count: discardCount,
      pileClass: `deck-pile is-discard ${discardCount > 0 ? "has-cards" : "is-empty"}`,
      countText: `${discardCount} 张`,
      bgSrc: assets.discardPileBg || POLICY_TRACK_ASSET_FILE_IDS.discardPileBg,
      cardSrc: assets.discardPileCard || POLICY_TRACK_ASSET_FILE_IDS.discardPileCard,
    },
  ];
}

function createBoard(snapshot, assets = {}) {
  const publicState = (snapshot && snapshot.publicState) || {};
  const seatOrder = publicState.seatOrder || [];
  const president = seatOrder.find((member) => member.memberId === publicState.currentPresidentCandidateId);
  const chancellor = seatOrder.find((member) => member.memberId === publicState.currentChancellorCandidateId);

  return {
    roomCode: snapshot.roomCode || "",
    targetPlayerCount: seatOrder.length,
    roundNo: snapshot.round || 1,
    phaseName: PHASE_NAME_MAP[snapshot.currentPhase] || "议会进程",
    presidentSeatNo: president ? president.seatIndex : "",
    presidentName: president ? president.displayName : "待定",
    chancellorSeatNo: chancellor ? chancellor.seatIndex : "",
    chancellorName: chancellor ? chancellor.displayName : "待提名",
    liberalPolicyCount: publicState.liberalPolicyCount || 0,
    fascistPolicyCount: publicState.fascistPolicyCount || 0,
    deckPiles: createDeckPiles(publicState.policyDeck, assets),
    electionTracker: publicState.electionTracker || 0,
    vetoUnlocked: Boolean(publicState.vetoUnlocked),
    executiveActionType: publicState.executiveActionType || "",
    nextSpecialPresidentCandidateId: publicState.nextSpecialPresidentCandidateId || "",
  };
}

function createInvestigationMarkMap(snapshot) {
  const privateState = (snapshot && snapshot.privateState) || {};
  const marks = Array.isArray(privateState.investigationMarks) ? privateState.investigationMarks : [];
  return marks.reduce((map, mark) => {
    if (mark && mark.targetMemberId && mark.party) {
      map[mark.targetMemberId] = mark;
    }
    return map;
  }, {});
}

function getInvestigationStampSrc(party, assets = {}) {
  return party === "LIBERAL" ? assets.stampLiberal || "" : assets.stampFascist || "";
}

function createIdentityMarkView(judgment, isSelf, assets = {}) {
  const normalized = judgment === "LIBERAL" || judgment === "FASCIST" ? judgment : "UNKNOWN";
  if (normalized === "LIBERAL") {
    return {
      state: normalized,
      label: isSelf ? "你的真实阵营：自由派" : "你标记为自由派",
      iconSrc: assets.liberalBadge || "",
      className: "identity-mark is-liberal",
    };
  }
  if (normalized === "FASCIST") {
    return {
      state: normalized,
      label: isSelf ? "你的真实阵营：极权派" : "你标记为极权派",
      iconSrc: assets.authoritarianBadge || "",
      className: "identity-mark is-fascist",
    };
  }
  return {
    state: "UNKNOWN",
    label: "身份判断未知",
    iconSrc: "",
    className: "identity-mark is-unknown",
  };
}

function createVisibleFascistNameMemberIdSet(snapshot) {
  const privateIdentity = ((snapshot && snapshot.privateState) || {}).identity || {};
  const visibleMemberIds = new Set();
  if (privateIdentity.party !== "FASCIST") {
    return visibleMemberIds;
  }

  if (snapshot && snapshot.myMemberId) {
    visibleMemberIds.add(snapshot.myMemberId);
  }
  (privateIdentity.knownMembers || []).forEach((member) => {
    if (member && member.memberId) {
      visibleMemberIds.add(member.memberId);
    }
  });
  return visibleMemberIds;
}

function createVisibleHitlerSeatMemberIdSet(snapshot) {
  const privateIdentity = ((snapshot && snapshot.privateState) || {}).identity || {};
  const visibleMemberIds = new Set();
  if (privateIdentity.party !== "FASCIST") {
    return visibleMemberIds;
  }

  if (privateIdentity.role === "HITLER" && snapshot && snapshot.myMemberId) {
    visibleMemberIds.add(snapshot.myMemberId);
  }
  (privateIdentity.knownMembers || []).forEach((member) => {
    if (member && member.memberId && member.role === "HITLER") {
      visibleMemberIds.add(member.memberId);
    }
  });
  return visibleMemberIds;
}

function createSeats(snapshot, options = {}) {
  const avatarUrlByFileId = options.avatarUrlByFileId || {};
  const identityJudgmentByMemberId = options.identityJudgmentByMemberId || {};
  const assets = options.assets || {};
  const selectedNominationTargetId = options.selectedNominationTargetId || "";
  const selectedExecutiveTargetId = options.selectedExecutiveTargetId || "";
  const publicState = (snapshot && snapshot.publicState) || {};
  const presidentCandidateId = publicState.currentPresidentCandidateId;
  const chancellorCandidateId = publicState.currentChancellorCandidateId;
  const submittedVoteMemberIds = Array.isArray(publicState.submittedVoteMemberIds)
    ? publicState.submittedVoteMemberIds
    : [];
  const currentViewerMemberId = snapshot && snapshot.myMemberId;
  const nominationAllowedIds = taskMapper.getNominationAllowedIds(snapshot);
  const nominateTargetByMemberId = taskMapper.createNominateTargetMap(snapshot);
  const executiveTargetByMemberId = taskMapper.createExecutiveTargetMap(snapshot);
  const investigationMarkByMemberId = createInvestigationMarkMap(snapshot);
  const privateIdentity = ((snapshot && snapshot.privateState) || {}).identity || {};
  const visibleFascistNameMemberIds = createVisibleFascistNameMemberIdSet(snapshot);
  const visibleHitlerSeatMemberIds = createVisibleHitlerSeatMemberIdSet(snapshot);
  const resolvedSelectedNominationTargetId = taskMapper.resolveSelectedNominationTargetId(
    snapshot,
    selectedNominationTargetId,
  );
  const resolvedSelectedExecutiveTargetId = taskMapper.resolveSelectedExecutiveTargetId(
    snapshot,
    selectedExecutiveTargetId,
  );

  return (publicState.seatOrder || []).map((member) => {
    const roleLabel =
      member.memberId === presidentCandidateId
        ? "总统候选人"
        : member.memberId === chancellorCandidateId
          ? "总理候选人"
          : "";
    const roleBadgeSrc =
      member.memberId === presidentCandidateId
        ? assets.playerTabletPresident || POLICY_TRACK_ASSET_FILE_IDS.playerTabletPresident
        : member.memberId === chancellorCandidateId
          ? assets.playerTabletMinister || POLICY_TRACK_ASSET_FILE_IDS.playerTabletMinister
          : "";
    const avatarSrc = avatarUrlByFileId[member.avatarUrl] || "";
    const defaultAvatarSrc = assets.defaultAvatar || POLICY_TRACK_ASSET_FILE_IDS.defaultAvatar;
    const isSelf = member.memberId === currentViewerMemberId;
    const targetOption = nominateTargetByMemberId[member.memberId] || null;
    const canNominateTarget = targetOption ? targetOption.canNominate : nominationAllowedIds.includes(member.memberId);
    const executiveTargetOption = executiveTargetByMemberId[member.memberId] || null;
    const judgment = isSelf ? privateIdentity.party || "UNKNOWN" : identityJudgmentByMemberId[member.memberId] || "UNKNOWN";
    const identityMark = createIdentityMarkView(judgment, isSelf, assets);
    const investigationMark = investigationMarkByMemberId[member.memberId] || null;
    const isVisibleFascistName = visibleFascistNameMemberIds.has(member.memberId);
    const isVisibleHitlerSeat = visibleHitlerSeatMemberIds.has(member.memberId);
    const isVoteSubmitted = snapshot.currentPhase === "voting" && submittedVoteMemberIds.includes(member.memberId);

    return {
      memberId: member.memberId,
      seatNo: member.seatIndex,
      name: member.displayName,
      nameClass: isVisibleFascistName ? "seat-name is-visible-fascist" : "seat-name",
      avatarSrc: (isCloudFileId(member.avatarUrl) ? avatarSrc : member.avatarUrl || "") || defaultAvatarSrc,
      seatFrameSrc: isVisibleHitlerSeat
        ? assets.playerSeatHitler || assets.playerSeat || ""
        : assets.playerSeat || "",
      roleLabel,
      roleBadgeSrc,
      isSelf,
      isAlive: member.isAlive,
      isOffline: member.isOffline,
      isVoteSubmitted,
      voteStatusLabel: isVoteSubmitted ? "已投票，等待其他玩家" : "等待投票",
      canChangeIdentityMark: !isSelf,
      identityMark,
      investigationStampSrc: investigationMark ? getInvestigationStampSrc(investigationMark.party, assets) : "",
      investigationStampLabel: investigationMark ? (investigationMark.party === "LIBERAL" ? "自由派" : "极权派") : "",
      seatClass: `seat-card ${member.memberId === presidentCandidateId ? "is-current" : ""} ${
        isSelf ? "is-controlled" : ""
      } ${
        member.memberId === chancellorCandidateId ? "is-nominee" : ""
      } ${
        nominationAllowedIds.includes(member.memberId) ? "is-eligible-nominee" : ""
      } ${
        targetOption && !canNominateTarget ? "is-ineligible-nominee" : ""
      } ${
        resolvedSelectedNominationTargetId === member.memberId ? "is-selected-nomination" : ""
      } ${
        executiveTargetOption && executiveTargetOption.canTarget ? "is-eligible-executive-target" : ""
      } ${
        executiveTargetOption && !executiveTargetOption.canTarget ? "is-ineligible-executive-target" : ""
      } ${
        resolvedSelectedExecutiveTargetId === member.memberId ? "is-selected-executive-target" : ""
      } ${
        isVoteSubmitted ? "is-vote-submitted" : ""
      } ${
        member.isAlive === false ? "is-dead" : ""
      }`,
    };
  });
}

function createControlledSeatText(snapshot) {
  const publicState = (snapshot && snapshot.publicState) || {};
  const seat = (publicState.seatOrder || []).find((member) => member.memberId === snapshot.myMemberId);
  if (!seat) {
    return "当前操控席位：未知";
  }
  return `当前操控席位：${seat.seatIndex}号 ${seat.displayName}`;
}

function createIdentityPickerOptions(memberId, currentJudgment, assets = {}) {
  return [
    {
      memberId,
      value: "UNKNOWN",
      label: "无",
      iconSrc: "",
      optionClass: `identity-option is-unknown ${currentJudgment === "UNKNOWN" || !currentJudgment ? "is-active" : ""}`,
    },
    {
      memberId,
      value: "LIBERAL",
      label: "自由派",
      iconSrc: assets.liberalBadge || "",
      optionClass: `identity-option is-liberal ${currentJudgment === "LIBERAL" ? "is-active" : ""}`,
    },
    {
      memberId,
      value: "FASCIST",
      label: "极权派",
      iconSrc: assets.authoritarianBadge || "",
      optionClass: `identity-option is-fascist ${currentJudgment === "FASCIST" ? "is-active" : ""}`,
    },
  ];
}

function createActiveIdentityPickerOptions(memberId, snapshot, judgments = {}, assets = {}) {
  if (!memberId || !snapshot || memberId === snapshot.myMemberId) {
    return [];
  }
  const currentJudgment = judgments[memberId] || "UNKNOWN";
  return createIdentityPickerOptions(memberId, currentJudgment, assets);
}

function createElectionTrack(electionTracker, assets = {}, newElectionTracker = 0) {
  return Array.from({ length: 3 }, (_, index) => {
    const slot = index + 1;
    const isActive = slot <= electionTracker;
    return {
      slot,
      slotSrc: isActive ? assets.electionSlotActive : assets.electionSlotEmpty,
      cellClass: `election-slot ${isActive ? "is-active" : "is-empty"} ${slot === newElectionTracker ? "is-new-election" : ""}`,
    };
  });
}

function createVoteProgressText(snapshot) {
  const publicState = (snapshot && snapshot.publicState) || {};
  const progress = publicState.voteProgress || null;
  if (!progress) {
    return "";
  }
  return `已投票 ${progress.submittedCount || 0}/${progress.requiredCount || progress.totalCount || 0}`;
}

function createStatusText(snapshot, board) {
  if (snapshot.pendingTask && snapshot.pendingTask.taskType === "NOMINATE_CHANCELLOR") {
    return `当前：${board.presidentSeatNo}号 ${board.presidentName} 正在提名总理候选人`;
  }
  if (snapshot.currentPhase === "nomination") {
    return `当前：${board.presidentSeatNo}号 ${board.presidentName} 是总统候选人，等待提名总理候选人`;
  }
  if (snapshot.currentPhase === "voting") {
    const voteProgressText = createVoteProgressText(snapshot);
    return voteProgressText ? `当前：政府投票中，${voteProgressText}` : "当前：等待所有存活玩家完成政府投票";
  }
  if (snapshot.pendingTask && snapshot.pendingTask.taskType === "PRESIDENT_DISCARD_POLICY") {
    return "当前：你是总统，请从 3 张政策牌中秘密弃掉 1 张";
  }
  if (snapshot.currentPhase === "legislative_president") {
    return `当前：${board.presidentSeatNo}号 ${board.presidentName} 正在秘密处理政策牌`;
  }
  if (snapshot.pendingTask && snapshot.pendingTask.taskType === "CHANCELLOR_ENACT_POLICY") {
    return taskMapper.canRequestVeto(snapshot)
      ? "当前：你是总理，请颁布 1 张政策，或提出否决"
      : "当前：你是总理，请从 2 张政策牌中秘密颁布 1 张";
  }
  if (snapshot.currentPhase === "legislative_chancellor") {
    return `当前：${board.chancellorSeatNo}号 ${board.chancellorName} 正在秘密处理政策牌`;
  }
  if (snapshot.pendingTask && snapshot.pendingTask.taskType === "PRESIDENT_RESPOND_VETO") {
    return "当前：总理提出否决，请你决定是否同意";
  }
  if (snapshot.currentPhase === "veto_response") {
    return `当前：${board.chancellorSeatNo}号 ${board.chancellorName} 提出否决，等待总统回应`;
  }
  if (snapshot.currentPhase === "executive_action") {
    const action = taskMapper.createExecutiveAction(snapshot);
    if (snapshot.pendingTask && action) {
      return `当前：你是总统，请执行${action.title}`;
    }
    if (action && action.waitingText) {
      return action.waitingText;
    }
    return `当前：${board.presidentSeatNo}号 ${board.presidentName} 正在执行总统权力`;
  }
  return `当前阶段：${board.phaseName}`;
}

function createPhaseHintText(snapshot, board) {
  const pendingTask = snapshot.pendingTask || null;
  const taskType = pendingTask && pendingTask.taskType;
  const action = taskMapper.createExecutiveAction(snapshot);

  if (taskType === "NOMINATE_CHANCELLOR") {
    return "你负责提名总理候选人；其他玩家可继续讨论，只有最终提名会公开。";
  }
  if (snapshot.currentPhase === "nomination") {
    return `${board.presidentSeatNo}号等待提名总理；其他玩家可讨论局势，暂时不需要提交操作。`;
  }
  if (snapshot.currentPhase === "voting") {
    return "所有存活玩家同时投票；提交前彼此看不到选择，公开后会显示每个人的票。";
  }
  if (snapshot.currentPhase === "hitler_check") {
    return "政府已通过，正在结算危险胜利条件；不会公开真实身份，只公开是否触发终局。";
  }
  if (taskType === "PRESIDENT_DISCARD_POLICY") {
    return "你秘密摸 3 弃 1；其他人等待，手牌与弃牌都不会公开。";
  }
  if (snapshot.currentPhase === "legislative_president") {
    return "总统正在秘密处理政策牌；其他玩家等待，不能看到总统手牌或弃牌。";
  }
  if (taskType === "CHANCELLOR_ENACT_POLICY") {
    return taskMapper.canRequestVeto(snapshot)
      ? "你可颁布 1 张政策或请求否决；未颁布的牌不会公开。"
      : "你秘密从 2 张中颁布 1 张；另一张弃牌不会公开。";
  }
  if (snapshot.currentPhase === "legislative_chancellor") {
    return "总理正在秘密处理政策牌；其他玩家等待，只会公开最终颁布的政策。";
  }
  if (taskType === "PRESIDENT_RESPOND_VETO") {
    return "你决定是否同意否决；同意则本轮无政策颁布，拒绝则总理必须颁布。";
  }
  if (snapshot.currentPhase === "veto_response") {
    return "总理已提出否决，等待总统回应；总理手中政策牌内容不会公开。";
  }
  if (snapshot.currentPhase === "executive_action") {
    if (taskType === "EXEC_POLICY_PEEK_ACK") {
      return "你秘密查看牌库顶 3 张并按原顺序放回；牌面不会公开。";
    }
    if (taskType === "EXEC_INVESTIGATE") {
      return "你选择调查对象并秘密查看其党派归属；结果是否公开由你发言决定。";
    }
    if (taskType === "EXEC_SPECIAL_ELECTION") {
      return "你指定下一轮特别总统候选人；该选择会公开，但不会永久改变轮换顺序。";
    }
    if (taskType === "EXECUTE_PLAYER") {
      return "你选择处决 1 名玩家；只有处决到独裁者时才会公开并立即终局。";
    }
    return `${board.presidentSeatNo}号正在执行${(action && action.title) || "总统权力"}；其他玩家等待，私密结果不会自动公开。`;
  }
  if (snapshot.currentPhase === "round_result") {
    return "本轮公开结算中；隐藏身份、弃牌和调查结果仍不公开。";
  }
  if (snapshot.currentPhase === "game_ended") {
    return "对局已结束，可进入复盘查看最终身份与关键时间线。";
  }
  return "当前无需主动操作；按桌面公开信息讨论，隐藏信息仍由玩家自行陈述。";
}

function createVoteResult(snapshot) {
  const publicState = (snapshot && snapshot.publicState) || {};
  const revealedVotes = Array.isArray(publicState.revealedVotes) ? publicState.revealedVotes : null;
  const result = publicState.voteResult || {};
  if (!revealedVotes) {
    return null;
  }
  const voteRows = revealedVotes.map((item) => ({
    memberId: item.memberId,
    name: item.displayName || "玩家",
    voteText: item.vote === "JA" ? "JA" : "NEIN",
    voteClass: item.vote === "JA" ? "is-ja" : "is-nein",
  }));
  let detailText = `赞成 ${result.jaCount || 0}，反对 ${result.neinCount || 0}`;
  if (result.chaosPolicy) {
    const policyName = result.chaosPolicy.policy === "LIBERAL" ? "自由派政策" : "极权派政策";
    detailText = `${detailText}；三轮未通过，混乱政策颁布：${policyName}`;
  } else if (result.hitlerCheck && result.hitlerCheck.checked) {
    detailText = result.hitlerCheck.passed
      ? `${detailText}；危险阶段检查通过：该总理不是独裁者`
      : `${detailText}；独裁者当选，极权派获胜`;
  } else {
    detailText = `${detailText}；选举计数器 ${result.electionTrackerBefore || 0} → ${
      result.electionTrackerAfter || 0
    }`;
  }

  return {
    resultKey: [
      result.round || snapshot.round || 1,
      result.presidentCandidateId || publicState.currentPresidentCandidateId || "",
      result.chancellorCandidateId || publicState.currentChancellorCandidateId || "",
      result.jaCount || 0,
      result.neinCount || 0,
      result.electionTrackerBefore || 0,
      result.electionTrackerAfter || 0,
      result.passed ? "passed" : "failed",
    ].join(":"),
    title: result.passed ? "投票通过" : "投票未通过",
    resultClass: result.passed ? "is-passed" : "is-failed",
    detailText,
    voteRows,
  };
}

function createVoteResultViewerKey(snapshot, controlledMemberId = "") {
  return controlledMemberId || (snapshot && (snapshot.myMemberId || snapshot.realMemberId)) || "self";
}

module.exports = {
  createActiveIdentityPickerOptions,
  createBoard,
  createControlledSeatText,
  createDeckPiles,
  createElectionTrack,
  createFascistTrack,
  createIdentityMarkView,
  createIdentityPickerOptions,
  createVisibleFascistNameMemberIdSet,
  createInvestigationMarkMap,
  createLiberalTrack,
  createPhaseHintText,
  createSeats,
  createStatusText,
  createVoteProgressText,
  createVoteResult,
  createVoteResultViewerKey,
  getInvestigationStampSrc,
};
