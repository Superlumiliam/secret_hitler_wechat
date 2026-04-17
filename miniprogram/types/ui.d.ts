export interface ToastState {
  type: 'success' | 'error' | 'info';
  text: string;
  at: number;
}

export interface UiState {
  globalLoadingText: string;
  privacyShieldVisible: boolean;
  latestToast: ToastState | null;
}

