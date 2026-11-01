import type {
  GraphEntity,
  GraphRelationship,
  GraphSnapshot,
  SourceLocator,
} from "./index.js";

export interface ArchitectureRuleFinding {
  ruleId: string;
  title: string;
  severity: "info" | "warning";
  message: string;
  entityIds: string[];
  relationshipIds: string[];
  evidenceIds: string[];
  /**
   * Source ranges that justify the finding, most specific first: evidence of
   * observed relationships (for example an import statement), then observed
   * entities. Capped at {@link maxFindingSourceLocations}. Empty when the
   * finding concerns intended architecture only.
   */
  sourceLocations: SourceLocator[];
  /** Distinct source locations before the cap was applied. */
  sourceLocationCount: number;
}

export interface ArchitectureRuleEvaluation {
  repositoryId: string;
  revision: string | null;
  ruleSetVersion: "1.2.0";
  findings: ArchitectureRuleFinding[];
}

export const maxFindingSourceLocations = 10;

const dependencyRelationshipTypes = new Set([
  "DEPENDS_ON",
  "IMPORTS",
  "REEXPORTS",
]);

type DraftFinding = Omit<
  ArchitectureRuleFinding,
  "sourceLocations" | "sourceLocationCount"
>;

/** Lookups built once per evaluation so every rule runs in linear time. */
interface RuleIndex {
  snapshot: GraphSnapshot;
  entityById: Map<string, GraphEntity>;
  relationshipById: Map<string, GraphRelationship>;
  sourceByEvidenceId: Map<string, SourceLocator>;
  intendedComponents: GraphEntity[];
  componentById: Map<string, GraphEntity>;
  mappings: GraphRelationship[];
  mappingsByComponent: Map<string, GraphRelationship[]>;
  mappingsByEntity: Map<string, GraphRelationship[]>;
  componentsByMappedEntity: Map<string, Set<string>>;
}

export function evaluateArchitectureRules(
  snapshot: GraphSnapshot,
): ArchitectureRuleEvaluation {
  const index = buildIndex(snapshot);
  const drafts: DraftFinding[] = [
    ...findUnmappedComponents(index),
    ...findOverlappingMappings(index),
    ...findConflictingNestedMappings(index),
    ...findIntentDependencyDrift(index),
    ...findDependencyCycles(index),
    ...findIntendedDependencyCycles(index),
  ];

  drafts.sort(
    (left, right) =>
      left.ruleId.localeCompare(right.ruleId) ||
      left.entityIds.join(",").localeCompare(right.entityIds.join(",")),
  );

  return {
    repositoryId: snapshot.repositoryId,
    revision: snapshot.revision,
    ruleSetVersion: "1.2.0",
    findings: drafts.map((draft) => ({
      ...draft,
      ...locateFinding(draft, index),
    })),
  };
}

function buildIndex(snapshot: GraphSnapshot): RuleIndex {
  const entityById = new Map(
    snapshot.entities.map((entity) => [entity.id, entity]),
  );
  const intendedComponents = snapshot.entities.filter(
    (entity) => entity.kind === "component" && entity.state === "intended",
  );
  const mappings = snapshot.relationships.filter(
    (relationship) =>
      relationship.type === "MAPS_TO" && relationship.state === "intended",
  );
  const mappingsByComponent = new Map<string, GraphRelationship[]>();
  const mappingsByEntity = new Map<string, GraphRelationship[]>();
  const componentsByMappedEntity = new Map<string, Set<string>>();
  for (const mapping of mappings) {
    append(mappingsByComponent, mapping.sourceEntityId, mapping);
    append(mappingsByEntity, mapping.targetEntityId, mapping);
    const components =
      componentsByMappedEntity.get(mapping.targetEntityId) ?? new Set();
    components.add(mapping.sourceEntityId);
    componentsByMappedEntity.set(mapping.targetEntityId, components);
  }
  const sourceByEvidenceId = new Map<string, SourceLocator>();
  for (const evidence of snapshot.evidence) {
    if (evidence.source) sourceByEvidenceId.set(evidence.id, evidence.source);
  }
  return {
    snapshot,
    entityById,
    relationshipById: new Map(
      snapshot.relationships.map((relationship) => [
        relationship.id,
        relationship,
      ]),
    ),
    sourceByEvidenceId,
    intendedComponents,
    componentById: new Map(
      intendedComponents.map((component) => [component.id, component]),
    ),
    mappings,
    mappingsByComponent,
    mappingsByEntity,
    componentsByMappedEntity,
  };
}

