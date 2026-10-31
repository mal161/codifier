import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitContext } from "@codifier/domain";

const execFileAsync = promisify(execFile);
const gitTimeoutMs = 3_000;
const gitOutputLimit = 1_048_576;

export async function readGitContext(
  repositoryRoot: string,
): Promise<GitContext> {
  let topLevel: string;
  try {
    const result = await runGit(repositoryRoot, [
      "rev-parse",
      "--show-toplevel",
    ]);
    topLevel = result.stdout.trim();
    if (!topLevel) {
      return unavailableGitContext();
    }
  } catch (error) {
    if (isGitUnavailable(error)) {
      return unavailableGitContext();
    }
    if (isNotGitRepository(error)) {
      return {
        commit: null,
        branch: null,
        workingTree: "not-a-repository",
      };
    }
    throw error;
  }

  const [commitResult, branchResult, statusResult] = await Promise.all([
    runGit(topLevel, ["rev-parse", "--verify", "--quiet", "HEAD"]).catch(
      (error: unknown) =>
        isMissingGitHead(error) ? null : Promise.reject(error),
    ),
    runGit(topLevel, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(
      (error: unknown) =>
        isDetachedHead(error) ? null : Promise.reject(error),
    ),
    runGit(topLevel, [
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      "status",
      "--porcelain=v1",
      "--untracked-files=normal",
      "-z",
    ]).catch((error: unknown) => {
      if (isGitUnavailable(error)) {
        return null;
      }
      return Promise.reject(error);
    }),
  ]);

  return {
    commit: commitResult?.stdout.trim() || null,
    branch: branchResult?.stdout.trim() || null,
    workingTree: statusResult
      ? statusResult.stdout.length === 0
        ? "clean"
        : "dirty"
      : "unknown",
  };
}

function unavailableGitContext(): GitContext {
  return { commit: null, branch: null, workingTree: "unavailable" };
}

async function runGit(
  repositoryRoot: string,
  args: string[],
): Promise<{ stdout: string }> {
  return execFileAsync("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    timeout: gitTimeoutMs,
    maxBuffer: gitOutputLimit,
    windowsHide: true,
  });
}

function isGitUnavailable(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isNotGitRepository(error: unknown): boolean {
  return (
    isRecord(error) &&
    error.code === 128 &&
    /not a git repository|cannot change to .*no such file or directory/i.test(
      String(error.stderr ?? ""),
    )
  );
}

function isMissingGitHead(error: unknown): boolean {
  return isRecord(error) && error.code === 1;
}

function isDetachedHead(error: unknown): boolean {
  return isRecord(error) && error.code === 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
