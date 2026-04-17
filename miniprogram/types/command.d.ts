import type { TaskType } from './task';

export interface SubmitGameCommandParams<TBody extends Record<string, unknown> = Record<string, unknown>> {
  roomId: string;
  type: TaskType;
  body: TBody;
  taskId?: string | null;
}

export interface CommandEnvelope<TBody extends Record<string, unknown> = Record<string, unknown>> {
  roomId: string;
  commandId: string;
  expectedVersion: number;
  taskId?: string | null;
  type: TaskType;
  body: TBody;
}