function findUnmappedComponents(index: RuleIndex): DraftFinding[] {
  return index.intendedComponents
    .filter((component) => !index.mappingsByComponent.has(component.id))
    .map((component) => ({
      ruleId: "unmapped-intended-component",
      title: "Intended component has no mapped code",
      severity: "info" as const,
      message: `"${displayName(component.name)}" has no mapped observed code yet. Review this design gap; it is not automatically a defect.`,
      entityIds: [component.id],
      relationshipIds: [],
      evidenceIds: uniqueSorted(component.evidenceIds),
    }));
}

function findOverlappingMappings(index: RuleIndex): DraftFinding[] {
  const findings: DraftFinding[] = [];
  for (const [entityId, componentIds] of index.componentsByMappedEntity) {
    if (componentIds.size < 2) continue;
    const entity = index.entityById.get(entityId);
    if (!entity) continue;
    const relevantMappings = index.mappingsByEntity.get(entityId) ?? [];
    const components = componentsIn(index, componentIds);
    const componentNames = components
      .map((component) => component.name)
      .sort((left, right) => left.localeCompare(right));
    findings.push({
      ruleId: "overlapping-intent-mappings",
      title: "Observed code is mapped to multiple components",
      severity: "warning",
      message: `"${displayName(entity.name)}" is mapped to ${componentNames.length} intended components (${summarizeNames(componentNames)}). Confirm this shared ownership is intentional.`,
      entityIds: uniqueSorted([entity.id, ...componentIds]),
      relationshipIds: uniqueSorted(
        relevantMappings.map((mapping) => mapping.id),
      ),
      evidenceIds: uniqueSorted([
        ...entity.evidenceIds,
        ...components.flatMap((component) => component.evidenceIds),
        ...relevantMappings.flatMap((mapping) => mapping.evidenceIds),
      ]),
    });
  }
  return findings;
}

/**
 * Observed code whose nearest mapped container (through CONTAINS) is mapped
 * to a disjoint set of components: the graph records two owners for the same
 * code.
 */
function findConflictingNestedMappings(index: RuleIndex): DraftFinding[] {
  const containment = new Map<string, GraphRelationship>();
  for (const relationship of index.snapshot.relationships) {
    if (relationship.type === "CONTAINS" && relationship.state === "actual") {
      containment.set(relationship.targetEntityId, relationship);
    }
  }

  const findings: DraftFinding[] = [];
  for (const [entityId, componentIds] of index.componentsByMappedEntity) {
    const entity = index.entityById.get(entityId);
    if (!entity || entity.state !== "actual") continue;

    const chain: GraphRelationship[] = [];
    const visited = new Set([entityId]);
    let ancestorId: string | undefined;
    for (
      let link = containment.get(entityId);
      link && !visited.has(link.sourceEntityId);
      link = containment.get(link.sourceEntityId)
    ) {
      chain.push(link);
      visited.add(link.sourceEntityId);
      if (index.componentsByMappedEntity.has(link.sourceEntityId)) {
        ancestorId = link.sourceEntityId;
        break;
      }
    }
    if (!ancestorId) continue;
    const ancestorComponentIds =
      index.componentsByMappedEntity.get(ancestorId)!;
    if ([...componentIds].some((id) => ancestorComponentIds.has(id))) continue;
    const ancestor = index.entityById.get(ancestorId);
    if (!ancestor) continue;

    const ownMappings = index.mappingsByEntity.get(entityId) ?? [];
    const ancestorMappings = index.mappingsByEntity.get(ancestorId) ?? [];
    const names = (ids: Set<string>) =>
      summarizeNames(
        componentsIn(index, ids)
          .map((component) => component.name)
          .sort((left, right) => left.localeCompare(right)),
      );
    findings.push({
      ruleId: "conflicting-nested-mapping",
      title:
        "Nested code is mapped to a different component than its container",
      severity: "warning",
      message: `"${displayName(entity.name)}" is mapped to ${names(componentIds)}, but its container "${displayName(ancestor.name)}" is mapped to ${names(ancestorComponentIds)}. Confirm which component owns this code.`,
      entityIds: uniqueSorted([
        entityId,
        ancestorId,
        ...componentIds,
        ...ancestorComponentIds,
      ]),
      relationshipIds: uniqueSorted([
        ...chain.map((link) => link.id),
        ...ownMappings.map((mapping) => mapping.id),
        ...ancestorMappings.map((mapping) => mapping.id),
      ]),
      evidenceIds: uniqueSorted([
        ...entity.evidenceIds,
        ...ancestor.evidenceIds,
        ...chain.flatMap((link) => link.evidenceIds),
        ...ownMappings.flatMap((mapping) => mapping.evidenceIds),
        ...ancestorMappings.flatMap((mapping) => mapping.evidenceIds),
      ]),
    });
  }
  return findings;
}

