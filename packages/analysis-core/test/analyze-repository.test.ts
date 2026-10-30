import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { validateGraphSnapshot } from "@codifier/domain";
import {
  analyzeRepository,
  RepositoryAnalysisCancelledError,
  type RepositoryAnalysisReport,
} from "../src/index.js";

const repositoryId = "7b9442d6-faaa-49f9-a39e-7de8a276a978";
const fixtureRoot = fileURLToPath(
  new URL(
    "../../../fixtures/golden-repositories/typescript-basic",
    import.meta.url,
  ),
);
const semanticFixtureRoot = fileURLToPath(
  new URL(
    "../../../fixtures/golden-repositories/typescript-semantic",
    import.meta.url,
  ),
);
const monorepoFixtureRoot = fileURLToPath(
  new URL(
    "../../../fixtures/golden-repositories/typescript-monorepo",
    import.meta.url,
  ),
);
const temporaryDirectories: string[] = [];

async function createTemporaryRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codifier-analysis-test-"));
  temporaryDirectories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("analyzeRepository", () => {
  it("extracts declarations, local imports, coverage, and exact source ranges", async () => {
    const progress: string[] = [];
    const report = await analyzeRepository({
      repositoryId,
      repositoryRoot: fixtureRoot,
      revision: "fixture-revision",
      onProgress: (entry) => progress.push(entry.phase),
    });

    expect(progress).toEqual(
      expect.arrayContaining(["inventory", "reading", "parsing", "resolving"]),
    );
    expect(report.coverage).toMatchObject({
      filesDiscovered: 3,
      supportedFiles: 2,
      analyzedFiles: 2,
      unsupportedFiles: 1,
      skippedFiles: 0,
      failedFiles: 0,
      truncated: false,
    });
    expect(report.snapshot.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "symbol",
          name: "total",
          source: expect.objectContaining({
            repositoryRelativePath: "src/index.ts",
            revision: "fixture-revision",
            range: {
              start: { line: 3, column: 0 },
              end: { line: 5, column: 1 },
            },
          }),
        }),
        expect.objectContaining({
          kind: "symbol",
          name: "Summary",
          source: expect.objectContaining({
            repositoryRelativePath: "src/index.ts",
          }),
        }),
      ]),
    );
    expect(report.snapshot.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "IMPORTS",
          targetEntityId: report.snapshot.entities.find(
            (entity) => entity.kind === "file" && entity.name === "src/math.ts",
          )?.id,
        }),
        expect.objectContaining({ type: "CONTAINS" }),
      ]),
    );
    expect(report.canPersist).toBe(true);
    expect(validateGraphSnapshot(report.snapshot)).toEqual([]);
  });

  it("returns deterministic identifiers for the same repository content", async () => {
    const first = await analyzeRepository({
      repositoryId,
      repositoryRoot: fixtureRoot,
    });
    const second = await analyzeRepository({
      repositoryId,
      repositoryRoot: fixtureRoot,
    });

    expect(first.snapshot).toEqual(second.snapshot);
  });

  it("reports analysis phases and cooperatively stops when cancelled", async () => {
    const root = await createTemporaryRepository();
    await writeFile(join(root, "first.ts"), "export const first = 1;\n");
    await writeFile(join(root, "second.ts"), "export const second = 2;\n");
    const controller = new AbortController();
    const phases: string[] = [];

    await expect(
      analyzeRepository({
        repositoryId,
        repositoryRoot: root,
        signal: controller.signal,
        onProgress: (progress) => {
          phases.push(progress.phase);
          if (progress.phase === "reading" && progress.completedFiles === 1) {
            controller.abort();
          }
        },
      }),
    ).rejects.toBeInstanceOf(RepositoryAnalysisCancelledError);

    expect(phases).toContain("inventory");
    expect(phases).toContain("reading");
    expect(phases).not.toContain("resolving");
  });

  it("retains valid-file results and reports syntax errors without allowing persistence", async () => {
    const root = await createTemporaryRepository();
    await writeFile(join(root, "good.ts"), "export const answer = 42;\n");
    await writeFile(join(root, "broken.ts"), "export function unfinished( {\n");

    const report = await analyzeRepository({
      repositoryId,
      repositoryRoot: root,
    });

    expect(report.coverage).toMatchObject({
      supportedFiles: 2,
      analyzedFiles: 1,
      failedFiles: 1,
    });
    expect(report.snapshot.entities).toContainEqual(
      expect.objectContaining({ kind: "symbol", name: "answer" }),
    );
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: expect.stringMatching(/^syntax_/),
          severity: "error",
          path: "broken.ts",
        }),
      ]),
    );
    expect(report.canPersist).toBe(false);
    expect(validateGraphSnapshot(report.snapshot)).toEqual([]);
  });

  it("excludes generated dependency directories and skips over-large files", async () => {
    const root = await createTemporaryRepository();
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(
      join(root, "node_modules", "pkg", "ignored.ts"),
      "export {};",
    );
    await writeFile(join(root, "small.ts"), "export const ok = true;\n");
    await writeFile(join(root, "large.ts"), "x".repeat(32));

    const report = await analyzeRepository({
      repositoryId,
      repositoryRoot: root,
      maxFileBytes: 30,
    });

    expect(report.coverage.excludedDirectories).toBe(1);
    expect(report.coverage.filesDiscovered).toBe(2);
    expect(report.coverage.skippedFiles).toBe(1);
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ code: "file_too_large", path: "large.ts" }),
    );
    expect(report.canPersist).toBe(false);
  });

  it("limits the inventory and identifies unresolved local imports", async () => {
    const root = await createTemporaryRepository();
    await writeFile(
      join(root, "a.ts"),
      'import { missing } from "./missing";\nexport const value = missing;\n',
    );
    await writeFile(join(root, "b.ts"), "export const other = 1;\n");

    const limited = await analyzeRepository({
      repositoryId,
      repositoryRoot: root,
      maxFiles: 1,
    });
    expect(limited.coverage.truncated).toBe(true);
    expect(limited.canPersist).toBe(false);

    const complete: RepositoryAnalysisReport = await analyzeRepository({
      repositoryId,
      repositoryRoot: root,
    });
    expect(complete.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unresolved_local_import",
        path: "a.ts",
      }),
    );
    expect(complete.canPersist).toBe(true);
  });

  it("enforces the cumulative source-read limit", async () => {
    const root = await createTemporaryRepository();
    await writeFile(join(root, "a.ts"), "export const first = 1;\n");
    await writeFile(join(root, "b.ts"), "export const second = 2;\n");

    const report = await analyzeRepository({
      repositoryId,
      repositoryRoot: root,
      maxTotalBytes: 30,
    });

    expect(report.coverage).toMatchObject({
      supportedFiles: 2,
      analyzedFiles: 1,
      skippedFiles: 1,
    });
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ code: "analysis_size_limit", path: "b.ts" }),
    );
    expect(report.canPersist).toBe(false);
  });

  it("resolves TypeScript path aliases to analyzed files", async () => {
    const root = await createTemporaryRepository();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@core/*": ["src/*"] },
        },
      }),
    );
    await writeFile(
      join(root, "main.ts"),
      'import { add } from "@core/math";\nexport const result = add(1, 2);\n',
    );
    await writeFile(
      join(root, "src", "math.ts"),
      "export function add(a: number, b: number) { return a + b; }\n",
    );

    const report = await analyzeRepository({
      repositoryId,
      repositoryRoot: root,
    });

    const targetFile = report.snapshot.entities.find(
      (entity) => entity.kind === "file" && entity.name === "src/math.ts",
    );
    expect(targetFile).toBeDefined();
    expect(report.snapshot.relationships).toContainEqual(
      expect.objectContaining({
        type: "IMPORTS",
        targetEntityId: targetFile!.id,
      }),
    );
    expect(report.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "unresolved_local_import" }),
    );
  });

  it("loads inherited tsconfig options and resolves local workspace package exports", async () => {
    const report = await analyzeRepository({
      repositoryId,
      repositoryRoot: monorepoFixtureRoot,
    });
    const importerId = report.snapshot.entities.find(
      (entity) =>
        entity.kind === "file" && entity.name === "apps/web/src/index.ts",
    )!.id;
    const targetIds = new Set(
      report.snapshot.entities
        .filter(
          (entity) =>
            entity.kind === "file" &&
            entity.name.startsWith("packages/shared/src/"),
        )
        .map((entity) => entity.id),
    );
    const importRelationships = report.snapshot.relationships.filter(
      (relationship) =>
        relationship.type === "IMPORTS" &&
        relationship.sourceEntityId === importerId,
    );

    expect(importRelationships).toHaveLength(3);
    expect(
      importRelationships.every((relationship) =>
        targetIds.has(relationship.targetEntityId),
      ),
    ).toBe(true);
    expect(importRelationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetEntityId: report.snapshot.entities.find(
            (entity) =>
              entity.kind === "file" &&
              entity.name === "packages/shared/src/index.ts",
          )?.id,
        }),
        expect.objectContaining({
          targetEntityId: report.snapshot.entities.find(
            (entity) =>
              entity.kind === "file" &&
              entity.name === "packages/shared/src/math.ts",
          )?.id,
        }),
      ]),
    );
    expect(report.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "unresolved_local_import" }),
    );
    expect(report.canPersist).toBe(true);
    expect(validateGraphSnapshot(report.snapshot)).toEqual([]);
  });

  it("does not resolve workspace package exports outside their package directory", async () => {
    const root = await createTemporaryRepository();
    await mkdir(join(root, "packages", "safe", "src"), { recursive: true });
    await writeFile(
      join(root, "packages", "safe", "package.json"),
      JSON.stringify({
        name: "@fixture/safe",
        exports: { ".": "./../outside" },
      }),
    );
    await writeFile(
      join(root, "packages", "safe", "src", "entry.ts"),
      'import { value } from "@fixture/safe";\nexport { value };\n',
    );
    await writeFile(join(root, "outside.ts"), "export const value = 1;\n");

    const report = await analyzeRepository({
      repositoryId,
      repositoryRoot: root,
    });

    expect(report.snapshot.relationships).not.toContainEqual(
      expect.objectContaining({
        type: "IMPORTS",
        targetEntityId: report.snapshot.entities.find(
          (entity) => entity.kind === "file" && entity.name === "outside.ts",
        )?.id,
      }),
    );
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unresolved_local_import",
        path: "packages/safe/src/entry.ts",
      }),
    );
  });

  it("does not load TypeScript configs that extend outside the repository", async () => {
    const root = await createTemporaryRepository();
    const rootName = basename(root);
    const externalConfigPath = join(
      dirname(root),
      `${rootName}-external-tsconfig.json`,
    );
    const externalDirectory = join(dirname(root), `${rootName}-external`);
    await writeFile(
      externalConfigPath,
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@external/*": [`./${rootName}-external/*`] },
        },
      }),
    );
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({ extends: `../${rootName}-external-tsconfig.json` }),
    );
    await writeFile(
      join(root, "entry.ts"),
      'import { hidden } from "@external/hidden";\nexport { hidden };\n',
    );
    await mkdir(externalDirectory, { recursive: true });
    await writeFile(
      join(externalDirectory, "hidden.ts"),
      "export const hidden = true;\n",
    );

    try {
      const report = await analyzeRepository({
        repositoryId,
        repositoryRoot: root,
      });

      expect(report.diagnostics).toContainEqual(
        expect.objectContaining({ code: expect.stringMatching(/^tsconfig_/) }),
      );
      expect(
        report.snapshot.entities.some(
          (entity) =>
            entity.kind === "file" && entity.name.includes("external"),
        ),
      ).toBe(false);
    } finally {
      await rm(externalConfigPath, { force: true });
      await rm(externalDirectory, {
        recursive: true,
        force: true,
      });
    }
  });

  it("extracts nested declarations, local JSX, route patterns, and re-exports", async () => {
    const report = await analyzeRepository({
      repositoryId,
      repositoryRoot: semanticFixtureRoot,
    });

    const entities = report.snapshot.entities;
    const dashboard = entities.find(
      (entity) => entity.kind === "symbol" && entity.name === "Dashboard",
    )!;
    const pageTitle = entities.find(
      (entity) =>
        entity.kind === "symbol" && entity.name === "Dashboard.PageTitle",
    )!;
    const formatter = entities.find(
      (entity) =>
        entity.kind === "symbol" && entity.name === "Dashboard.formatHeading",
    )!;
    const renderedRelationship = report.snapshot.relationships.find(
      (relationship) =>
        relationship.type === "RENDERS" &&
        relationship.sourceEntityId === dashboard.id &&
        relationship.targetEntityId === pageTitle.id,
    )!;
    const renderEvidence = report.snapshot.evidence.find((item) =>
      renderedRelationship.evidenceIds.includes(item.id),
    )!;

    expect(entities).toContainEqual(
      expect.objectContaining({ id: formatter.id, kind: "symbol" }),
    );
    expect(report.snapshot.relationships).toContainEqual(
      expect.objectContaining({
        type: "CONTAINS",
        sourceEntityId: dashboard.id,
        targetEntityId: pageTitle.id,
      }),
    );
    expect(renderEvidence.source).toMatchObject({
      repositoryRelativePath: "src/components/Dashboard.tsx",
      range: { start: { line: 10, column: 10 } },
    });

    const getRoute = entities.find(
      (entity) => entity.kind === "symbol" && entity.name === "GET /users",
    )!;
    const postRoute = entities.find(
      (entity) => entity.kind === "symbol" && entity.name === "POST /users",
    )!;
    const listUsers = entities.find(
      (entity) => entity.kind === "symbol" && entity.name === "listUsers",
    )!;
    expect(report.snapshot.relationships).toContainEqual(
      expect.objectContaining({
        type: "ROUTES_TO",
        sourceEntityId: getRoute.id,
        targetEntityId: listUsers.id,
      }),
    );
    expect(
      report.snapshot.relationships.some(
        (relationship) =>
          relationship.type === "ROUTES_TO" &&
          relationship.sourceEntityId === postRoute.id,
      ),
    ).toBe(true);

    const barrel = entities.find(
      (entity) => entity.kind === "file" && entity.name === "src/barrel.ts",
    )!;
    const dashboardFile = entities.find(
      (entity) =>
        entity.kind === "file" &&
        entity.name === "src/components/Dashboard.tsx",
    )!;
    expect(report.snapshot.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "REEXPORTS",
          sourceEntityId: barrel.id,
          targetEntityId: dashboardFile.id,
        }),
        expect.objectContaining({
          type: "IMPORTS",
          sourceEntityId: barrel.id,
          targetEntityId: dashboardFile.id,
        }),
      ]),
    );
    expect(report.canPersist).toBe(true);
    expect(validateGraphSnapshot(report.snapshot)).toEqual([]);
  });

  it("preserves file and symbol identity when an unchanged file moves", async () => {
    const root = await createTemporaryRepository();
    await mkdir(join(root, "old"), { recursive: true });
    await mkdir(join(root, "new"), { recursive: true });
    const oldPath = join(root, "old", "math.ts");
    const newPath = join(root, "new", "math.ts");
    const entryPath = join(root, "entry.ts");
    await writeFile(
      oldPath,
      "export function add(left: number, right: number) { return left + right; }\n",
    );
    await writeFile(
      entryPath,
      'import { add } from "./old/math";\nexport const total = add(1, 2);\n',
    );

    const first = await analyzeRepository({
      repositoryId,
      repositoryRoot: root,
      revision: "before-move",
    });
    await rename(oldPath, newPath);
    await writeFile(
      entryPath,
      'import { add } from "./new/math";\nexport const total = add(1, 2);\n',
    );
    const second = await analyzeRepository({
      repositoryId,
      repositoryRoot: root,
      revision: "after-move",
      previousSnapshot: first.snapshot,
    });

    const previousFile = first.snapshot.entities.find(
      (entity) => entity.kind === "file" && entity.name === "old/math.ts",
    )!;
    const movedFile = second.snapshot.entities.find(
      (entity) => entity.kind === "file" && entity.name === "new/math.ts",
    )!;
    const previousSymbol = first.snapshot.entities.find(
      (entity) => entity.kind === "symbol" && entity.name === "add",
    )!;
    const movedSymbol = second.snapshot.entities.find(
      (entity) => entity.kind === "symbol" && entity.name === "add",
    )!;

    expect(movedFile.id).toBe(previousFile.id);
    expect(movedSymbol.id).toBe(previousSymbol.id);
    expect(movedSymbol.source?.revision).toBe("after-move");
    expect(
      second.snapshot.relationships.find(
        (relationship) => relationship.type === "IMPORTS",
      )?.id,
    ).toBe(
      first.snapshot.relationships.find(
        (relationship) => relationship.type === "IMPORTS",
      )?.id,
    );
  });

  it("does not reuse identity for ambiguous duplicate declarations", async () => {
    const root = await createTemporaryRepository();
    const sourcePath = join(root, "symbols.ts");
    await writeFile(sourcePath, "export function run() { return 1; }\n");
    const first = await analyzeRepository({
      repositoryId,
      repositoryRoot: root,
    });
    await writeFile(
      sourcePath,
      "export function run() { return 1; }\nexport function run() { return 1; }\n",
    );

    const second = await analyzeRepository({
      repositoryId,
      repositoryRoot: root,
      previousSnapshot: first.snapshot,
    });

    const oldSymbolId = first.snapshot.entities.find(
      (entity) => entity.kind === "symbol",
    )!.id;
    expect(
      second.snapshot.entities
        .filter((entity) => entity.kind === "symbol")
        .some((entity) => entity.id === oldSymbolId),
    ).toBe(false);
    expect(second.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "ambiguous_symbol_identity",
        path: "symbols.ts",
      }),
    );
    const third = await analyzeRepository({
      repositoryId,
      repositoryRoot: root,
      previousSnapshot: second.snapshot,
    });
    expect(
      third.snapshot.entities
        .filter((entity) => entity.kind === "symbol")
        .map((entity) => entity.id),
    ).toEqual(
      second.snapshot.entities
        .filter((entity) => entity.kind === "symbol")
        .map((entity) => entity.id),
    );
  });
});
