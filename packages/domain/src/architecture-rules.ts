import type { GraphRelationship, GraphSnapshot } from "./index.js";

export interface ArchitectureRuleFinding {
  ruleId: string;
  title: string;
  severity: "info" | "warning";
  message: string;
  entityIds: string[];
  relationshipIds: string[];
  evidenceIds: string[];
}

export interface ArchitectureRuleEvaluation {
  repositoryId: string;
  revision: string | null;
  ruleSetVersion: "1.1.0";
  findings: ArchitectureRuleFinding[];
}

const dependencyRelationshipTypes = new Set([
  "DEPENDS_ON",
  "IMPORTS",
  "REEXPORTS",
]);

export function evaluateArchitectureRules(
  snapshot: GraphSnapshot,
): ArchitectureRuleEvaluation {
  const findings: ArchitectureRuleFinding[] = [];
  const intendedComponents = snapshot.entities.filter(
    (entity) => entity.kind === "component" && entity.state === "intended",
  );
  const mappings = snapshot.relationships.filter(
    (relationship) =>
      relationship.type === "MAPS_TO" && relationship.state === "intended",
  );
  const mappedComponentIds = new Set(
    mappings.map((relationship) => relationship.sourceEntityId),
  );
  const entityById = new Map(
    snapshot.entities.map((entity) => [entity.id, entity]),
  );

  for (const component of intendedComponents) {
    if (!mappedComponentIds.has(component.id)) {
      findings.push({
        ruleId: "unmapped-intended-component",
        title: "Intended component has no mapped code",
        severity: "info",
        message: `"${displayName(component.name)}" has no mapped observed code yet. Review this design gap; it is not automatically a defect.`,
        entityIds: [component.id],
        relationshipIds: [],
        evidenceIds: uniqueSorted(component.evidenceIds),
      });
    }
  }

  const componentsByMappedEntity = new Map<string, Set<string>>();
  const mappingsByMappedEntity = new Map<string, typeof mappings>();
  for (const mapping of mappings) {
    const components =
      componentsByMappedEntity.get(mapping.targetEntityId) ?? new Set();
    components.add(mapping.sourceEntityId);
    componentsByMappedEntity.set(mapping.targetEntityId, components);

    const relatedMappings =
      mappingsByMappedEntity.get(mapping.targetEntityId) ?? [];
    relatedMappings.push(mapping);
    mappingsByMappedEntity.set(mapping.targetEntityId, relatedMappings);
  }

  for (const [entityId, componentIds] of componentsByMappedEntity) {
    if (componentIds.size < 2) {
      continue;
    }
    const relevantMappings = mappingsByMappedEntity.get(entityId) ?? [];
    const entity = entityById.get(entityId);
    if (!entity) {
      continue;
    }
    const componentNames = intendedComponents
      .filter((component) => componentIds.has(component.id))
      .map((component) => component.name)
      .sort((left, right) => left.localeCompare(right));
    const componentSummary = summarizeNames(componentNames);
    findings.push({
      ruleId: "overlapping-intent-mappings",
      title: "Observed code is mapped to multiple components",
      severity: "warning",
      message: `"${displayName(entity.name)}" is mapped to ${componentNames.length} intended components (${componentSummary}). Confirm this shared ownership is intentional.`,
      entityIds: uniqueSorted([entity.id, ...componentIds]),
      relationshipIds: uniqueSorted(
        relevantMappings.map((mapping) => mapping.id),
      ),
      evidenceIds: uniqueSorted([
        ...entity.evidenceIds,
        ...intendedComponents
          .filter((component) => componentIds.has(component.id))
          .flatMap((component) => component.evidenceIds),
        ...relevantMappings.flatMap((mapping) => mapping.evidenceIds),
      ]),
    });
  }

  findings.push(
    ...findIntentDependencyDrift(snapshot, intendedComponents, mappings),
  );
  findings.push(...findDependencyCycles(snapshot, componentsByMappedEntity));

  findings.sort(
    (left, right) =>
      left.ruleId.localeCompare(right.ruleId) ||
      left.entityIds.join(",").localeCompare(right.entityIds.join(",")),
  );

  return {
    repositoryId: snapshot.repositoryId,
    revision: snapshot.revision,
    ruleSetVersion: "1.1.0",
    findings,
  };
}