function findIntentDependencyDrift(index: RuleIndex): DraftFinding[] {
  const { componentById, componentsByMappedEntity, mappingsByComponent } =
    index;
  const keyFor = (sourceId: string, targetId: string): string =>
    `${sourceId}\u0000${targetId}`;

  const expected = new Map<
    string,
    { sourceId: string; targetId: string; relationships: GraphRelationship[] }
  >();
  for (const relationship of index.snapshot.relationships) {
    if (
      relationship.state !== "intended" ||
      relationship.type !== "DEPENDS_ON" ||
      !componentById.has(relationship.sourceEntityId) ||
      !componentById.has(relationship.targetEntityId)
    ) {
      continue;
    }
    const key = keyFor(
      relationship.sourceEntityId,
      relationship.targetEntityId,
    );
    const entry = expected.get(key) ?? {
      sourceId: relationship.sourceEntityId,
      targetId: relationship.targetEntityId,
      relationships: [],
    };
    entry.relationships.push(relationship);
    expected.set(key, entry);
  }

  const observed = new Map<
    string,
    { sourceId: string; targetId: string; relationships: GraphRelationship[] }
  >();
  for (const relationship of index.snapshot.relationships) {
    if (
      relationship.state !== "actual" ||
      !dependencyRelationshipTypes.has(relationship.type)
    ) {
      continue;
    }
    const sourceComponents = componentsByMappedEntity.get(
      relationship.sourceEntityId,
    );
    const targetComponents = componentsByMappedEntity.get(
      relationship.targetEntityId,
    );
    if (!sourceComponents || !targetComponents) continue;
    for (const sourceId of sourceComponents) {
      for (const targetId of targetComponents) {
        if (sourceId === targetId) continue;
        const key = keyFor(sourceId, targetId);
        const entry = observed.get(key) ?? {
          sourceId,
          targetId,
          relationships: [],
        };
        entry.relationships.push(relationship);
        observed.set(key, entry);
      }
    }
  }

  const mappingEvidence = (componentId: string): string[] =>
    (mappingsByComponent.get(componentId) ?? []).flatMap(
      (mapping) => mapping.evidenceIds,
    );
  const mappedEntityIds = (componentId: string): string[] =>
    (mappingsByComponent.get(componentId) ?? []).map(
      (mapping) => mapping.targetEntityId,
    );

  const findings: DraftFinding[] = [];
  for (const [key, { sourceId, targetId, relationships }] of expected) {
    if (
      !mappingsByComponent.has(sourceId) ||
      !mappingsByComponent.has(targetId)
    )
      continue;
    if (observed.has(key)) continue;
    const source = componentById.get(sourceId)!;
    const target = componentById.get(targetId)!;
    findings.push({
      ruleId: "unrealized-intended-dependency",
      title: "Intended dependency has no mapped code evidence",
      severity: "info",
      message: `The intended dependency from "${displayName(source.name)}" to "${displayName(target.name)}" has no observed dependency between their mapped code. Review the mapping and source graph.`,
      entityIds: uniqueSorted([
        source.id,
        target.id,
        ...mappedEntityIds(source.id),
        ...mappedEntityIds(target.id),
      ]),
      relationshipIds: uniqueSorted(relationships.map((item) => item.id)),
      evidenceIds: uniqueSorted([
        ...source.evidenceIds,
        ...target.evidenceIds,
        ...relationships.flatMap((item) => item.evidenceIds),
        ...mappingEvidence(source.id),
        ...mappingEvidence(target.id),
      ]),
    });
  }

  for (const [key, { sourceId, targetId, relationships }] of observed) {
    if (expected.has(key)) continue;
    const source = componentById.get(sourceId);
    const target = componentById.get(targetId);
    if (!source || !target) continue;
    const reversed = expected.has(keyFor(targetId, sourceId))
      ? ` The intended dependency runs the other way, from "${displayName(target.name)}" to "${displayName(source.name)}".`
      : "";
    findings.push({
      ruleId: "unplanned-observed-dependency",
      title: "Observed dependency is absent from intended architecture",
      severity: "warning",
      message: `Mapped code in "${displayName(source.name)}" depends on mapped code in "${displayName(target.name)}", but no intended dependency is recorded.${reversed} Review whether intent or mappings should change.`,
      entityIds: uniqueSorted([
        source.id,
        target.id,
        ...relationships.flatMap((item) => [
          item.sourceEntityId,
          item.targetEntityId,
        ]),
      ]),
      relationshipIds: uniqueSorted([
        ...relationships.map((item) => item.id),
        ...(mappingsByComponent.get(source.id) ?? []).map((item) => item.id),
        ...(mappingsByComponent.get(target.id) ?? []).map((item) => item.id),
      ]),
      evidenceIds: uniqueSorted([
        ...relationships.flatMap((item) => item.evidenceIds),
        ...mappingEvidence(source.id),
        ...mappingEvidence(target.id),
      ]),
    });
  }
  return findings;
}

