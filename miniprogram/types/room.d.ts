export interface LobbySeat {
  memberId: string;
  displayName: string;
  seatIndex: number;
  isHost: boolean;
  isReady: boolean;
}

export interface LobbySnapshot {
  roomId: string;
  roomCode: string;
  roomStatus: 'lobby';
  hostMemberId: string;
  playerCount: number;
  minPlayerCount: number;
  maxPlayerCount: number;
  seatOrder: LobbySeat[];
  myMemberId: string;
  canStart: boolean;
  version: number;
  updatedAt: string;
}

export interface LobbyViewModel {
  roomId: string;
  roomCode: string;
  roomStatus: 'lobby';
  myMemberId: string;
  hostMemberId: string;
  isHost: boolean;
  canStart: boolean;
  playerCount: number;
  minPlayerCount: number;
  maxPlayerCount: number;
  players: Array<LobbySeat & { isSelf: boolean }>;
  summaryText: string;
  version: number;
  updatedAt: string;
}

