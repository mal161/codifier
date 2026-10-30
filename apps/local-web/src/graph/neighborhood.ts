import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { GraphEntity, GraphSnapshot } from "@codifier/domain";

export interface NeighborhoodNodeData {
  [key: string]: unknown;
  entityId: string;
  kind: GraphEntity["kind"];
  name: string;
  path: string;
}

export type NeighborhoodNode = Node<NeighborhoodNodeData, "entity">;

export interface EntityNeighborhood {
  nodes: NeighborhoodNode[];
  edges: Edge[];
  omittedNeighborCount: number;
  totalRelationshipCount: number;
}

const maxNeighborNodes = 16;
const centerPosition = { x: 300, y: 0 };
const sideSpacing = 125;

export function buildEntityNeighborhood(
  snapshot: GraphSnapshot,
  selectedEntityId: string,
): EntityNeighborhood {
  const entityById = new Map(
    snapshot.entities
      .filter((entity) => entity.kind === "file" || entity.kind === "symbol")
      .map((entity) => [entity.id, entity]),
  );
  const selectedEntity = entityById.get(selectedEntityId);
  if (!selectedEntity) {
    return {
      nodes: [],
      edges: [],
      omittedNeighborCount: 0,
      totalRelationshipCount: 0,
    };
  }

  const connected = snapshot.relationships.flatMap((relationship) => {
    const outgoing = relationship.sourceEntityId === selectedEntityId;
    const incoming = relationship.targetEntityId === selectedEntityId;
    if (!outgoing && !incoming) {
      return [];
    }
    const neighborId = outgoing
      ? relationship.targetEntityId
      : relationship.sourceEntityId;
    const neighbor = entityById.get(neighborId);
    if (!neighbor || neighborId === selectedEntityId) {
      return [];
    }
    return [{ neighbor, relationship, outgoing }];
  });
  const totalRelationshipCount = connected.length;
  const neighborsById = new Map(
    connected.map(({ neighbor }) => [neighbor.id, neighbor]),
  );
  const neighbors = [...neighborsById.values()].sort(compareEntities);
  const includedNeighbors = neighbors.slice(0, maxNeighborNodes);
  const includedIds = new Set([
    selectedEntityId,
    ...includedNeighbors.map((entity) => entity.id),
  ]);
  const incoming = includedNeighbors.filter((entity) =>
    connected.some((item) => item.neighbor.id === entity.id && !item.outgoing),
  );
  const outgoing = includedNeighbors.filter((entity) =>
    connected.some((item) => item.neighbor.id === entity.id && item.outgoing),
  );
  const largestSide = Math.max(incoming.length, outgoing.length, 1);
  const selectedPosition = {
    ...centerPosition,
    y: Math.max(0, ((largestSide - 1) * sideSpacing) / 2),
  };
  const positions = new Map<string, NeighborhoodNode["position"]>([
    [selectedEntityId, selectedPosition],
  ]);
  incoming.forEach((entity, index) => {
    positions.set(entity.id, { x: 0, y: index * sideSpacing });
  });
  outgoing.forEach((entity, index) => {
    positions.set(entity.id, { x: 600, y: index * sideSpacing });
  });

  const nodes: NeighborhoodNode[] = [selectedEntity, ...includedNeighbors].map(
    (entity) => ({
      id: entity.id,
      type: "entity",
      position: positions.get(entity.id)!,
      selected: entity.id === selectedEntityId,
      ariaLabel:
        entity.name === entityPath(entity)
          ? `${entity.kind}: ${entity.name}`
          : `${entity.kind}: ${entity.name}, ${entityPath(entity)}`,
      data: {
        entityId: entity.id,
        kind: entity.kind,
        name: entity.name,
        path: entity.name === entityPath(entity) ? "" : entityPath(entity),
      },
    }),
  );
  const edges: Edge[] = snapshot.relationships
    .filter(
      (relationship) =>
        (relationship.sourceEntityId === selectedEntityId ||
          relationship.targetEntityId === selectedEntityId) &&
        includedIds.has(relationship.sourceEntityId) &&
        includedIds.has(relationship.targetEntityId),
    )
    .map((relationship) => ({
      id: relationship.id,
      source: relationship.sourceEntityId,
      target: relationship.targetEntityId,
      type: "smoothstep",
      label: relationship.type,
      ariaLabel: relationship.type,
      markerEnd: { type: MarkerType.ArrowClosed },
    }));

  return {
    nodes,
    edges,
    omittedNeighborCount: Math.max(0, neighbors.length - maxNeighborNodes),
    totalRelationshipCount,
  };
}

function compareEntities(left: GraphEntity, right: GraphEntity): number {
  return (
    entityPath(left).localeCompare(entityPath(right)) ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  );
}

function entityPath(entity: GraphEntity): string {
  return entity.source?.repositoryRelativePath ?? "Source location unavailable";
}
