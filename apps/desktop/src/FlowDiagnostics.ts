import { narrate, narrateBatch } from "./narrationLog";

function redact(value: string): string {
  return value
    .replace(/(?:https?:\/\/|magnet:\?|postgres(?:ql)?:\/\/)[^\s]+/gi, "[source redacted]")
    .replace(/(password|token|authorization|api[_-]?key|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
}

/** All detail belongs to this operation, with no size or event limit. */
export class FlowDiagnostics {
  private records: string[] = [];
  private closed = false;
  private readonly started = performance.now();
  private readonly id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

  constructor(private readonly operation: string, private readonly area: string) {}

  debug(message: string): void {
    if (!this.closed) this.records.push(`${new Date().toISOString()} flow=${this.id} ${redact(message)}`);
  }

  get pendingCount(): number { return this.records.length; }

  discard(): void {
    this.records = [];
    this.closed = true;
  }

  succeed(): void { this.discard(); }

  fail(error: unknown): void {
    if (this.closed) return;
    const records = this.records;
    this.discard();
    // Queue detail before the final error; only that error is remotely reported.
    void narrateBatch(records.map(record => `[DEBUG] operation=${this.operation} ${record}`), { area: this.area });
    void narrate(`flow=${this.id} operation=${this.operation} failed after ${Math.round(performance.now() - this.started)}ms: ${redact(String(error))}`, { area: this.area, level: "ERROR" });
  }
}
