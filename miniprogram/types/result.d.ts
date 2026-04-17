import type { Phase } from './game';

export interface ResultSnapshot {
  roomId: string;
  roomCode: string;
  roomStatus: 'ended';
  myMemberId: string;
  version: number;
  winner: 'LIBERAL' | 'FASCIST';
  winReason: string;
  endedAt: string;
  policySummary: {
    liberal: number;
    fascist: number;
  };
  finalPlayers: Array<{
    memberId: string;
    displayName: string;
    seatIndex: number;
    role: 'LIBERAL' | 'FASCIST' | 'HITLER';
    party: 'LIBERAL' | 'FASCIST';
    isAlive: boolean;
  }>;
  timeline: Array<{
    eventId: string;
    round: number;
    phase: Phase | string;
    type: string;
    title: string;
    summary: string;
    createdAt: string;
  }>;
}

export interface ResultViewModel {
  roomId: string;
  roomCode: string;
  winner: 'LIBERAL' | 'FASCIST';
  winReason: string;
  policySummary: {
    liberal: number;
    fascist: number;
  };
  finalPlayers: ResultSnapshot['finalPlayers'];
  timeline: ResultSnapshot['timeline'];
  winnerLabel: string;
  reasonLabel: string;
}