function findIntentDependencyDrift(
  snapshot: GraphSnapshot,
  intendedComponents: GraphSnapshot["entities"],
  mappings: GraphRelationship[],
): ArchitectureRuleFinding[] {
  const components = intendedComponents.filter(
    (entity) => entity.kind === "component" && entity.state === "intended",
  );
  const componentIds = new Set(components.map((component) => component.id));
  const actualToComponents = new Map<string, Set<string>>();
  const componentToActual = new Map<string, Set<string>>();
  for (const mapping of mappings) {
    const mapped = actualToComponents.get(mapping.targetEntityId) ?? new Set();
    mapped.add(mapping.sourceEntityId);
    actualToComponents.set(mapping.targetEntityId, mapped);
    const actual = componentToActual.get(mapping.sourceEntityId) ?? new Set();
    actual.add(mapping.targetEntityId);
    componentToActual.set(mapping.sourceEntityId, actual);
  }

  const keyFor = (sourceId: string, targetId: string): string =>
    `${sourceId}:${targetId}`;
  const expected = new Map<string, GraphRelationship[]>();
  for (const relationship of snapshot.relationships) {
    if (
      relationship.state !== "intended" ||
      relationship.type !== "DEPENDS_ON" ||
      !componentIds.has(relationship.sourceEntityId) ||
      !componentIds.has(relationship.targetEntityId)
    ) continue;
    const key = keyFor(relationship.sourceEntityId, relationship.targetEntityId);
    expected.set(key, [...(expected.get(key) ?? []), relationship]);
  }

  const observed = new Map<string, GraphRelationship[]>();
  const dependencyTypes = new Set(["IMPORTS", "REEXPORTS", "DEPENDS_ON"]);
  for (const relationship of snapshot.relationships) {
    if (relationship.state !== "actual" || !dependencyTypes.has(relationship.type)) continue;
    const sourceComponents = actualToComponents.get(relationship.sourceEntityId);
    const targetComponents = actualToComponents.get(relationship.targetEntityId);
    if (!sourceComponents || !targetComponents) continue;
    for (const sourceId of sourceComponents) {
      for (const targetId of targetComponents) {
        if (sourceId === targetId) continue;
        const key = keyFor(sourceId, targetId);
        observed.set(key, [...(observed.get(key) ?? []), relationship]);
      }
    }
  }

  const componentById = new Map(components.map((component) => [component.id, component]));
  const findings: ArchitectureRuleFinding[] = [];
  for (const [key, relationships] of expected) {
    const [sourceId, targetId] = key.split(":");
    if (!componentToActual.has(sourceId!) || !componentToActual.has(targetId!)) continue;
    if (observed.has(key)) continue;
    const source = componentById.get(sourceId!);
    const target = componentById.get(targetId!);
    if (!source || !target) continue;
    findings.push({
      ruleId: "unrealized-intended-dependency",
      title: "Intended dependency has no mapped code evidence",
      severity: "info",
      message: `The intended dependency from "${displayName(source.name)}" to "${displayName(target.name)}" has no observed dependency between their mapped code. Review the mapping and source graph.`,
      entityIds: uniqueSorted([
        source.id,
        target.id,
        ...(componentToActual.get(source.id) ?? []),
        ...(componentToActual.get(target.id) ?? []),
      ]),
      relationshipIds: uniqueSorted(relationships.map((item) => item.id)),
      evidenceIds: uniqueSorted([
        ...source.evidenceIds,
        ...target.evidenceIds,
        ...relationships.flatMap((item) => item.evidenceIds),
        ...mappings
          .filter((mapping) => mapping.sourceEntityId === source.id || mapping.sourceEntityId === target.id)
          .flatMap((item) => item.evidenceIds),
      ]),
    });
  }
  for (const [key, relationships] of observed) {
    if (expected.has(key)) continue;
    const [sourceId, targetId] = key.split(":");
    const source = componentById.get(sourceId!);
    const target = componentById.get(targetId!);
    if (!source || !target) continue;
    const sourceMappingIds = mappings.filter((item) => item.sourceEntityId === source.id).map((item) => item.id);
    const targetMappingIds = mappings.filter((item) => item.sourceEntityId === target.id).map((item) => item.id);
    findings.push({
      ruleId: "unplanned-observed-dependency",
      title: "Observed dependency is absent from intended architecture",
      severity: "warning",
      message: `Mapped code in "${displayName(source.name)}" depends on mapped code in "${displayName(target.name)}", but no intended dependency is recorded. Review whether intent or mappings should change.`,
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
        ...sourceMappingIds,
        ...targetMappingIds,
      ]),
      evidenceIds: uniqueSorted([
        ...relationships.flatMap((item) => item.evidenceIds),
        ...mappings
          .filter((item) => item.sourceEntityId === source.id || item.sourceEntityId === target.id)
          .flatMap((item) => item.evidenceIds),
      ]),
    });
  }
  return findings;
}

