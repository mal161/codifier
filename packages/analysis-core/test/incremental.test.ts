import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GraphSnapshot } from "@codifier/domain";
import {
  analyzeRepository,
  createParseCache,
  type ParseCache,
  type RepositoryAnalysisReport,
} from "../src/index.js";

const repositoryId = "7b9442d6-faaa-49f9-a39e-7de8a276a978";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const baseline: Record<string, string> = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["src/lib/*"] } },
  }),
  "src/app.ts": [
    'import { helper } from "./helper";',
    'import { format } from "@lib/format";',
    'import { legacy } from "./legacy";',
    "export function run(): string {",
    "  return format(helper()) + legacy;",
    "}",
    "",
  ].join("\n"),
  "src/helper.ts": "export function helper(): string {\n  return 'h';\n}\n",
  "src/legacy.ts": "export const legacy = 'l';\n",
  "src/lib/format.ts":
    "export function format(value: string): string {\n  return value;\n}\n",
  "src/broken.ts": "export const broken = ;\n",
  "src/view.jsx": "export const View = () => <main>view</main>;\n",
};

async function writeRepository(
  root: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
}

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codifier-incremental-test-"));
  temporaryDirectories.push(root);
  await writeRepository(root, baseline);
  return root;
}

function analyze(
  root: string,
  previousSnapshot: GraphSnapshot | null,
  parseCache?: ParseCache,
): Promise<RepositoryAnalysisReport> {
  return analyzeRepository({
    repositoryId,
    repositoryRoot: root,
    revision: "rev",
    previousSnapshot,
    ...(parseCache ? { parseCache } : {}),
  });
}

/** Everything a clean run would produce, minus the reuse counters. */
function comparable(report: RepositoryAnalysisReport) {
  const reconciliation = { ...report.reconciliation };
  delete reconciliation.parseReuse;
  return {
    snapshot: report.snapshot,
    coverage: report.coverage,
    diagnostics: report.diagnostics,
    diagnosticsTruncated: report.diagnosticsTruncated,
    canPersist: report.canPersist,
    persistBlockers: report.persistBlockers,
    reconciliation: { ...reconciliation, reason: "" },
  };
}

function fileIds(snapshot: GraphSnapshot): Map<string, string> {
  return new Map(
    snapshot.entities
      .filter((entity) => entity.kind === "file")
      .map((entity) => [entity.name, entity.id]),
  );
}

/**
 * Warms a cache on the baseline, applies a change, then checks that the
 * cached incremental pass equals a clean pass over the same files with the
 * same identity baseline.
 */
async function expectIncrementalEqualsClean(
  change: (root: string) => Promise<void>,
): Promise<{
  incremental: RepositoryAnalysisReport;
  previous: RepositoryAnalysisReport;
}> {
  const root = await createRepository();
  const cache = createParseCache();
  const previous = await analyze(root, null, cache);
  await change(root);

  const incremental = await analyze(root, previous.snapshot, cache);
  const clean = await analyze(root, previous.snapshot);

  expect(comparable(incremental)).toEqual(comparable(clean));
  expect(clean.reconciliation.parseReuse).toEqual({
    reusedFiles: 0,
    parsedFiles: clean.coverage.supportedFiles - clean.coverage.skippedFiles,
  });
  return { incremental, previous };
}

