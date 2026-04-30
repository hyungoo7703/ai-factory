/**
 * Thin wrappers around simple-git for the operations we actually use.
 */
import { simpleGit, type SimpleGit } from "simple-git";

export function gitOf(repoPath: string): SimpleGit {
  return simpleGit({ baseDir: repoPath });
}

export async function ensureGitRepo(repoPath: string): Promise<void> {
  const g = gitOf(repoPath);
  const isRepo = await g.checkIsRepo();
  if (!isRepo) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }
}

export async function currentBranch(repoPath: string): Promise<string> {
  const g = gitOf(repoPath);
  const status = await g.status();
  return status.current ?? "HEAD";
}

export async function hasUncommittedChanges(repoPath: string): Promise<boolean> {
  const g = gitOf(repoPath);
  const status = await g.status();
  return status.files.length > 0;
}

export async function commitAll(
  repoPath: string,
  message: string
): Promise<string | null> {
  const g = gitOf(repoPath);
  const status = await g.status();
  if (status.files.length === 0) return null;
  await g.add(".");
  const commit = await g.commit(message);
  return commit.commit ?? null;
}
