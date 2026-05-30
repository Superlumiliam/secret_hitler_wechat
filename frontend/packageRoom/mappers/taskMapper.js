const { TARGET_EXECUTIVE_COMMAND_TYPES } = require("../types/task");

function createNominateTargets(snapshot) {
  const pendingTask = snapshot && snapshot.pendingTask;
  if (!pendingTask || pendingTask.taskType !== "NOMINATE_CHANCELLOR") {
    return [];
  }

  const allowedTargets = pendingTask.allowedTargets || [];
  const targetOptions = pendingTask.meta && Array.isArray(pendingTask.meta.targetOptions) ? pendingTask.meta.targetOptions : [];
  const optionByMemberId = {};
  targetOptions.forEach((option) => {
    optionByMemberId[option.memberId] = option;
  });

  const publicState = (snapshot && snapshot.publicState) || {};
  return (publicState.seatOrder || []).map((member) => {
    const option = optionByMemberId[member.memberId] || {};
    const canNominate =
      typeof option.canNominate === "boolean" ? option.canNominate : allowedTargets.includes(member.memberId);
    const disabledReason = option.disabledReason || (canNominate ? "" : "暂不可提名");

    return {
      memberId: member.memberId,
      label: `${member.seatIndex}号 ${member.displayName}`,
      canNominate,
      disabledReason,
    };
  });
}

function createNominateTargetMap(snapshot) {
  return createNominateTargets(snapshot).reduce((map, target) => {
    map[target.memberId] = target;
    return map;
  }, {});
}

function getNominationAllowedIds(snapshot) {
  const pendingTask = snapshot && snapshot.pendingTask;
  if (!pendingTask || pendingTask.taskType !== "NOMINATE_CHANCELLOR") {
    return [];
  }
  return pendingTask.allowedTargets || [];
}

function resolveSelectedNominationTargetId(snapshot, selectedNominationTargetId = "") {
  if (!(snapshot && snapshot.pendingTask && snapshot.pendingTask.taskType === "NOMINATE_CHANCELLOR")) {
    return "";
  }
  if (!selectedNominationTargetId) {
    return "";
  }
  const publicState = snapshot.publicState || {};
  const exists = (publicState.seatOrder || []).some((member) => member.memberId === selectedNominationTargetId);
  return exists ? selectedNominationTargetId : "";
}

function createSelectedNominationTargetLabel(snapshot, selectedNominationTargetId = "") {
  const selected = resolveSelectedNominationTargetId(snapshot, selectedNominationTargetId);
  if (!selected) {
    return "";
  }
  const target = createNominateTargets(snapshot).find((item) => item.memberId === selected);
  return target ? target.label : "";
}

function createNominateRuleHint(snapshot) {
  const pendingTask = snapshot && snapshot.pendingTask;
  if (!pendingTask || pendingTask.taskType !== "NOMINATE_CHANCELLOR") {
    return "";
  }
  return (pendingTask.meta && pendingTask.meta.ruleHint) || "";
}

function canRequestVeto(snapshot) {
  const pendingTask = snapshot && snapshot.pendingTask;
  const privateState = (snapshot && snapshot.privateState) || {};
  const legislative = privateState.legislative || {};
  return Boolean(
    pendingTask &&
      pendingTask.taskType === "CHANCELLOR_ENACT_POLICY" &&
      (legislative.canRequestVeto || (pendingTask.meta && pendingTask.meta.canRequestVeto)),
  );
}

function createPolicyCards(snapshot, assets = {}, isSubmittingCommand = false) {
  const privateState = (snapshot && snapshot.privateState) || {};
  const legislative = privateState.legislative || {};
  const hand = Array.isArray(legislative.hand) ? legislative.hand : [];
  return hand.map((policy, index) => {
    const isLiberal = policy === "LIBERAL";
    return {
      index,
      policy,
      title: isLiberal ? "自由派政策" : "极权派政策",
      mark: isLiberal ? "自" : "极",
      cardSrc: isLiberal ? assets.liberalCard : assets.authoritarianCard,
      cardClass: `policy-pick-card ${isLiberal ? "is-liberal" : "is-fascist"} ${
        isSubmittingCommand ? "is-disabled" : ""
      }`,
    };
  });
}

