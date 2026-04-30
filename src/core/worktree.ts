/**
 * Worktree manager — creates per-station git worktrees so the LLM can never
 * touch the user's main working tree.
 *
 * Lifecycle:
 *   1. acquire()   — create a worktree on a fresh branch from HEAD
 *   2. (LLM runs inside it, makes commits)
 *   3. promote()   — fast-forward the user's current branch to the worktree
 *      branch (only if the user explicitly merges via the gate station)
 *   4. release()   — remove the worktree and (optionally) the branch
 *
 * On cancellation/failure we always release without promoting.
 */
import { mkdirSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { gitOf } from "../utils/git.js";

export interface WorktreeHandle {
  /** Absolute path to the worktree directory. */
  path: string;
  /** Branch name backing this worktree. */
  branch: string;
  /** The base ref the worktree was created from. */
  baseRef: string;
}

export interface AcquireOptions {
  projectRoot: string;
  /** Parent dir for sandbox worktrees (factory.sandboxDir). */
  sandboxDir: string;
  /** Branch prefix, e.g. "factory/feature-abc". */
  branchPrefix: string;
  /** Suffix used in folder name (typically station name). */
  suffix: string;
}

export async function acquireWorktree(opts: AcquireOptions): Promise<WorktreeHandle> {
  const branch = `${opts.branchPrefix}/${opts.suffix}`;
  const sanitized = branch.replace(/[^a-zA-Z0-9._/-]/g, "_");
  const safe = sanitized.replace(/\//g, "__");
  mkdirSync(opts.sandboxDir, { recursive: true });
  const wtPath = path.join(opts.sandboxDir, safe);

  if (existsSync(wtPath)) {
    // Stale leftover from a previous crash — clean it up.
    await releaseWorktree(opts.projectRoot, { path: wtPath, branch: sanitized, baseRef: "HEAD" });
  }

  const g = gitOf(opts.projectRoot);

  // Ensure the repo has at least one commit — `git worktree add` requires a
  // resolvable HEAD. Repos that were just `git init`'d have no HEAD yet.
  let baseRef: string;
  try {
    const baseRefRaw = await g.revparse(["HEAD"]);
    baseRef = baseRefRaw.trim();
  } catch {
    await g.raw(["commit", "--allow-empty", "-m", "[factory] initial commit"]);
    const baseRefRaw = await g.revparse(["HEAD"]);
    baseRef = baseRefRaw.trim();
  }

  // Try to add a fresh worktree on a new branch.
  // simple-git does not yet expose `worktree add` — use raw().
  await g.raw(["worktree", "add", "-b", sanitized, wtPath, baseRef]);

  return { path: wtPath, branch: sanitized, baseRef };
}

export async function releaseWorktree(
  projectRoot: string,
  handle: WorktreeHandle,
  options: { keepBranch?: boolean } = {}
): Promise<void> {
  const g = gitOf(projectRoot);
  try {
    await g.raw(["worktree", "remove", "--force", handle.path]);
  } catch {
    // Fallback: rm the directory manually if git refuses.
    try {
      rmSync(handle.path, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  try {
    await g.raw(["worktree", "prune"]);
  } catch {
    /* ignore */
  }
  if (!options.keepBranch) {
    try {
      await g.raw(["branch", "-D", handle.branch]);
    } catch {
      /* branch may not exist */
    }
  }
}

/**
 * Fast-forward merge the worktree branch into the project root's current
 * branch. Used by the gate station after human approval.
 */
export async function promoteWorktree(
  projectRoot: string,
  handle: WorktreeHandle
): Promise<void> {
  const g = gitOf(projectRoot);
  await g.raw(["merge", "--ff-only", handle.branch]);
}
