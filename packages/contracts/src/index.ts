import {
  validateGraphSnapshot,
  type Evidence,
  type GraphEntity,
  type GraphRelationship,
  type GraphSnapshot,
  type GitContext,
  type SourceLocator,
  type ArchitectureRuleEvaluation,
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

export const gitContextSchema: z.ZodType<GitContext> = z
  .object({
    commit: z
      .string()
      .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i)
      .nullable(),
    branch: z.string().min(1).max(256).nullable(),
    workingTree: z.enum([
      "clean",
      "dirty",
      "not-a-repository",
      "unavailable",
      "unknown",
    ]),
  })
  .strict();

export const graphSnapshotSchema: z.ZodType<GraphSnapshot> = z
  .object({
    schemaVersion: z.literal(1),
    repositoryId: uuidSchema,
    revision: z.string().min(1).nullable(),
    gitContext: gitContextSchema.optional(),
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
    excludePatterns: z.array(z.string().min(1).max(256)).max(256).optional(),
    respectGitignore: z.boolean().optional(),
  })
  .strict();

export const intendedComponentRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
  })
  .strict();

export const intendedComponentMappingRequestSchema = z
  .object({
    entityId: uuidSchema,
  })
  .strict();

export const sourceFreshnessRequestSchema = z
  .object({
    rootPath: z.string().min(1).max(4_096),
    entityId: uuidSchema,
  })
  .strict();

export const sourceFreshnessResultSchema = z
  .object({
    status: z.enum(["current", "stale", "unresolved"]),
    message: z.string().min(1),
  })
  .strict();

export const architectureTemplateComponentSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(500),
  })
  .strict();

export const architectureTemplateSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(1000),
    category: z.string().min(1).max(80),
    tags: z.array(z.string().min(1).max(40)).max(12),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    publisher: z.string().min(1).max(80),
    components: z.array(architectureTemplateComponentSchema).min(1).max(30),
    installed: z.boolean(),
  })
  .strict();

export const architectureTemplateCatalogSchema = z.array(
  architectureTemplateSchema,
);

export const installArchitectureTemplateRequestSchema = z
  .object({
    templateId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();

export const architectureRuleFindingSchema = z
  .object({
    ruleId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().min(1).max(120),
    severity: z.enum(["info", "warning"]),
    message: z.string().min(1).max(2_000),
    entityIds: z.array(uuidSchema).max(10_000),
    relationshipIds: z.array(uuidSchema).max(50_000),
    evidenceIds: z.array(uuidSchema).max(50_000),
    sourceLocations: z.array(sourceLocatorSchema).max(10),
    sourceLocationCount: z.number().int().nonnegative(),
  })
  .strict();

export const architectureRuleEvaluationSchema: z.ZodType<ArchitectureRuleEvaluation> =
  z
    .object({
      repositoryId: uuidSchema,
      revision: z.string().min(1).nullable(),
      ruleSetVersion: z.literal("1.2.0"),
      findings: z.array(architectureRuleFindingSchema),
    })
    .strict();

const findingKeySchema = z.string().regex(/^[0-9a-f]{64}$/);
const reviewerNameSchema = z.string().trim().min(1).max(120);
const reviewTextSchema = z.string().trim().min(1).max(2_000);

/** Body for recording a developer-authored exception to one current finding. */
export const ruleExceptionCreateRequestSchema = z
  .object({
    findingKey: findingKeySchema,
    author: reviewerNameSchema,
    rationale: reviewTextSchema,
    expiresAt: z.number().int().positive().nullable().optional(),
  })
  .strict();

export const ruleExceptionRevokeRequestSchema = z
  .object({
    revokedBy: reviewerNameSchema,
    reason: reviewTextSchema,
  })
  .strict();

export const ruleExceptionSchema = z
  .object({
    id: uuidSchema,
    repositoryId: uuidSchema,
    findingKey: findingKeySchema,
    ruleId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    entityIds: z.array(uuidSchema),
    rationale: z.string().min(1),
    author: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive().nullable(),
    revokedAt: z.number().int().nonnegative().nullable(),
    revokedBy: z.string().min(1).nullable(),
    revokeReason: z.string().min(1).nullable(),
    status: z.enum(["active", "expired", "revoked"]),
    /** False when the finding no longer appears for the saved graph. */
    matchesCurrentFinding: z.boolean(),
  })
  .strict();

export const ruleExceptionListSchema = z
  .object({ exceptions: z.array(ruleExceptionSchema) })
  .strict();

const findingExceptionSchema = z
  .object({
    id: uuidSchema,
    status: z.enum(["active", "expired"]),
    author: z.string().min(1),
    rationale: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive().nullable(),
  })
  .strict();

/** Rule evaluation as served by the agent: findings carry review state. */
export const reviewedArchitectureRuleEvaluationSchema = z
  .object({
    repositoryId: uuidSchema,
    revision: z.string().min(1).nullable(),
    ruleSetVersion: z.literal("1.2.0"),
    findings: z.array(
      architectureRuleFindingSchema
        .extend({
          findingKey: findingKeySchema,
          exception: findingExceptionSchema.nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export type RuleException = z.infer<typeof ruleExceptionSchema>;
export type ReviewedArchitectureRuleEvaluation = z.infer<
  typeof reviewedArchitectureRuleEvaluationSchema
>;
export type ReviewedArchitectureRuleFinding =
  ReviewedArchitectureRuleEvaluation["findings"][number];

export type ArchitectureTemplate = z.infer<typeof architectureTemplateSchema>;
export type ArchitectureRuleFinding = z.infer<
  typeof architectureRuleFindingSchema
>;
export type { ArchitectureRuleEvaluation };

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

export const analysisReconciliationSchema = z
  .object({
    mode: z.enum(["initial", "unchanged", "full-fallback"]),
    addedFiles: z.array(repositoryRelativePathSchema),
    changedFiles: z.array(repositoryRelativePathSchema),
    removedFiles: z.array(repositoryRelativePathSchema),
    renamedFiles: z.array(
      z.object({ from: repositoryRelativePathSchema, to: repositoryRelativePathSchema }).strict(),
    ),
    reason: z.string().min(1),
    parseReuse: z
      .object({
        reusedFiles: z.number().int().nonnegative(),
        parsedFiles: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const persistBlockerSchema = z
  .object({
    reason: z.enum([
      "no_analyzed_files",
      "failed_files",
      "skipped_files",
      "truncated",
    ]),
    count: z.number().int().nonnegative(),
    message: z.string().min(1),
    examples: z
      .array(
        z
          .object({
            path: repositoryRelativePathSchema.optional(),
            code: z.string().min(1),
          })
          .strict(),
      )
      .max(10),
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
    // Optional so job records written by earlier agents remain readable.
    persistBlockers: z.array(persistBlockerSchema).optional(),
    reconciliation: analysisReconciliationSchema.optional(),
    changeSummary: analysisChangeSummarySchema.optional(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.persisted && (result.persistBlockers?.length ?? 0) > 0) {
      context.addIssue({
        code: "custom",
        path: ["persistBlockers"],
        message: "A persisted analysis cannot report persistence blockers.",
      });
    }
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
export type PersistBlocker = z.infer<typeof persistBlockerSchema>;
export type AnalysisJobResult = z.infer<typeof analysisJobResultSchema>;
export type AnalysisJob = z.infer<typeof analysisJobSchema>;