function createPolicyPickerTitle(snapshot) {
  const privateState = (snapshot && snapshot.privateState) || {};
  const action = privateState.legislative && privateState.legislative.action;
  if (action === "discard_one") {
    return "请选择 1 张弃掉";
  }
  if (action === "enact_one") {
    return "请选择 1 张颁布";
  }
  return "";
}

function createPolicyPickerHint(snapshot) {
  const pendingTask = snapshot && snapshot.pendingTask;
  if (!pendingTask) {
    return "";
  }
  if (pendingTask.taskType === "PRESIDENT_DISCARD_POLICY") {
    return "弃牌不会公开，事后你可以自由陈述。";
  }
  if (pendingTask.taskType === "CHANCELLOR_ENACT_POLICY") {
    return canRequestVeto(snapshot)
      ? "否决需要总统同意；若总统拒绝，你仍必须颁布 1 张政策。"
      : "只公开最终颁布的政策，另一张弃牌不会公开。";
  }
  return "";
}

function createVetoResponse(snapshot) {
  if (!snapshot || snapshot.currentPhase !== "veto_response") {
    return null;
  }
  const publicState = snapshot.publicState || {};
  const seatOrder = publicState.seatOrder || [];
  const president = seatOrder.find((member) => member.memberId === publicState.currentPresidentId);
  const chancellor = seatOrder.find((member) => member.memberId === publicState.currentChancellorId);
  const pendingTask = snapshot.pendingTask || {};
  const trackerBefore =
    (pendingTask.meta && Number.isFinite(Number(pendingTask.meta.electionTrackerBefore))
      ? Number(pendingTask.meta.electionTrackerBefore)
      : publicState.electionTracker) || 0;
  const trackerAfter = Math.min(3, trackerBefore + 1);
  return {
    title: "否决请求",
    presidentName: president ? `${president.seatIndex}号 ${president.displayName}` : "总统",
    chancellorName: chancellor ? `${chancellor.seatIndex}号 ${chancellor.displayName}` : "总理",
    hint: `${chancellor ? `${chancellor.seatIndex}号 ${chancellor.displayName}` : "总理"} 提出否决。若总统同意，本轮不颁布政策，选举计数器 ${trackerBefore} → ${trackerAfter}。`,
  };
}

function createExecutiveAction(snapshot) {
  const publicState = (snapshot && snapshot.publicState) || {};
  const pendingTask = snapshot && snapshot.pendingTask;
  const taskType = pendingTask && pendingTask.taskType;
  const actionType = publicState.executiveActionType || "";
  const seatOrder = publicState.seatOrder || [];
  const president = seatOrder.find((member) => member.memberId === publicState.currentPresidentId);
  const presidentName = president ? `${president.seatIndex}号 ${president.displayName}` : "总统";
  const titleByType = {
    INVESTIGATE: "调查忠诚",
    SPECIAL_ELECTION: "特别选举",
    POLICY_PEEK: "政策预览",
    EXECUTION: "处决玩家",
  };
  const taskTitleByType = {
    EXEC_INVESTIGATE: "调查忠诚",
    EXEC_SPECIAL_ELECTION: "特别选举",
    EXEC_POLICY_PEEK_ACK: "政策预览",
    EXECUTE_PLAYER: "处决玩家",
  };
  const title = (pendingTask && pendingTask.meta && pendingTask.meta.actionTitle) || taskTitleByType[taskType] || titleByType[actionType] || "";
  if (!title && snapshot.currentPhase !== "executive_action") {
    return null;
  }

  let waitingText = `${presidentName} 正在执行${title || "总统权力"}`;
  if (actionType === "SPECIAL_ELECTION" && publicState.nextSpecialPresidentCandidateId) {
    const forced = seatOrder.find((member) => member.memberId === publicState.nextSpecialPresidentCandidateId);
    if (forced) {
      waitingText = `${presidentName} 正在发动特别选举，下一任特别总统候选人将是 ${forced.seatIndex}号 ${forced.displayName}`;
    }
  }

  return {
    title,
    hint: (pendingTask && pendingTask.meta && pendingTask.meta.actionHint) || "",
    confirmText: (pendingTask && pendingTask.meta && (pendingTask.meta.confirmText || pendingTask.meta.dangerConfirmText)) || "确认",
    taskType: taskType || "",
    actionType,
    waitingText,
  };
}

