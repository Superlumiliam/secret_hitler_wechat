export type ErrorCode =
  | 'INVALID_PAYLOAD'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_EXPIRED'
  | 'ROOM_FULL'
  | 'ROOM_NOT_JOINABLE'
  | 'NOT_ROOM_MEMBER'
  | 'NOT_ROOM_HOST'
  | 'INVALID_PLAYER_COUNT'
  | 'NOT_ALL_READY'
  | 'GAME_NOT_STARTED'
  | 'GAME_ALREADY_STARTED'
  | 'GAME_ALREADY_ENDED'
  | 'PHASE_MISMATCH'
  | 'VERSION_CONFLICT'
  | 'DUPLICATE_COMMAND'
  | 'NOT_CURRENT_ACTOR'
  | 'INVALID_TARGET'
  | 'TARGET_ALREADY_DEAD'
  | 'TARGET_ALREADY_INVESTIGATED'
  | 'ACTION_NOT_ALLOWED'
  | 'INTERNAL_ERROR';

export interface FrontendError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  requestId?: string;
  functionName?: string;
  action?: string;
  raw?: unknown;
}

