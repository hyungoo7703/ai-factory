/**
 * "review" station handler — implements the negotiation loop.
 *
 * Phases per round:
 *   1. Reviewer reads the target station's output and produces a verdict.
 *   2. If verdict != PASS and rounds remain, ask the original main bot to
 *      ACCEPT (rework with feedback) or DISPUTE (defend) with one paragraph.
 *   3. On ACCEPT: re-run the target station with feedback prepended.
 *   4. On DISPUTE: include both reviewer feedback and main's defense; if
 *      threshold still missed, escalate to PASS-with-WARN or FAIL.
 *
 * Output: structured JSON (verdict, score, report, feedback) parsed loosely.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { BotAdapter } from "../adapters/bot.js";
import type { Trace } from "../core/trace.js";
import type { BudgetTracker } from "../core/budget.js";
import type {
  RunContext,
  StationDef,
  StationResult,
  Verdict,
} from "../core/types.js";
import { resolveSkillPaths } from "../skills/loader.js";
import { log } from "../utils/logger.js";

export interface ReviewStationDeps {
  adapter: BotAdapter;
  trace: Trace;
  budget: BudgetTracker;
}

export async function runReviewStation(
  ctx: RunContext,
  station: StationDef,
  deps: ReviewStationDeps,
  priorOutputs: Map<string, StationResult>
): Promise<StationResult> {
  const startedAt = new Date().toISOString();
  const target = station.reviewOf!;
  const targetResult = priorOutputs.get(target);
  if (!targetResult) {
    return {
      station: station.name,
      status: "skipped",
      verdict: "WARN",
      output: `Cannot review '${target}' — station not found in completed prior outputs.`,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  const threshold = station.passThreshold ?? 80;
  const maxRounds = station.maxNegotiations ?? 2;
  const skillFiles = resolveSkillPaths(ctx.projectRoot, station.bot?.skills);

  let lastVerdict: Verdict = "WARN";
  let lastScore: number | null = null;
  let lastReport = "";
  let lastFeedback = "";
  let totalCost = 0;
  let totalToolCalls = 0;
  let totalIn = 0;
  let totalOut = 0;

  for (let round = 1; round <= maxRounds; round++) {
    deps.trace.emit({ station: station.name, type: "review_round", data: { round } });

    const reviewPrompt = buildReviewPrompt(station, target, targetResult.output ?? "", round, lastFeedback);

    const reviewResult = await deps.adapter.run({
      name: station.bot?.name ?? "reviewer",
      model: station.bot?.model,
      persona:
        station.bot?.persona ??
        "You are a senior code reviewer. Be direct, specific, and cite line numbers or file paths when possible. Flag any unjustified claims.",
      prompt: reviewPrompt,
      cwd: ctx.projectRoot,
      skillFiles,
      signal: ctx.signal,
      timeoutMs: 10 * 60 * 1000,
    });
    totalCost += reviewResult.costUsd ?? 0;
    totalToolCalls += reviewResult.toolCalls;
    totalIn += reviewResult.tokensIn ?? 0;
    totalOut += reviewResult.tokensOut ?? 0;

    deps.budget.add({
      tokens: (reviewResult.tokensIn ?? 0) + (reviewResult.tokensOut ?? 0),
      costUsd: reviewResult.costUsd ?? 0,
      toolCalls: reviewResult.toolCalls,
    });

    const parsed = parseReviewResponse(reviewResult.content);
    lastVerdict = parsed.verdict;
    lastScore = parsed.score;
    lastReport = parsed.report;
    lastFeedback = parsed.feedback ?? "";

    log.info(
      `[${station.name}] round ${round}: verdict=${lastVerdict} score=${lastScore ?? "?"} threshold=${threshold}`
    );

    if (lastVerdict === "PASS" && lastScore !== null && lastScore >= threshold) break;
    if (round === maxRounds) break;

    // Negotiation: ask the main bot to accept or dispute.
    const negPrompt = [
      `# Negotiation Round ${round}`,
      "",
      `Reviewer verdict: ${lastVerdict} (score: ${lastScore ?? "n/a"})`,
      "",
      "## Reviewer Feedback",
      "",
      lastFeedback || lastReport,
      "",
      "## Your Original Output",
      "",
      (targetResult.output ?? "").slice(0, 8000),
      "",
      "Decide: ACCEPT (rework using the feedback) or DISPUTE (defend, citing why the reviewer is wrong).",
      "Reply with one of:",
      '  "VERDICT: ACCEPT" followed by a revised output, OR',
      '  "VERDICT: DISPUTE" followed by a one-paragraph rebuttal.',
    ].join("\n");

    const negResult = await deps.adapter.run({
      name: "main-negotiator",
      cwd: ctx.projectRoot,
      prompt: negPrompt,
      signal: ctx.signal,
      timeoutMs: 10 * 60 * 1000,
    });
    totalCost += negResult.costUsd ?? 0;
    totalToolCalls += negResult.toolCalls;
    totalIn += negResult.tokensIn ?? 0;
    totalOut += negResult.tokensOut ?? 0;

    deps.budget.add({
      tokens: (negResult.tokensIn ?? 0) + (negResult.tokensOut ?? 0),
      costUsd: negResult.costUsd ?? 0,
      toolCalls: negResult.toolCalls,
    });

    if (/VERDICT:\s*DISPUTE/i.test(negResult.content)) {
      // Dispute resolved — escalate verdict to WARN if still below threshold.
      log.info(`[${station.name}] main bot disputed; ending negotiation`);
      lastFeedback += "\n\n## Main Bot Dispute\n\n" + negResult.content;
      break;
    }
    // ACCEPT: replace target output with the new draft and continue loop.
    const newDraft = negResult.content.replace(/^.*VERDICT:\s*ACCEPT\s*\n?/im, "").trim();
    if (newDraft) {
      targetResult.output = newDraft;
    }
  }

  const reviewDir = path.join(ctx.runDir, "stations", station.name);
  mkdirSync(reviewDir, { recursive: true });
  writeFileSync(path.join(reviewDir, "review.md"), lastReport, "utf-8");

  return {
    station: station.name,
    status: "completed",
    verdict: lastVerdict,
    score: lastScore ?? undefined,
    output: lastReport,
    artifacts: [path.join(reviewDir, "review.md")],
    startedAt,
    completedAt: new Date().toISOString(),
    costUsd: totalCost,
    tokensIn: totalIn,
    tokensOut: totalOut,
    toolCalls: totalToolCalls,
  };
}

function buildReviewPrompt(
  station: StationDef,
  target: string,
  targetOutput: string,
  round: number,
  prevFeedback: string
): string {
  return [
    `# Review of '${target}' — Round ${round}`,
    "",
    "You are reviewing the output below. Produce a structured verdict.",
    "",
    "## Output Under Review",
    "",
    targetOutput.slice(0, 30000),
    "",
    prevFeedback ? `## Prior Round Feedback\n\n${prevFeedback}\n` : "",
    "## Format Requirements",
    "",
    "End your response with a JSON block containing keys: verdict (PASS|FAIL|WARN), score (0-100), feedback (string).",
    "Example:",
    "```json",
    '{"verdict":"WARN","score":72,"feedback":"Missing error handling in ..."}',
    "```",
    "",
    "Be terse and specific. No filler.",
  ].join("\n");
}

export function parseReviewResponse(content: string): {
  verdict: Verdict;
  score: number | null;
  report: string;
  feedback: string | null;
} {
  const jsonMatch =
    content.match(/```json\s*([\s\S]*?)```/) ??
    content.match(/\{\s*"verdict"[\s\S]*?\}/);

  if (jsonMatch) {
    try {
      const json = JSON.parse(jsonMatch[1] ?? jsonMatch[0]) as {
        verdict?: string;
        score?: number;
        feedback?: string;
      };
      const verdict: Verdict = ["PASS", "FAIL", "WARN"].includes(String(json.verdict))
        ? (json.verdict as Verdict)
        : "WARN";
      return {
        verdict,
        score: typeof json.score === "number" ? json.score : null,
        report: content,
        feedback: json.feedback ?? null,
      };
    } catch {
      /* fall through */
    }
  }

  // Heuristic fallback.
  const hasFail = /\bFAIL\b/i.test(content);
  const hasPass = /\bPASS\b/i.test(content);
  const criticals = (content.match(/\b(critical|severe)\b/gi) ?? []).length;
  const highs = (content.match(/\bhigh\b/gi) ?? []).length;
  const verdict: Verdict = hasFail || criticals > 0 ? "FAIL" : hasPass ? "PASS" : "WARN";
  const score = Math.max(0, 100 - criticals * 25 - highs * 15);
  return { verdict, score, report: content, feedback: verdict === "PASS" ? null : content };
}
