/**
 * Budget tracker — hard caps on tokens, cost, duration, and tool calls.
 *
 * The factory enforces budgets at three levels: total run, per station, and
 * per single bot invocation. Exceeding a hard limit throws BudgetExhausted
 * which the conductor surfaces to the user as an awaiting_human event.
 */
import type { Budget } from "./types.js";

export class BudgetExhausted extends Error {
  constructor(public readonly metric: keyof Budget, public readonly used: number, public readonly limit: number) {
    super(`Budget exhausted: ${metric} ${used.toFixed(2)} / ${limit}`);
    this.name = "BudgetExhausted";
  }
}

export interface BudgetUsage {
  tokens: number;
  costUsd: number;
  durationMin: number;
  toolCalls: number;
}

export const DEFAULT_BUDGET: Budget = {
  tokens: 1_000_000,
  costUsd: 5.0,
  durationMin: 60,
  toolCalls: 500,
  subAgentMaxDepth: 2,
  subAgentMaxCount: 5,
};

export class BudgetTracker {
  private readonly limit: Budget;
  private used: BudgetUsage = { tokens: 0, costUsd: 0, durationMin: 0, toolCalls: 0 };
  private readonly start = Date.now();
  private readonly warnedMetrics = new Set<keyof Budget>();

  constructor(limit: Budget = DEFAULT_BUDGET, private onWarn?: (metric: keyof Budget, used: number, limit: number) => void) {
    this.limit = limit;
  }

  add(delta: Partial<BudgetUsage>): void {
    if (typeof delta.tokens === "number") this.used.tokens += delta.tokens;
    if (typeof delta.costUsd === "number") this.used.costUsd += delta.costUsd;
    if (typeof delta.toolCalls === "number") this.used.toolCalls += delta.toolCalls;
    this.used.durationMin = (Date.now() - this.start) / 60000;

    this.maybeWarn("tokens", this.used.tokens, this.limit.tokens);
    this.maybeWarn("costUsd", this.used.costUsd, this.limit.costUsd);
    this.maybeWarn("durationMin", this.used.durationMin, this.limit.durationMin);
    this.maybeWarn("toolCalls", this.used.toolCalls, this.limit.toolCalls);

    this.checkExhaust("tokens", this.used.tokens, this.limit.tokens);
    this.checkExhaust("costUsd", this.used.costUsd, this.limit.costUsd);
    this.checkExhaust("durationMin", this.used.durationMin, this.limit.durationMin);
    this.checkExhaust("toolCalls", this.used.toolCalls, this.limit.toolCalls);
  }

  private maybeWarn(metric: keyof Budget, used: number, limit: number): void {
    if (this.warnedMetrics.has(metric)) return;
    if (used >= limit * 0.8 && used < limit) {
      this.warnedMetrics.add(metric);
      this.onWarn?.(metric, used, limit);
    }
  }

  private checkExhaust(metric: keyof Budget, used: number, limit: number): void {
    if (used >= limit) {
      throw new BudgetExhausted(metric, used, limit);
    }
  }

  get usage(): Readonly<BudgetUsage> {
    return {
      ...this.used,
      durationMin: (Date.now() - this.start) / 60000,
    };
  }

  get limits(): Readonly<Budget> {
    return this.limit;
  }

  format(): string {
    const u = this.usage;
    const l = this.limit;
    return [
      `tokens ${u.tokens.toLocaleString()}/${l.tokens.toLocaleString()}`,
      `cost $${u.costUsd.toFixed(2)}/$${l.costUsd.toFixed(2)}`,
      `time ${u.durationMin.toFixed(1)}/${l.durationMin}min`,
      `tools ${u.toolCalls}/${l.toolCalls}`,
    ].join(" | ");
  }
}

/** Merge partial budget overrides on top of a default. */
export function resolveBudget(base: Budget, override?: Partial<Budget>): Budget {
  return { ...base, ...override };
}