function createExecutiveTargets(snapshot) {
  const pendingTask = snapshot && snapshot.pendingTask;
  if (!pendingTask || !TARGET_EXECUTIVE_COMMAND_TYPES.includes(pendingTask.taskType)) {
    return [];
  }
  const allowedTargets = pendingTask.allowedTargets || [];
  const publicState = (snapshot && snapshot.publicState) || {};
  const isInvestigateTask = pendingTask.taskType === "EXEC_INVESTIGATE";
  return (publicState.seatOrder || []).map((member) => {
    const canTarget = allowedTargets.includes(member.memberId);
    let disabledReason = "";
    if (member.isAlive === false) {
      disabledReason = "已出局";
    } else if (!canTarget && isInvestigateTask) {
      disabledReason = "同一名玩家整局游戏不能被调查两次";
    } else if (!canTarget) {
      disabledReason = "暂不可选择";
    }
    return {
      memberId: member.memberId,
      label: `${member.seatIndex}号 ${member.displayName}`,
      canTarget,
      disabledReason,
    };
  });
}

function createExecutiveTargetMap(snapshot) {
  return createExecutiveTargets(snapshot).reduce((map, target) => {
    map[target.memberId] = target;
    return map;
  }, {});
}

function resolveSelectedExecutiveTargetId(snapshot, selectedExecutiveTargetId = "") {
  const pendingTask = snapshot && snapshot.pendingTask;
  if (!pendingTask || !TARGET_EXECUTIVE_COMMAND_TYPES.includes(pendingTask.taskType)) {
    return "";
  }
  if (!selectedExecutiveTargetId) {
    return "";
  }
  const publicState = snapshot.publicState || {};
  const exists = (publicState.seatOrder || []).some((member) => member.memberId === selectedExecutiveTargetId);
  return exists ? selectedExecutiveTargetId : "";
}

function createSelectedExecutiveTargetLabel(snapshot, selectedExecutiveTargetId = "") {
  const selected = resolveSelectedExecutiveTargetId(snapshot, selectedExecutiveTargetId);
  if (!selected) {
    return "";
  }
  const target = createExecutiveTargets(snapshot).find((item) => item.memberId === selected);
  return target ? target.label : "";
}

function createPolicyPeekCards(snapshot, assets = {}, isSubmittingCommand = false) {
  const privateState = (snapshot && snapshot.privateState) || {};
  const policyPeek = privateState.policyPeek || {};
  const cards = Array.isArray(policyPeek.cards) ? policyPeek.cards : [];
  return cards.map((policy, index) => {
    const isLiberal = policy === "LIBERAL";
    return {
      index,
      policy,
      title: isLiberal ? "自由派政策" : "极权派政策",
      mark: isLiberal ? "自" : "极",
      cardSrc: isLiberal ? assets.liberalCard : assets.authoritarianCard,
      cardClass: `policy-pick-card ${isLiberal ? "is-liberal" : "is-fascist"} ${
        isSubmittingCommand ? "is-disabled" : ""
      }`,
    };
  });
}

function createInvestigationResult(snapshot, assets = {}) {
  const privateState = (snapshot && snapshot.privateState) || {};
  const result = privateState.investigationResult || null;
  if (!result) {
    return null;
  }
  const party = result.party === "LIBERAL" ? "LIBERAL" : "FASCIST";
  const targetMemberId = result.targetMemberId || "";
  const round = result.round || "";
  const revealedAt = result.revealedAt || "";
  return {
    resultKey: `${targetMemberId}:${party}:${round}:${revealedAt}`,
    targetName: result.targetDisplayName || "目标玩家",
    party,
    partyText: party === "LIBERAL" ? "自由派" : "极权派",
    partyClass: party === "LIBERAL" ? "is-liberal-text" : "is-fascist-text",
    cardSrc: party === "LIBERAL" ? assets.identityLiberal : assets.identityFascist,
  };
}

module.exports = {
  canRequestVeto,
  createExecutiveAction,
  createExecutiveTargetMap,
  createExecutiveTargets,
  createInvestigationResult,
  createNominateRuleHint,
  createNominateTargetMap,
  createNominateTargets,
  createPolicyCards,
  createPolicyPeekCards,
  createPolicyPickerHint,
  createPolicyPickerTitle,
  createSelectedExecutiveTargetLabel,
  createSelectedNominationTargetLabel,
  createVetoResponse,
  getNominationAllowedIds,
  resolveSelectedExecutiveTargetId,
  resolveSelectedNominationTargetId,
};
