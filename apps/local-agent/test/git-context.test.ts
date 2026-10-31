import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readGitContext } from "../src/git-context.js";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "codifier-git-context-"));
  temporaryDirectories.push(directory);
  return directory;
}

function runGit(repositoryRoot: string, args: string[]): void {
  execFileSync("git", ["-C", repositoryRoot, ...args], {
    stdio: "ignore",
    windowsHide: true,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("readGitContext", () => {
  it("reports commit, branch, and clean or dirty state without requiring a clean tree", async () => {
    const root = await createTemporaryDirectory();
    runGit(root, ["init", "--quiet"]);
    runGit(root, ["config", "user.name", "Codifier test"]);
    runGit(root, ["config", "user.email", "codifier-test@example.invalid"]);
    await writeFile(join(root, "index.ts"), "export const value = 1;\n");
    runGit(root, ["add", "index.ts"]);
    runGit(root, ["commit", "--quiet", "-m", "initial"]);

    const clean = await readGitContext(root);
    expect(clean).toMatchObject({
      commit: expect.stringMatching(/^[0-9a-f]{40}$/i),
      workingTree: "clean",
    });
    expect(clean.branch).toBeTruthy();

    await writeFile(join(root, "index.ts"), "export const value = 2;\n");
    await writeFile(join(root, "untracked.ts"), "export const added = true;\n");
    const dirty = await readGitContext(root);
    expect(dirty).toMatchObject({
      commit: clean.commit,
      branch: clean.branch,
      workingTree: "dirty",
    });
  });

  it("marks directories outside Git as not-a-repository", async () => {
    const root = await createTemporaryDirectory();

    await expect(readGitContext(root)).resolves.toEqual({
      commit: null,
      branch: null,
      workingTree: "not-a-repository",
    });
  });
});
