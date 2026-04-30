/**
 * "gate" station handler — pauses the run for human review.
 *
 * In CLI mode, this prints the pending diff and prompts the user to approve
 * or reject. On approval, the most recent worktree-bearing station is
 * fast-forward merged into the project's current branch.
 */
import { existsSync, readFileSync } from "node:fs";
import inquirer from "inquirer";
import path from "node:path";
import type { RunContext, StationDef, StationResult } from "../core/types.js";
import { log } from "../utils/logger.js";
import { promoteWorktree, releaseWorktree, type WorktreeHandle } from "../core/worktree.js";

export interface GateStationDeps {
  /** Worktree handle from the most recent llm station, if any. */
  pendingWorktree?: WorktreeHandle;
  /** Non-interactive mode — auto-approve (used by `factory run --yes`). */
  autoApprove?: boolean;
}

export async function runGateStation(
  ctx: RunContext,
  station: StationDef,
  priorOutputs: Map<string, StationResult>,
  deps: GateStationDeps
): Promise<StationResult> {
  const startedAt = new Date().toISOString();

  // Show a digest of what's pending.
  log.step(`[${station.name}] Human gate`);
  log.raw("");
  log.raw("Pending station outputs:");
  let anyFail = false;
  for (const [name, r] of priorOutputs) {
    const verdict = r.verdict ?? r.status;
    if (r.verdict === "FAIL") anyFail = true;
    log.raw(`  • ${name}: ${verdict}${typeof r.score === "number" ? ` (score ${r.score})` : ""}`);
  }
  log.raw("");
  if (anyFail) {
    log.warn("One or more stations FAILED — recommended action is to reject and discard.");
    log.raw("");
  }
  if (deps.pendingWorktree) {
    log.raw(`Pending worktree: ${deps.pendingWorktree.path}`);
    log.raw(`Pending branch:   ${deps.pendingWorktree.branch}`);
    log.raw("");
  }

  // Show last station's output preview if available.
  const last = Array.from(priorOutputs.values()).pop();
  if (last?.output) {
    const preview = last.output.length > 2000 ? last.output.slice(0, 2000) + "\n\n…(truncated)" : last.output;
    log.raw("--- Last output preview ---");
    log.raw(preview);
    log.raw("--- end preview ---");
    log.raw("");
  }

  let approve = false;
  if (deps.autoApprove) {
    if (anyFail) {
      log.warn("[gate] --yes set but a station FAILED. Auto-rejecting and discarding to be safe.");
      if (deps.pendingWorktree) await releaseWorktree(ctx.projectRoot, deps.pendingWorktree);
      return {
        station: station.name,
        status: "awaiting_human",
        verdict: "FAIL",
        output: "Auto-rejected: one or more stations failed; --yes does not auto-merge failures.",
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }
    approve = true;
    log.info("[gate] auto-approving (--yes)");
  } else {
    const choices = [
      { name: "Approve and merge into current branch", value: "approve" },
      { name: "Reject (keep worktree, stop run)", value: "reject" },
      { name: "Reject and discard worktree", value: "discard" },
    ];
    const answer = await inquirer.prompt<{ choice: string }>([
      {
        type: "list",
        name: "choice",
        message: anyFail
          ? "A station FAILED. Approve and merge anyway?"
          : "Approve and merge?",
        choices,
        default: anyFail ? "discard" : "approve",
      },
    ]);
    approve = answer.choice === "approve";
    if (answer.choice === "discard" && deps.pendingWorktree) {
      await releaseWorktree(ctx.projectRoot, deps.pendingWorktree);
    }
  }

  if (!approve) {
    return {
      station: station.name,
      status: "awaiting_human",
      verdict: "WARN",
      output: "Human rejected at gate.",
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  if (deps.pendingWorktree) {
    try {
      await promoteWorktree(ctx.projectRoot, deps.pendingWorktree);
      log.ok(`[${station.name}] merged ${deps.pendingWorktree.branch} into project`);
      await releaseWorktree(ctx.projectRoot, deps.pendingWorktree, { keepBranch: true });
    } catch (err) {
      log.error(
        `[${station.name}] merge failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return {
        station: station.name,
        status: "failed",
        verdict: "FAIL",
        output: String(err),
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }
  } else {
    log.info(`[${station.name}] no worktree to merge; gate is informational only`);
  }

  return {
    station: station.name,
    status: "completed",
    verdict: "PASS",
    output: "Approved.",
    startedAt,
    completedAt: new Date().toISOString(),
  };
}
