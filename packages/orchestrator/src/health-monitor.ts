import { EventEmitter } from "node:events";

import type { OpenClawHealth } from "@voice-dev-agent/contracts";
import { OpenClawBridge } from "@voice-dev-agent/openclaw-bridge";

export class HealthMonitor extends EventEmitter {
  private readonly bridge: OpenClawBridge;
  private timer: NodeJS.Timeout | null = null;

  public constructor(bridge: OpenClawBridge) {
    super();
    this.bridge = bridge;
  }

  public start(intervalMs = 15000): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);

    void this.tick();
  }

  public stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const health: OpenClawHealth = await this.bridge.getHealth();
    this.emit("health", health);
  }
}
