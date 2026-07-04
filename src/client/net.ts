// Thin WebSocket wrapper. Connects to /ws (Vite proxies it in dev).

import type { C2S, S2C } from "../shared/protocol";

export class Net {
  private ws: WebSocket | null = null;
  private handlers: ((msg: S2C) => void)[] = [];
  onClose: (() => void) | null = null;

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Could not reach the server."));
      ws.onclose = () => this.onClose?.();
      ws.onmessage = (ev) => {
        let msg: S2C;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        for (const h of this.handlers) h(msg);
      };
    });
  }

  on(handler: (msg: S2C) => void): void {
    this.handlers.push(handler);
  }

  send(msg: C2S): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