function findDependencyCycles(
  snapshot: GraphSnapshot,
  componentsByMappedEntity: Map<string, Set<string>>,
): ArchitectureRuleFinding[] {
  const entities = snapshot.entities.filter(
    (entity) => entity.state === "actual",
  );
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const entityIds = entities.map((entity) => entity.id).sort();
  const dependencies = snapshot.relationships.filter(
    (relationship) =>
      relationship.state === "actual" &&
      dependencyRelationshipTypes.has(relationship.type) &&
      entityById.has(relationship.sourceEntityId) &&
      entityById.has(relationship.targetEntityId),
  );
  const adjacency = new Map<string, string[]>(
    entities.map((entity) => [entity.id, []]),
  );
  const reverseAdjacency = new Map<string, string[]>(
    entities.map((entity) => [entity.id, []]),
  );
  for (const dependency of dependencies) {
    adjacency.get(dependency.sourceEntityId)?.push(dependency.targetEntityId);
    reverseAdjacency
      .get(dependency.targetEntityId)
      ?.push(dependency.sourceEntityId);
  }
  for (const neighbors of adjacency.values()) {
    neighbors.sort();
  }
  for (const neighbors of reverseAdjacency.values()) {
    neighbors.sort();
  }

  const visited = new Set<string>();
  const finishOrder: string[] = [];
  for (const startId of entityIds) {
    if (visited.has(startId)) {
      continue;
    }

    visited.add(startId);
    const traversal: { entityId: string; nextNeighbor: number }[] = [
      { entityId: startId, nextNeighbor: 0 },
    ];
    while (traversal.length > 0) {
      const current = traversal[traversal.length - 1]!;
      const neighbors = adjacency.get(current.entityId) ?? [];
      if (current.nextNeighbor < neighbors.length) {
        const nextId = neighbors[current.nextNeighbor]!;
        current.nextNeighbor += 1;
        if (!visited.has(nextId)) {
          visited.add(nextId);
          traversal.push({ entityId: nextId, nextNeighbor: 0 });
        }
      } else {
        finishOrder.push(current.entityId);
        traversal.pop();
      }
    }
  }

  visited.clear();
  const components: string[][] = [];
  for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
    const startId = finishOrder[index]!;
    if (visited.has(startId)) {
      continue;
    }

    const component: string[] = [];
    const traversal = [startId];
    visited.add(startId);
    while (traversal.length > 0) {
      const entityId = traversal.pop()!;
      component.push(entityId);
      for (const neighborId of reverseAdjacency.get(entityId) ?? []) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          traversal.push(neighborId);
        }
      }
    }
    components.push(component.sort());
  }

  const componentIndexByEntityId = new Map<string, number>();
  components.forEach((componentIds, componentIndex) => {
    for (const entityId of componentIds) {
      componentIndexByEntityId.set(entityId, componentIndex);
    }
  });
  const dependenciesByComponent = new Map<number, typeof dependencies>();
  for (const dependency of dependencies) {
    const sourceComponent = componentIndexByEntityId.get(
      dependency.sourceEntityId,
    );
    if (
      sourceComponent === undefined ||
      sourceComponent !==
        componentIndexByEntityId.get(dependency.targetEntityId)
    ) {
      continue;
    }
    const internalDependencies =
      dependenciesByComponent.get(sourceComponent) ?? [];
    internalDependencies.push(dependency);
    dependenciesByComponent.set(sourceComponent, internalDependencies);
  }

  return components.flatMap((componentIds, componentIndex) => {
    const cycleRelationships =
      dependenciesByComponent.get(componentIndex) ?? [];
    const isCycle =
      componentIds.length > 1 ||
      cycleRelationships.some(
        (relationship) =>
          relationship.sourceEntityId === relationship.targetEntityId,
      );
    if (!isCycle) {
      return [];
    }

    const componentNames = componentIds
      .map((id) => entityById.get(id)!.name)
      .sort((left, right) => left.localeCompare(right));
    const mappedIntentIds = componentIds.flatMap((entityId) => [
      ...(componentsByMappedEntity.get(entityId) ?? []),
    ]);
    return [
      {
        ruleId: "dependency-cycle",
        title: "Observed dependency cycle",
        severity: "warning" as const,
        message: `Observed dependencies form a cycle among ${summarizeNames(componentNames)}.`,
        entityIds: uniqueSorted([...componentIds, ...mappedIntentIds]),
        relationshipIds: uniqueSorted(
          cycleRelationships.map((relationship) => relationship.id),
        ),
        evidenceIds: uniqueSorted(
          cycleRelationships.flatMap(
            (relationship) => relationship.evidenceIds,
          ),
        ),
      },
    ];
  });
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
