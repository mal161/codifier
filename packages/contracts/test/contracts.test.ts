import { describe, expect, it } from "vitest";
import {
  architectureRuleEvaluationSchema,
  architectureTemplateCatalogSchema,
  analysisJobResultSchema,
  analysisJobSchema,
  analysisReconciliationSchema,
  gitContextSchema,
  sourceLocatorSchema,
} from "../src/index.js";

describe("architectureTemplateCatalogSchema", () => {
  const validTemplate = {
    id: "layered-backend",
    title: "Layered backend",
    description: "A layered backend architecture.",
    category: "Backend",
    tags: ["services"],
    version: "1.0.0",
    publisher: "Bundled with Codifier",
    components: [
      {
        id: "domain",
        name: "Domain",
        description: "Business rules and the core domain model.",
      },
    ],
    installed: false,
  };

  it("accepts a bounded, typed local architecture template", () => {
    expect(architectureTemplateCatalogSchema.parse([validTemplate])).toEqual([
      validTemplate,
    ]);
  });

  it("rejects malformed or executable catalog fields", () => {
    expect(() =>
      architectureTemplateCatalogSchema.parse([
        { ...validTemplate, id: "../unsafe" },
      ]),
    ).toThrow();
    expect(() =>
      architectureTemplateCatalogSchema.parse([
        { ...validTemplate, installScript: "run arbitrary code" },
      ]),
    ).toThrow();
  });
});

describe("architectureRuleEvaluationSchema", () => {
  const validEvaluation = {
    repositoryId: "7b9442d6-faaa-49f9-a39e-7de8a276a978",
    revision: "a1b2c3d",
    ruleSetVersion: "1.1.0",
    findings: [
      {
        ruleId: "dependency-cycle",
        title: "Observed dependency cycle",
        severity: "warning",
        message: "Observed dependencies form a cycle.",
        entityIds: ["9ac38590-a7ac-4101-bfc9-dc323d1c9301"],
        relationshipIds: ["9e94e1f3-8a77-4de6-9957-562e07163ddd"],
        evidenceIds: ["05a4d48e-1e17-4ca7-9e03-773ea13d3561"],
      },
    ],
  };

  it("accepts versioned findings with graph and evidence references", () => {
    expect(architectureRuleEvaluationSchema.parse(validEvaluation)).toEqual(
      validEvaluation,
    );
  });

  it("rejects findings with invalid severities or malformed graph references", () => {
    expect(() =>
      architectureRuleEvaluationSchema.parse({
        ...validEvaluation,
        findings: [{ ...validEvaluation.findings[0], severity: "critical" }],
      }),
    ).toThrow();
    expect(() =>
      architectureRuleEvaluationSchema.parse({
        ...validEvaluation,
        findings: [
          {
            ...validEvaluation.findings[0],
            entityIds: ["not-a-uuid"],
          },
        ],
      }),
    ).toThrow();
  });
});

const validLocator = {
  repositoryId: "7b9442d6-faaa-49f9-a39e-7de8a276a978",
  repositoryRelativePath: "src/graph.ts",
  revision: "a1b2c3d",
  range: {
    start: { line: 4, column: 0 },
    end: { line: 8, column: 1 },
  },
};

describe("sourceLocatorSchema", () => {
  it("accepts a normalized repository-relative source location", () => {
    expect(sourceLocatorSchema.parse(validLocator)).toEqual(validLocator);
  });
});

describe("gitContextSchema", () => {
  it("accepts SHA-1 and SHA-256 commits and explicit working-tree states", () => {
    expect(
      gitContextSchema.parse({
        commit: "a".repeat(40),
        branch: "main",
        workingTree: "dirty",
      }),
    ).toEqual({
      commit: "a".repeat(40),
      branch: "main",
      workingTree: "dirty",
    });
    expect(
      gitContextSchema.parse({
        commit: "b".repeat(64),
        branch: null,
        workingTree: "clean",
      }),
    ).toMatchObject({ commit: "b".repeat(64), branch: null });
  });

  it("rejects malformed commit IDs and unsupported working-tree states", () => {
    expect(() =>
      gitContextSchema.parse({
        commit: "not-a-commit",
        branch: null,
        workingTree: "clean",
      }),
    ).toThrow();
    expect(() =>
      gitContextSchema.parse({
        commit: null,
        branch: null,
        workingTree: "maybe",
      }),
    ).toThrow();
  });
});

