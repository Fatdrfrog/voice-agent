export class BridgeError extends Error {
  public readonly code:
    | "TIMEOUT"
    | "PROCESS_ERROR"
    | "NON_ZERO_EXIT"
    | "PARSE_ERROR"
    | "UNAVAILABLE"
    | "CONFIG_ERROR";

  public readonly stdout: string;
  public readonly stderr: string;

  public constructor(
    code: BridgeError["code"],
    message: string,
    stdout = "",
    stderr = ""
  ) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface OpenClawBridgeConfig {
  binary: string;
  gatewayUrl: string;
  gatewayToken?: string;
  defaultTimeoutMs: number;
  retries: number;
}

export interface CallStatusResponse {
  found: boolean;
  call?: unknown;
  raw: unknown;
}

export interface ApprovalAllowlistEntry {
  agent: string;
  commandPattern: string;
}
