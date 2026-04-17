export type TaskType =
  | 'ACK_ROLE_REVEAL'
  | 'NOMINATE_CHANCELLOR'
  | 'SUBMIT_VOTE'
  | 'PRESIDENT_DISCARD_POLICY'
  | 'CHANCELLOR_ENACT_POLICY'
  | 'CHANCELLOR_REQUEST_VETO'
  | 'PRESIDENT_RESPOND_VETO'
  | 'EXEC_INVESTIGATE'
  | 'EXEC_SPECIAL_ELECTION'
  | 'EXEC_POLICY_PEEK_ACK'
  | 'EXECUTE_PLAYER';

export type TaskActionMode =
  | 'vote'
  | 'pick_policy'
  | 'pick_target'
  | 'confirm_only'
  | 'respond_veto'
  | 'none';

export interface TargetOption {
  memberId: string;
  displayName: string;
  seatIndex: number;
  disabled?: boolean;
  disabledReason?: string;
  isSelf?: boolean;
  isAlive?: boolean;
  isHost?: boolean;
}

export interface PolicyCardVm {
  index: number;
  type: 'LIBERAL' | 'FASCIST';
  label: string;
  selected?: boolean;
}

export interface PendingTaskViewModel {
  taskId: string;
  taskType: TaskType;
  title: string;
  description: string;
  actionMode: TaskActionMode;
  targets?: TargetOption[];
  cards?: PolicyCardVm[];
  extra?: Record<string, unknown>;
}