function findDependencyCycles(index: RuleIndex): DraftFinding[] {
  const entities = index.snapshot.entities.filter(
    (entity) => entity.state === "actual",
  );
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const dependencies = index.snapshot.relationships.filter(
    (relationship) =>
      relationship.state === "actual" &&
      dependencyRelationshipTypes.has(relationship.type) &&
      entityById.has(relationship.sourceEntityId) &&
      entityById.has(relationship.targetEntityId),
  );

  return findCycles(
    entities.map((entity) => entity.id),
    dependencies,
  ).map(({ nodeIds, relationships }) => {
    const names = nodeIds
      .map((id) => entityById.get(id)!.name)
      .sort((left, right) => left.localeCompare(right));
    const mappedIntentIds = nodeIds.flatMap((entityId) => [
      ...(index.componentsByMappedEntity.get(entityId) ?? []),
    ]);
    return {
      ruleId: "dependency-cycle",
      title: "Observed dependency cycle",
      severity: "warning" as const,
      message: `Observed dependencies form a cycle among ${summarizeNames(names)}.`,
      entityIds: uniqueSorted([...nodeIds, ...mappedIntentIds]),
      relationshipIds: uniqueSorted(relationships.map((item) => item.id)),
      evidenceIds: uniqueSorted(
        relationships.flatMap((item) => item.evidenceIds),
      ),
    };
  });
}

/** Intended component dependencies that contradict themselves by cycling. */
function findIntendedDependencyCycles(index: RuleIndex): DraftFinding[] {
  const dependencies = index.snapshot.relationships.filter(
    (relationship) =>
      relationship.state === "intended" &&
      relationship.type === "DEPENDS_ON" &&
      index.componentById.has(relationship.sourceEntityId) &&
      index.componentById.has(relationship.targetEntityId),
  );

  return findCycles(
    index.intendedComponents.map((component) => component.id),
    dependencies,
  ).map(({ nodeIds, relationships }) => {
    const components = nodeIds.map((id) => index.componentById.get(id)!);
    const names = components
      .map((component) => component.name)
      .sort((left, right) => left.localeCompare(right));
    return {
      ruleId: "intended-dependency-cycle",
      title: "Intended dependencies form a cycle",
      severity: "warning" as const,
      message: `Intended component dependencies form a cycle among ${summarizeNames(names)}. Confirm the design means these components to depend on each other.`,
      entityIds: uniqueSorted(nodeIds),
      relationshipIds: uniqueSorted(relationships.map((item) => item.id)),
      evidenceIds: uniqueSorted([
        ...components.flatMap((component) => component.evidenceIds),
        ...relationships.flatMap((item) => item.evidenceIds),
      ]),
    };
  });
}

/**
 * Strongly connected components (iterative Kosaraju, deterministic order)
 * that form cycles: more than one node, or a single node with a self-edge.
 */
function findCycles(
  nodeIds: string[],
  edges: GraphRelationship[],
): Array<{ nodeIds: string[]; relationships: GraphRelationship[] }> {
  const sortedIds = [...nodeIds].sort();
  const adjacency = new Map<string, string[]>(sortedIds.map((id) => [id, []]));
  const reverseAdjacency = new Map<string, string[]>(
    sortedIds.map((id) => [id, []]),
  );
  for (const edge of edges) {
    adjacency.get(edge.sourceEntityId)?.push(edge.targetEntityId);
    reverseAdjacency.get(edge.targetEntityId)?.push(edge.sourceEntityId);
  }
  for (const neighbors of adjacency.values()) neighbors.sort();
  for (const neighbors of reverseAdjacency.values()) neighbors.sort();

  const visited = new Set<string>();
  const finishOrder: string[] = [];
  for (const startId of sortedIds) {
    if (visited.has(startId)) continue;
    visited.add(startId);
    const traversal = [{ id: startId, next: 0 }];
    while (traversal.length > 0) {
      const current = traversal[traversal.length - 1]!;
      const neighbors = adjacency.get(current.id)!;
      if (current.next < neighbors.length) {
        const nextId = neighbors[current.next]!;
        current.next += 1;
        if (!visited.has(nextId)) {
          visited.add(nextId);
          traversal.push({ id: nextId, next: 0 });
        }
      } else {
        finishOrder.push(current.id);
        traversal.pop();
      }
    }
  }

  visited.clear();
  const componentOf = new Map<string, number>();
  const components: string[][] = [];
  for (let position = finishOrder.length - 1; position >= 0; position -= 1) {
    const startId = finishOrder[position]!;
    if (visited.has(startId)) continue;
    const component: string[] = [];
    const stack = [startId];
    visited.add(startId);
    while (stack.length > 0) {
      const id = stack.pop()!;
      component.push(id);
      componentOf.set(id, components.length);
      for (const neighborId of reverseAdjacency.get(id)!) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          stack.push(neighborId);
        }
      }
    }
    components.push(component.sort());
  }

  const internalEdges = new Map<number, GraphRelationship[]>();
  for (const edge of edges) {
    const component = componentOf.get(edge.sourceEntityId);
    if (
      component === undefined ||
      component !== componentOf.get(edge.targetEntityId)
    )
      continue;
    append(internalEdges, component, edge);
  }

  return components.flatMap((ids, component) => {
    const relationships = internalEdges.get(component) ?? [];
    const isCycle =
      ids.length > 1 ||
      relationships.some((edge) => edge.sourceEntityId === edge.targetEntityId);
    return isCycle ? [{ nodeIds: ids, relationships }] : [];
  });
}

