export type EntityKind =
  "repository" | "project" | "package" | "component" | "file" | "symbol";

export type ArchitectureState = "actual" | "intended";

export type EvidenceOrigin =
  | "source-analysis"
  | "compiler"
  | "test"
  | "runtime"
  | "developer"
  | "imported"
  | "ai-inference";

export interface SourcePosition {
  line: number;
  column: number;
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

export interface SourceLocator {
  repositoryId: string;
  repositoryRelativePath: string;
  revision: string | null;
  range: SourceRange;
}

export interface Evidence {
  id: string;
  origin: EvidenceOrigin;
  description: string;
  source?: SourceLocator;
}

export interface GraphEntity {
  id: string;
  kind: EntityKind;
  name: string;
  state: ArchitectureState;
  evidenceIds: string[];
  source?: SourceLocator;
}

export interface GraphRelationship {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  type: string;
  state: ArchitectureState;
  evidenceIds: string[];
}

export interface GitContext {
  commit: string | null;
  branch: string | null;
  workingTree:
    "clean" | "dirty" | "not-a-repository" | "unavailable" | "unknown";
}

export interface GraphSnapshot {
  schemaVersion: 1;
  repositoryId: string;
  revision: string | null;
  gitContext?: GitContext;
  entities: GraphEntity[];
  evidence: Evidence[];
  relationships: GraphRelationship[];
}

export {
  evaluateArchitectureRules,
  type ArchitectureRuleEvaluation,
  maxFindingSourceLocations,
  type ArchitectureRuleFinding,
} from "./architecture-rules.js";

export interface GraphInvariantIssue {
  code: string;
  path: string;
  message: string;
}

export function validateGraphSnapshot(
  snapshot: GraphSnapshot,
): GraphInvariantIssue[] {
  const issues: GraphInvariantIssue[] = [];
  const entityById = new Map<string, GraphEntity>();
  const evidenceIds = new Set<string>();
  const allIds = new Set<string>();
  const entityKinds: EntityKind[] = [
    "repository",
    "project",
    "package",
    "component",
    "file",
    "symbol",
  ];
  const states: ArchitectureState[] = ["actual", "intended"];
  const evidenceOrigins: EvidenceOrigin[] = [
    "source-analysis",
    "compiler",
    "test",
    "runtime",
    "developer",
    "imported",
    "ai-inference",
  ];

  const addId = (id: string, path: string): void => {
    if (!isValidUuid(id)) {
      issues.push({
        code: "invalid-id",
        path,
        message: "Graph identifiers must be UUIDs.",
      });
    }

    if (allIds.has(id)) {
      issues.push({
        code: "duplicate-id",
        path,
        message: `Identifier ${id} is used more than once in this graph.`,
      });
    }

    allIds.add(id);
  };

  if (!isValidUuid(snapshot.repositoryId)) {
    issues.push({
      code: "invalid-repository-id",
      path: "repositoryId",
      message: "Repository identifier must be a UUID.",
    });
  }
  if (snapshot.schemaVersion !== 1) {
    issues.push({
      code: "invalid-snapshot-metadata",
      path: "schemaVersion",
      message: "Graph snapshot metadata is invalid.",
    });
  }
  if (snapshot.revision !== null && snapshot.revision.length === 0) {
    issues.push({
      code: "invalid-snapshot-revision",
      path: "revision",
      message: "Snapshot revision must be non-empty or null.",
    });
  }
  if (
    snapshot.gitContext !== undefined &&
    !isValidGitContext(snapshot.gitContext)
  ) {
    issues.push({
      code: "invalid-git-context",
      path: "gitContext",
      message: "Git commit, branch, and working-tree context must be valid.",
    });
  }

  snapshot.evidence.forEach((item, index) => {
    addId(item.id, `evidence[${index}].id`);
    evidenceIds.add(item.id);
    if (
      !evidenceOrigins.includes(item.origin) ||
      item.description.length === 0
    ) {
      issues.push({
        code: "invalid-evidence",
        path: `evidence[${index}]`,
        message: "Evidence origin and description must be valid.",
      });
    }
  });

  snapshot.entities.forEach((entity, index) => {
    addId(entity.id, `entities[${index}].id`);
    entityById.set(entity.id, entity);
    if (
      !entityKinds.includes(entity.kind) ||
      !states.includes(entity.state) ||
      entity.name.length === 0
    ) {
      issues.push({
        code: "invalid-entity",
        path: `entities[${index}]`,
        message: "Entity kind, state, and name must be valid.",
      });
    }

    if (entity.evidenceIds.length === 0) {
      issues.push({
        code: "missing-evidence",
        path: `entities[${index}].evidenceIds`,
        message:
          "Every graph entity must reference at least one evidence item.",
      });
    }

    checkEvidenceReferences(
      entity.evidenceIds,
      evidenceIds,
      `entities[${index}].evidenceIds`,
      issues,
    );

    if (entity.source) {
      checkSourceLocator(
        entity.source,
        snapshot.repositoryId,
        `entities[${index}].source`,
        issues,
      );
    }
  });

  snapshot.evidence.forEach((item, index) => {
    if (item.source) {
      checkSourceLocator(
        item.source,
        snapshot.repositoryId,
        `evidence[${index}].source`,
        issues,
      );
    }
  });

  snapshot.relationships.forEach((relationship, index) => {
    addId(relationship.id, `relationships[${index}].id`);
    if (
      !states.includes(relationship.state) ||
      relationship.type.length === 0
    ) {
      issues.push({
        code: "invalid-relationship",
        path: `relationships[${index}]`,
        message: "Relationship type and state must be valid.",
      });
    }

    if (relationship.evidenceIds.length === 0) {
      issues.push({
        code: "missing-evidence",
        path: `relationships[${index}].evidenceIds`,
        message:
          "Every graph relationship must reference at least one evidence item.",
      });
    }

    checkEvidenceReferences(
      relationship.evidenceIds,
      evidenceIds,
      `relationships[${index}].evidenceIds`,
      issues,
    );

    for (const [field, entityId] of [
      ["sourceEntityId", relationship.sourceEntityId],
      ["targetEntityId", relationship.targetEntityId],
    ] as const) {
      const entity = entityById.get(entityId);
      const intendedMappingEndpoint =
        relationship.type === "MAPS_TO" &&
        relationship.state === "intended" &&
        ((field === "sourceEntityId" && entity?.state === "intended") ||
          (field === "targetEntityId" && entity?.state === "actual"));
      if (!entity) {
        issues.push({
          code: "missing-relationship-endpoint",
          path: `relationships[${index}].${field}`,
          message: `Relationship references missing entity ${entityId}.`,
        });
      } else if (
        entity.state !== relationship.state &&
        !intendedMappingEndpoint
      ) {
        issues.push({
          code: "state-mismatch",
          path: `relationships[${index}].${field}`,
          message:
            "Relationships must match endpoint states unless an intended MAPS_TO edge links intent to actual code.",
        });
      }
    }
  });

  return issues;
}

function checkSourceLocator(
  locator: SourceLocator,
  repositoryId: string,
  path: string,
  issues: GraphInvariantIssue[],
): void {
  if (!isValidUuid(locator.repositoryId)) {
    issues.push({
      code: "invalid-source-repository-id",
      path: `${path}.repositoryId`,
      message: "Source repository identifier must be a UUID.",
    });
  }

  if (locator.repositoryId !== repositoryId) {
    issues.push({
      code: "repository-mismatch",
      path: `${path}.repositoryId`,
      message: "Source location belongs to a different repository.",
    });
  }

  const pathParts = locator.repositoryRelativePath.split("/");
  if (
    locator.repositoryRelativePath.length === 0 ||
    locator.repositoryRelativePath.startsWith("/") ||
    locator.repositoryRelativePath.includes("\\") ||
    /^[a-z]:/i.test(locator.repositoryRelativePath) ||
    pathParts.some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    issues.push({
      code: "invalid-source-path",
      path: `${path}.repositoryRelativePath`,
      message:
        "Source location must use a normalized repository-relative path.",
    });
  }

  if (locator.revision !== null && locator.revision.length === 0) {
    issues.push({
      code: "invalid-source-revision",
      path: `${path}.revision`,
      message: "Source revision must be non-empty or null.",
    });
  }

  const { start, end } = locator.range;
  if (
    !Number.isInteger(start.line) ||
    start.line < 1 ||
    !Number.isInteger(start.column) ||
    start.column < 0 ||
    !Number.isInteger(end.line) ||
    end.line < 1 ||
    !Number.isInteger(end.column) ||
    end.column < 0 ||
    end.line < start.line ||
    (end.line === start.line && end.column < start.column)
  ) {
    issues.push({
      code: "invalid-source-range",
      path: `${path}.range`,
      message: "Source range must contain valid positions in ascending order.",
    });
  }
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isValidGitContext(value: unknown): value is GitContext {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const context = value as Record<string, unknown>;
  const validCommit =
    context.commit === null ||
    (typeof context.commit === "string" &&
      /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(context.commit));
  const validBranch =
    context.branch === null ||
    (typeof context.branch === "string" &&
      context.branch.length > 0 &&
      context.branch.length <= 256);
  const validWorkingTree = [
    "clean",
    "dirty",
    "not-a-repository",
    "unavailable",
    "unknown",
  ].includes(String(context.workingTree));

  return validCommit && validBranch && validWorkingTree;
}

function checkEvidenceReferences(
  references: string[],
  evidenceIds: Set<string>,
  path: string,
  issues: GraphInvariantIssue[],
): void {
  if (new Set(references).size !== references.length) {
    issues.push({
      code: "duplicate-evidence-reference",
      path,
      message: "Evidence references must be unique.",
    });
  }

  references.forEach((id, index) => {
    if (!evidenceIds.has(id)) {
      issues.push({
        code: "missing-evidence-reference",
        path: `${path}[${index}]`,
        message: `Referenced evidence ${id} does not exist in this graph.`,
      });
    }
  });
}
