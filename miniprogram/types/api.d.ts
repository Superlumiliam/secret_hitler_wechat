import type { ErrorCode } from './error';

export interface ApiSuccess<T> {
  success: true;
  requestId: string;
  serverTime: string;
  data: T;
}

export interface ApiFailure {
  success: false;
  requestId: string;
  serverTime: string;
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
  };
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