function locateFinding(
  finding: DraftFinding,
  index: RuleIndex,
): Pick<ArchitectureRuleFinding, "sourceLocations" | "sourceLocationCount"> {
  // One pass per group: a Set counts distinct locations and a bounded sorted
  // buffer keeps the first few, avoiding a full sort of large findings.
  const seen = new Set<string>();
  const relationshipTop: SourceLocator[] = [];
  const entityTop: SourceLocator[] = [];
  const offer = (source: SourceLocator, top: SourceLocator[]): void => {
    const key = locatorKey(source);
    if (seen.has(key)) return;
    seen.add(key);
    insertBounded(top, source, maxFindingSourceLocations);
  };

  // Observed relationship evidence pinpoints statements; entity ranges are a
  // fallback (a whole file or declaration).
  for (const relationshipId of finding.relationshipIds) {
    const relationship = index.relationshipById.get(relationshipId);
    if (!relationship || relationship.state !== "actual") continue;
    for (const evidenceId of relationship.evidenceIds) {
      const source = index.sourceByEvidenceId.get(evidenceId);
      if (source) offer(source, relationshipTop);
    }
  }
  for (const entityId of finding.entityIds) {
    const entity = index.entityById.get(entityId);
    if (entity?.state === "actual" && entity.source) {
      offer(entity.source, entityTop);
    }
  }
  return {
    sourceLocations: [...relationshipTop, ...entityTop].slice(
      0,
      maxFindingSourceLocations,
    ),
    sourceLocationCount: seen.size,
  };
}

/** Inserts into an ascending array, keeping at most `limit` smallest items. */
function insertBounded(
  top: SourceLocator[],
  source: SourceLocator,
  limit: number,
): void {
  if (top.length === limit && compareLocators(source, top[limit - 1]!) >= 0) {
    return;
  }
  let position = top.length;
  while (position > 0 && compareLocators(source, top[position - 1]!) < 0) {
    position -= 1;
  }
  top.splice(position, 0, source);
  if (top.length > limit) top.pop();
}

function locatorKey(source: SourceLocator): string {
  const { start, end } = source.range;
  return `${source.repositoryRelativePath}\u0000${start.line}:${start.column}\u0000${end.line}:${end.column}`;
}

function compareLocators(left: SourceLocator, right: SourceLocator): number {
  // Code-unit path order is deterministic across locales and much cheaper
  // than localeCompare in this hot path.
  const leftPath = left.repositoryRelativePath;
  const rightPath = right.repositoryRelativePath;
  return (
    (leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0) ||
    left.range.start.line - right.range.start.line ||
    left.range.start.column - right.range.start.column ||
    left.range.end.line - right.range.end.line ||
    left.range.end.column - right.range.end.column
  );
}

function componentsIn(index: RuleIndex, ids: Set<string>): GraphEntity[] {
  return [...ids].flatMap((id) => {
    const component = index.componentById.get(id);
    return component ? [component] : [];
  });
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function summarizeNames(names: string[]): string {
  const displayedNames = names.slice(0, 5).map(displayName);
  return names.length > displayedNames.length
    ? `${displayedNames.join(", ")}, and ${names.length - displayedNames.length} more`
    : displayedNames.join(", ");
}

function displayName(name: string): string {
  return name.length > 100 ? `${name.slice(0, 97)}...` : name;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}
