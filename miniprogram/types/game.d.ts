import type { PendingTaskViewModel } from './task';

export type Phase =
  | 'role_reveal'
  | 'nomination'
  | 'voting'
  | 'hitler_check'
  | 'legislative_president'
  | 'legislative_chancellor'
  | 'veto_response'
  | 'executive_action'
  | 'round_result'
  | 'game_ended';

export interface SeatViewModel {
  memberId: string;
  displayName: string;
  seatIndex: number;
  isAlive: boolean;
  isOffline: boolean;
  confirmedNotHitler: boolean;
  isSelf: boolean;
  isCurrentPresidentCandidate?: boolean;
  isCurrentChancellorCandidate?: boolean;
  isCurrentPresident?: boolean;
  isCurrentChancellor?: boolean;
}

export interface GovernmentViewModel {
  president: SeatViewModel | null;
  chancellor: SeatViewModel | null;
  presidentCandidate: SeatViewModel | null;
  chancellorCandidate: SeatViewModel | null;
}

export interface PublicLogItem {
  eventId: string;
  round: number;
  phase: Phase | string;
  type: string;
  title: string;
  summary: string;
  createdAt: string;
}

export interface GameSnapshot {
  roomId: string;
  roomCode: string;
  roomStatus: 'in_game';
  myMemberId: string;
  version: number;
  round: number;
  currentPhase: Phase;
  publicState: any;
  privateState: any;
  pendingTask: any;
  serverHints: string[];
  updatedAt: string;
}

export interface GameBoardViewModel {
  roomId: string;
  roomCode: string;
  version: number;
  round: number;
  phase: Phase;
  phaseTitle: string;
  phaseDescription: string;
  phaseDanger: boolean;
  players: SeatViewModel[];
  government: GovernmentViewModel;
  tracks: {
    liberal: number;
    fascist: number;
    electionTracker: number;
    vetoUnlocked: boolean;
  };
  publicLogs: PublicLogItem[];
  dangerFlags: string[];
  currentTaskSummary: string;
}

export interface IdentityViewModel {
  roomId: string;
  roomCode: string;
  acknowledged: boolean;
  role: 'LIBERAL' | 'FASCIST' | 'HITLER' | null;
  party: 'LIBERAL' | 'FASCIST' | null;
  knownMembers: Array<{ memberId: string; displayName: string }>;
  title: string;
  description: string;
}