describe("analysisJobResultSchema", () => {
  const validResult = {
    coverage: {
      filesDiscovered: 2,
      supportedFiles: 2,
      analyzedFiles: 2,
      unsupportedFiles: 0,
      skippedFiles: 0,
      failedFiles: 0,
      excludedDirectories: 0,
      truncated: false,
    },
    diagnostics: [],
    diagnosticsTruncated: false,
    persisted: true,
    changeSummary: {
      initialAnalysis: false,
      entities: { added: 1, changed: 2, removed: 0 },
      relationships: { added: 0, changed: 1, removed: 1 },
    },
  };

  it("accepts a persisted graph change summary", () => {
    expect(analysisJobResultSchema.parse(validResult)).toEqual(validResult);
  });

  it("rejects negative change counts and summaries for unpersisted results", () => {
    expect(() =>
      analysisJobResultSchema.parse({
        ...validResult,
        changeSummary: {
          ...validResult.changeSummary,
          entities: { ...validResult.changeSummary.entities, added: -1 },
        },
      }),
    ).toThrow();
    expect(() =>
      analysisJobResultSchema.parse({ ...validResult, persisted: false }),
    ).toThrow();
  });

  it("accepts persistence blockers only for unpersisted results", () => {
    const blocked = {
      coverage: { ...validResult.coverage, skippedFiles: 1 },
      diagnostics: [],
      diagnosticsTruncated: false,
      persisted: false,
      persistBlockers: [
        {
          reason: "skipped_files",
          count: 1,
          message: "1 file was skipped because of size limits, read errors, or unsafe paths.",
          examples: [{ path: "debug.log", code: "file_too_large" }],
        },
      ],
    };

    expect(analysisJobResultSchema.parse(blocked)).toEqual(blocked);
    expect(() =>
      analysisJobResultSchema.parse({ ...blocked, persisted: true }),
    ).toThrow();
    expect(() =>
      analysisJobResultSchema.parse({
        ...blocked,
        persistBlockers: [{ ...blocked.persistBlockers[0], reason: "unknown" }],
      }),
    ).toThrow();
  });
});

describe("analysisJobSchema", () => {
  const validJob = {
    id: "c4f1cb1e-74ba-4de6-b0ac-1838cc5a1124",
    repositoryId: "7b9442d6-faaa-49f9-a39e-7de8a276a978",
    status: "running",
    progress: {
      phase: "reading",
      currentFile: "src/graph.ts",
      completedFiles: 2,
      totalFiles: 5,
    },
  };

  it("accepts a job with validated progress", () => {
    expect(analysisJobSchema.parse(validJob)).toEqual(validJob);
  });

  it("rejects unsafe progress paths and inconsistent counts", () => {
    expect(() =>
      analysisJobSchema.parse({
        ...validJob,
        progress: { ...validJob.progress, currentFile: "../outside.ts" },
      }),
    ).toThrow();
    expect(() =>
      analysisJobSchema.parse({
        ...validJob,
        progress: { ...validJob.progress, completedFiles: -1 },
      }),
    ).toThrow();
  });
});

describe("sourceLocatorSchema invalid input", () => {
  it.each([
    "../outside.ts",
    "src/../outside.ts",
    "C:\\repo\\file.ts",
    "/etc/passwd",
  ])("rejects unsafe path %s", (repositoryRelativePath) => {
    expect(() =>
      sourceLocatorSchema.parse({ ...validLocator, repositoryRelativePath }),
    ).toThrow();
  });

  it("rejects a range whose end precedes its start", () => {
    expect(() =>
      sourceLocatorSchema.parse({
        ...validLocator,
        range: {
          start: { line: 8, column: 0 },
          end: { line: 7, column: 9 },
        },
      }),
    ).toThrow();
  });
});

describe("analysisReconciliationSchema", () => {
  const reconciliation = {
    mode: "full-fallback",
    addedFiles: [],
    changedFiles: ["src/a.ts"],
    removedFiles: [],
    renamedFiles: [],
    reason: "Changed files were re-parsed.",
  };

  it("accepts reports with and without parse reuse counts", () => {
    expect(analysisReconciliationSchema.parse(reconciliation)).toEqual(
      reconciliation,
    );
    expect(
      analysisReconciliationSchema.parse({
        ...reconciliation,
        parseReuse: { reusedFiles: 4, parsedFiles: 1 },
      }).parseReuse,
    ).toEqual({ reusedFiles: 4, parsedFiles: 1 });
  });

  it("rejects negative or unexpected parse reuse fields", () => {
    expect(() =>
      analysisReconciliationSchema.parse({
        ...reconciliation,
        parseReuse: { reusedFiles: -1, parsedFiles: 1 },
      }),
    ).toThrow();
    expect(() =>
      analysisReconciliationSchema.parse({
        ...reconciliation,
        parseReuse: { reusedFiles: 1, parsedFiles: 1, cachedBytes: 9 },
      }),
    ).toThrow();
  });
});
