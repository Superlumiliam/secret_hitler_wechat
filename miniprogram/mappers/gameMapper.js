const { PHASE, POLICY_TYPE, ROOM_STATUS } = require('../constants/phase');
const { mapTask } = require('./taskMapper');

const PHASE_META = {
  [PHASE.ROLE_REVEAL]: {
    title: '查看身份',
    description: '先确认周围安全，再查看你的秘密身份。',
    danger: false,
  },
  [PHASE.NOMINATION]: {
    title: '提名总理候选人',
    description: '总统候选人从合法目标中提名一位总理候选人。',
    danger: false,
  },
  [PHASE.VOTING]: {
    title: '公开投票',
    description: '所有存活玩家同时投出 Ja 或 Nein。',
    danger: false,
  },
  [PHASE.HITLER_CHECK]: {
    title: '希特勒检查',
    description: '系统会在必要时核验当选总理是否为希特勒。',
    danger: true,
  },
  [PHASE.LEGISLATIVE_PRESIDENT]: {
    title: '总统立法',
    description: '总统决定弃掉哪一张政策牌。',
    danger: false,
  },
  [PHASE.LEGISLATIVE_CHANCELLOR]: {
    title: '总理立法',
    description: '总理决定颁布哪一张政策牌。',
    danger: false,
  },
  [PHASE.VETO_RESPONSE]: {
    title: '否决响应',
    description: '总统决定是否接受本次否决。',
    danger: true,
  },
  [PHASE.EXECUTIVE_ACTION]: {
    title: '执行总统权力',
    description: '根据刚颁布的法西斯政策执行一次总统权力。',
    danger: true,
  },
  [PHASE.ROUND_RESULT]: {
    title: '本轮结果',
    description: '本轮流程已结束，等待下一轮。',
    danger: false,
  },
  [PHASE.GAME_ENDED]: {
    title: '对局结束',
    description: '本局已分出胜负。',
    danger: false,
  },
};

function mapGameSnapshot(snapshot) {
  if (!snapshot) {
    return {
      boardVm: null,
      identityVm: null,
      taskVm: null,
    };
  }

  const publicState = snapshot.publicState || {};
  const privateState = snapshot.privateState || {};
  const phaseMeta = PHASE_META[snapshot.currentPhase] || {
    title: '进行中',
    description: '系统正在推进当前流程。',
    danger: false,
  };

  const players = (publicState.seatOrder || []).map((seat) => ({
    memberId: seat.memberId,
    displayName: seat.displayName,
    seatIndex: seat.seatIndex,
    isAlive: seat.isAlive !== false,
    isOffline: !!seat.isOffline,
    confirmedNotHitler: !!seat.confirmedNotHitler,
    isSelf: seat.memberId === snapshot.myMemberId,
    isCurrentPresidentCandidate: seat.memberId === publicState.currentPresidentCandidateId,
    isCurrentChancellorCandidate: seat.memberId === publicState.currentChancellorCandidateId,
    isCurrentPresident: seat.memberId === publicState.currentPresidentId,
    isCurrentChancellor: seat.memberId === publicState.currentChancellorId,
  }));

  const government = {
    presidentCandidate: findPlayer(players, publicState.currentPresidentCandidateId),
    chancellorCandidate: findPlayer(players, publicState.currentChancellorCandidateId),
    president: findPlayer(players, publicState.currentPresidentId),
    chancellor: findPlayer(players, publicState.currentChancellorId),
  };

  const publicLogs = (publicState.publicHistory || []).slice(-12);

  const boardVm = {
    roomId: snapshot.roomId,
    roomCode: snapshot.roomCode,
    version: snapshot.version,
    round: snapshot.round,
    phase: snapshot.currentPhase,
    phaseTitle: phaseMeta.title,
    phaseDescription: phaseMeta.description,
    phaseDanger: phaseMeta.danger,
    players,
    government,
    tracks: {
      liberal: Number(publicState.liberalPolicyCount || 0),
      fascist: Number(publicState.fascistPolicyCount || 0),
      electionTracker: Number(publicState.electionTracker || 0),
      vetoUnlocked: !!publicState.vetoUnlocked,
    },
    publicLogs,
    dangerFlags: buildDangerFlags(snapshot, publicState, privateState),
    currentTaskSummary: snapshot.pendingTask ? snapshot.pendingTask.title || '等待你的操作' : '当前无需操作',
  };

  const identityVm = buildIdentityVm(snapshot, privateState);
  const taskVm = mapTask(snapshot);

  return {
    boardVm,
    identityVm,
    taskVm,
  };
}

function buildIdentityVm(snapshot, privateState) {
  const identity = privateState.identity || {};
  return {
    roomId: snapshot.roomId,
    roomCode: snapshot.roomCode,
    acknowledged: !!identity.acknowledged,
    role: identity.role || null,
    party: identity.party || null,
    knownMembers: identity.knownMembers || [],
    title: identity.role === 'HITLER' ? '你是希特勒' : identity.role === 'FASCIST' ? '你是法西斯' : '你是自由派',
    description: buildIdentityDescription(identity),
  };
}

function buildIdentityDescription(identity) {
  if (!identity.role) {
    return '请先查看你的身份卡。';
  }
  if (identity.role === 'HITLER') {
    return '你拥有特殊身份，但党派归属仍显示为法西斯。';
  }
  if (identity.role === 'FASCIST') {
    return '你属于法西斯阵营，请与同阵营玩家配合。';
  }
  return '你属于自由派阵营，请阻止法西斯胜利。';
}

function buildDangerFlags(snapshot, publicState, privateState) {
  const flags = [];
  if (snapshot.currentPhase === PHASE.EXECUTIVE_ACTION) {
    flags.push('当前存在总统权力待执行');
  }
  if ((publicState.fascistPolicyCount || 0) >= 3 && publicState.currentChancellorCandidateId) {
    flags.push('注意希特勒当选检查');
  }
  if (publicState.vetoUnlocked) {
    flags.push('否决权已解锁');
  }
  if (privateState.legislative && privateState.legislative.canRequestVeto) {
    flags.push('你可以请求否决');
  }
  return flags;
}

function findPlayer(players, memberId) {
  if (!memberId) return null;
  return players.find((player) => player.memberId === memberId) || null;
}

module.exports = {
  mapGameSnapshot,
};

