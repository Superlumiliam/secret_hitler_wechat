const { TASK_TYPE, PHASE, VOTE, POLICY_TYPE } = require('../constants/phase');

function mapTask(snapshot) {
  if (!snapshot || !snapshot.pendingTask) {
    return null;
  }

  const pendingTask = snapshot.pendingTask;
  const publicState = snapshot.publicState || {};
  const privateState = snapshot.privateState || {};
  const seatOrder = publicState.seatOrder || [];
  const allowedTargets = pendingTask.allowedTargets || [];
  const title = getTaskTitle(pendingTask, publicState, privateState);
  const description = getTaskDescription(pendingTask, publicState, privateState);
  const extra = Object.assign({}, pendingTask.meta || {});

  const targets = buildTargets(pendingTask.taskType, allowedTargets, seatOrder, snapshot.myMemberId);
  const cards = buildCards(pendingTask.taskType, privateState, pendingTask);
  const actionMode = getActionMode(pendingTask.taskType);

  const task = {
    taskId: pendingTask.taskId,
    taskType: pendingTask.taskType,
    title,
    description,
    actionMode,
    extra,
  };

  if (targets && targets.length) {
    task.targets = targets;
  }

  if (cards && cards.length) {
    task.cards = cards;
  }

  return task;
}

function getActionMode(taskType) {
  switch (taskType) {
    case TASK_TYPE.SUBMIT_VOTE:
      return 'vote';
    case TASK_TYPE.PRESIDENT_DISCARD_POLICY:
    case TASK_TYPE.CHANCELLOR_ENACT_POLICY:
      return 'pick_policy';
    case TASK_TYPE.NOMINATE_CHANCELLOR:
    case TASK_TYPE.EXEC_INVESTIGATE:
    case TASK_TYPE.EXEC_SPECIAL_ELECTION:
    case TASK_TYPE.EXECUTE_PLAYER:
      return 'pick_target';
    case TASK_TYPE.ACK_ROLE_REVEAL:
    case TASK_TYPE.EXEC_POLICY_PEEK_ACK:
      return 'confirm_only';
    case TASK_TYPE.PRESIDENT_RESPOND_VETO:
      return 'respond_veto';
    default:
      return 'none';
  }
}

function buildTargets(taskType, allowedTargets, seatOrder, myMemberId) {
  const source = allowedTargets.length
    ? allowedTargets
    : seatOrder
        .filter((player) => player.memberId !== myMemberId)
        .map((player) => ({
          memberId: player.memberId,
          displayName: player.displayName,
          seatIndex: player.seatIndex,
          isAlive: player.isAlive !== false,
        }));

  return source.map((target) => ({
    memberId: target.memberId,
    displayName: target.displayName,
    seatIndex: target.seatIndex,
    disabled: !!target.disabled,
    disabledReason: target.disabledReason || '',
    isSelf: target.memberId === myMemberId,
    isAlive: target.isAlive !== false,
    isHost: !!target.isHost,
  }));
}

function buildCards(taskType, privateState, pendingTask) {
  if (!privateState || !privateState.legislative) {
    return null;
  }

  if (
    taskType !== TASK_TYPE.PRESIDENT_DISCARD_POLICY &&
    taskType !== TASK_TYPE.CHANCELLOR_ENACT_POLICY
  ) {
    return null;
  }

  const hand = privateState.legislative.hand || [];
  return hand.map((cardType, index) => ({
    index,
    type: cardType,
    label: cardType === POLICY_TYPE.LIBERAL ? '自由派政策' : '法西斯政策',
    selected: false,
  }));
}

function getTaskTitle(task, publicState, privateState) {
  switch (task.taskType) {
    case TASK_TYPE.ACK_ROLE_REVEAL:
      return '确认身份';
    case TASK_TYPE.NOMINATE_CHANCELLOR:
      return '提名总理候选人';
    case TASK_TYPE.SUBMIT_VOTE:
      return '投票';
    case TASK_TYPE.PRESIDENT_DISCARD_POLICY:
      return '总统弃牌';
    case TASK_TYPE.CHANCELLOR_ENACT_POLICY:
      return '总理立法';
    case TASK_TYPE.PRESIDENT_RESPOND_VETO:
      return '总统回应否决';
    case TASK_TYPE.EXEC_INVESTIGATE:
      return '调查忠诚';
    case TASK_TYPE.EXEC_SPECIAL_ELECTION:
      return '特别选举';
    case TASK_TYPE.EXEC_POLICY_PEEK_ACK:
      return '查看牌顶';
    case TASK_TYPE.EXECUTE_PLAYER:
      return '处决玩家';
    default:
      return task.taskType;
  }
}

function getTaskDescription(task, publicState, privateState) {
  const meta = task.meta || {};
  if (task.taskType === TASK_TYPE.SUBMIT_VOTE) {
    return '请选择 Ja 或 Nein，并确认提交。';
  }
  if (task.taskType === TASK_TYPE.PRESIDENT_DISCARD_POLICY) {
    return '从总统手牌中弃掉 1 张。';
  }
  if (task.taskType === TASK_TYPE.CHANCELLOR_ENACT_POLICY) {
    return meta.canRequestVeto ? '可选择颁布 1 张政策，或请求否决。' : '从总理手牌中颁布 1 张。';
  }
  if (task.taskType === TASK_TYPE.PRESIDENT_RESPOND_VETO) {
    return '决定接受或拒绝本次否决。';
  }
  if (task.taskType === TASK_TYPE.EXEC_POLICY_PEEK_ACK) {
    return '查看完牌顶后确认。';
  }
  if (task.taskType === TASK_TYPE.ACK_ROLE_REVEAL) {
    return '请确认周围安全后查看身份。';
  }
  if (task.taskType === TASK_TYPE.NOMINATE_CHANCELLOR) {
    return meta.ruleHint || '从合法目标中提名一位总理候选人。';
  }
  if (task.taskType === TASK_TYPE.EXEC_INVESTIGATE) {
    return meta.actionHint || '选择一名玩家进行调查。';
  }
  if (task.taskType === TASK_TYPE.EXEC_SPECIAL_ELECTION) {
    return meta.actionHint || '选择一名玩家作为下一轮临时总统。';
  }
  if (task.taskType === TASK_TYPE.EXECUTE_PLAYER) {
    return meta.dangerConfirmText || '危险操作，请再次确认。';
  }
  return '请根据系统提示完成操作。';
}

module.exports = {
  mapTask,
};

