import { describe, expect, it } from "vitest";
import {
  analysisJobResultSchema,
  analysisJobSchema,
  sourceLocatorSchema,
} from "../src/index.js";

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
