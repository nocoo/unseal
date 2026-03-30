export type QuarantineStatus = "quarantined" | "unsealed" | "unknown";

export interface AppInfo {
  name: string;
  path: string;
  status: QuarantineStatus;
  error?: string;
}

export interface UnsealResult {
  app: AppInfo;
  success: boolean;
  error?: string;
}