describe("incremental analysis with a parse cache", () => {
  it("reuses every file and keeps the graph identical on a no-op refresh", async () => {
    const { incremental, previous } = await expectIncrementalEqualsClean(
      async () => {},
    );

    expect(incremental.reconciliation.mode).toBe("unchanged");
    expect(incremental.reconciliation.parseReuse).toEqual({
      reusedFiles: 6,
      parsedFiles: 0,
    });
    expect(incremental.snapshot).toEqual(previous.snapshot);
  });

  it("re-parses only an edited file and keeps unchanged identities", async () => {
    const { incremental, previous } = await expectIncrementalEqualsClean(
      (root) =>
        writeFile(
          join(root, "src/helper.ts"),
          "export function helper(): string {\n  return 'changed';\n}\nexport const extra = 1;\n",
        ),
    );

    expect(incremental.reconciliation).toMatchObject({
      mode: "full-fallback",
      changedFiles: ["src/helper.ts"],
      parseReuse: { reusedFiles: 5, parsedFiles: 1 },
    });
    expect(fileIds(incremental.snapshot)).toEqual(fileIds(previous.snapshot));
    expect(
      incremental.snapshot.entities.some((entity) => entity.name === "extra"),
    ).toBe(true);
  });

  it("invalidates an unchanged importer's resolution when its target is deleted", async () => {
    const { incremental } = await expectIncrementalEqualsClean((root) =>
      unlink(join(root, "src/legacy.ts")),
    );

    // app.ts is reused from the cache, yet its import is re-resolved.
    expect(incremental.reconciliation.parseReuse).toEqual({
      reusedFiles: 5,
      parsedFiles: 0,
    });
    expect(incremental.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unresolved_local_import",
        path: "src/app.ts",
      }),
    );
  });

  it("resolves a new import target added without editing unchanged files", async () => {
    const { incremental } = await expectIncrementalEqualsClean(async (root) => {
      await writeFile(
        join(root, "src/app.ts"),
        `${baseline["src/app.ts"]}export { added } from "./added";\n`,
      );
      await writeFile(join(root, "src/added.ts"), "export const added = 1;\n");
    });

    expect(incremental.reconciliation).toMatchObject({
      addedFiles: ["src/added.ts"],
      changedFiles: ["src/app.ts"],
      parseReuse: { reusedFiles: 5, parsedFiles: 2 },
    });
    const ids = fileIds(incremental.snapshot);
    expect(
      incremental.snapshot.relationships.some(
        (relationship) =>
          relationship.type === "REEXPORTS" &&
          relationship.targetEntityId === ids.get("src/added.ts"),
      ),
    ).toBe(true);
  });

  it("keeps identity for an unchanged file that moves", async () => {
    const { incremental, previous } = await expectIncrementalEqualsClean(
      async (root) => {
        await rename(
          join(root, "src/lib/format.ts"),
          join(root, "src/lib/fmt.ts"),
        );
        await writeFile(
          join(root, "src/app.ts"),
          baseline["src/app.ts"]!.replace("@lib/format", "@lib/fmt"),
        );
      },
    );

    expect(incremental.reconciliation.renamedFiles).toEqual([
      { from: "src/lib/format.ts", to: "src/lib/fmt.ts" },
    ]);
    expect(fileIds(incremental.snapshot).get("src/lib/fmt.ts")).toBe(
      fileIds(previous.snapshot).get("src/lib/format.ts"),
    );
  });

  it("re-resolves imports when only the TypeScript path configuration changes", async () => {
    const { incremental } = await expectIncrementalEqualsClean((root) =>
      writeFile(
        join(root, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { baseUrl: "." } }),
      ),
    );

    expect(incremental.reconciliation.parseReuse).toEqual({
      reusedFiles: 6,
      parsedFiles: 0,
    });
    expect(incremental.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "unresolved_local_import" }),
    );
    expect(
      incremental.snapshot.relationships.filter(
        (relationship) => relationship.type === "IMPORTS",
      ),
    ).toHaveLength(2);
  });

  it("reports cached syntax errors exactly like a fresh parse", async () => {
    const { incremental } = await expectIncrementalEqualsClean(async () => {});

    expect(incremental.canPersist).toBe(false);
    expect(incremental.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "error", path: "src/broken.ts" }),
    );
  });

  it("evicts least recently used entries beyond its byte budget", async () => {
    const root = await createRepository();
    const cache = createParseCache({ maxSourceBytes: 120 });

    await analyze(root, null, cache);
    expect(cache.size).toBeGreaterThan(0);
    expect(cache.sourceBytes).toBeLessThanOrEqual(120);

    const second = await analyze(root, null, cache);
    expect(second.reconciliation.parseReuse!.reusedFiles).toBeLessThan(6);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
