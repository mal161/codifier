import {
  validateGraphSnapshot,
  type Evidence,
  type GraphEntity,
  type GraphRelationship,
  type GraphSnapshot,
  type SourceLocator,
} from "@codifier/domain";
import { z } from "zod";

const uuidSchema = z.string().uuid();

const sourcePositionSchema = z
  .object({
    line: z.number().int().positive(),
    column: z.number().int().nonnegative(),
  })
  .strict();

const sourceRangeSchema = z
  .object({
    start: sourcePositionSchema,
    end: sourcePositionSchema,
  })
  .strict()
  .refine(
    ({ start, end }) =>
      end.line > start.line ||
      (end.line === start.line && end.column >= start.column),
    "The end position must not precede the start position",
  );

const repositoryRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      path
        .split("/")
        .every((part) => part.length > 0 && part !== "." && part !== ".."),
    "Expected a normalized repository-relative path",
  );

export const sourceLocatorSchema: z.ZodType<SourceLocator> = z
  .object({
    repositoryId: uuidSchema,
    repositoryRelativePath: repositoryRelativePathSchema,
    revision: z.string().min(1).nullable(),
    range: sourceRangeSchema,
  })
  .strict();

export const evidenceSchema: z.ZodType<Evidence> = z
  .object({
    id: uuidSchema,
    origin: z.enum([
      "source-analysis",
      "compiler",
      "test",
      "runtime",
      "developer",
      "imported",
      "ai-inference",
    ]),
    description: z.string().min(1),
    source: sourceLocatorSchema.optional(),
  })
  .strict();

export const graphEntitySchema: z.ZodType<GraphEntity> = z
  .object({
    id: uuidSchema,
    kind: z.enum([
      "repository",
      "project",
      "package",
      "component",
      "file",
      "symbol",
    ]),
    name: z.string().min(1),
    state: z.enum(["actual", "intended"]),
    evidenceIds: z.array(uuidSchema),
    source: sourceLocatorSchema.optional(),
  })
  .strict();

export const graphRelationshipSchema: z.ZodType<GraphRelationship> = z
  .object({
    id: uuidSchema,
    sourceEntityId: uuidSchema,
    targetEntityId: uuidSchema,
    type: z.string().min(1),
    state: z.enum(["actual", "intended"]),
    evidenceIds: z.array(uuidSchema),
  })
  .strict();

export const graphSnapshotSchema: z.ZodType<GraphSnapshot> = z
  .object({
    schemaVersion: z.literal(1),
    repositoryId: uuidSchema,
    revision: z.string().min(1).nullable(),
    entities: z.array(graphEntitySchema),
    evidence: z.array(evidenceSchema),
    relationships: z.array(graphRelationshipSchema),
  })
  .strict()
  .superRefine((snapshot, context) => {
    for (const issue of validateGraphSnapshot(snapshot)) {
      context.addIssue({
        code: "custom",
        path: issue.path.split(/\.|\[|\]/).filter(Boolean),
        message: `${issue.code}: ${issue.message}`,
      });
    }
  });

export const analyzeRepositoryRequestSchema = z
  .object({
    rootPath: z.string().min(1).max(4_096),
    revision: z.string().min(1).nullable().optional(),
  })
  .strict();

export const analysisJobPhaseSchema = z.enum([
  "inventory",
  "reading",
  "parsing",
  "resolving",
  "persisting",
  "complete",
  "cancelled",
  "failed",
]);

export const analysisProgressSchema = z
  .object({
    phase: analysisJobPhaseSchema,
    currentFile: repositoryRelativePathSchema.nullable(),
    completedFiles: z.number().int().nonnegative(),
    totalFiles: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const analysisDiagnosticSchema = z
  .object({
    code: z.string().min(1),
    severity: z.enum(["warning", "error"]),
    message: z.string().min(1),
    path: repositoryRelativePathSchema.optional(),
    range: sourceRangeSchema.optional(),
  })
  .strict();

const analysisChangeCountsSchema = z
  .object({
    added: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
  })
  .strict();

export const analysisChangeSummarySchema = z
  .object({
    initialAnalysis: z.boolean(),
    entities: analysisChangeCountsSchema,
    relationships: analysisChangeCountsSchema,
  })
  .strict();

export const analysisJobResultSchema = z
  .object({
    coverage: z
      .object({
        filesDiscovered: z.number().int().nonnegative(),
        supportedFiles: z.number().int().nonnegative(),
        analyzedFiles: z.number().int().nonnegative(),
        unsupportedFiles: z.number().int().nonnegative(),
        skippedFiles: z.number().int().nonnegative(),
        failedFiles: z.number().int().nonnegative(),
        excludedDirectories: z.number().int().nonnegative(),
        truncated: z.boolean(),
      })
      .strict(),
    diagnostics: z.array(analysisDiagnosticSchema),
    diagnosticsTruncated: z.boolean(),
    persisted: z.boolean(),
    changeSummary: analysisChangeSummarySchema.optional(),
  })
  .strict()
  .superRefine((result, context) => {
    if (!result.persisted && result.changeSummary) {
      context.addIssue({
        code: "custom",
        path: ["changeSummary"],
        message: "An unpersisted analysis cannot include graph changes.",
      });
    }
  });

export const analysisJobSchema = z
  .object({
    id: uuidSchema,
    repositoryId: uuidSchema,
    status: z.enum([
      "queued",
      "running",
      "cancelling",
      "cancelled",
      "completed",
      "failed",
    ]),
    progress: analysisProgressSchema,
    result: analysisJobResultSchema.optional(),
    error: z.string().min(1).optional(),
  })
  .strict();

export type AnalysisJobPhase = z.infer<typeof analysisJobPhaseSchema>;
export type AnalysisProgress = z.infer<typeof analysisProgressSchema>;
export type AnalysisChangeSummary = z.infer<typeof analysisChangeSummarySchema>;
export type AnalysisJobResult = z.infer<typeof analysisJobResultSchema>;
export type AnalysisJob = z.infer<typeof analysisJobSchema>;
