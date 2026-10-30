import { describe, expect, it } from "vitest";
import type { GraphEntity, GraphSnapshot } from "@codifier/domain";
import { buildEntityNeighborhood } from "../src/graph/neighborhood.js";

const repositoryId = "7b9442d6-faaa-49f9-a39e-7de8a276a978";

function entity(
  id: string,
  name: string,
  kind: GraphEntity["kind"] = "symbol",
  path = `${name}.ts`,
): GraphEntity {
  return {
    id,
    kind,
    name,
    state: "actual",
    evidenceIds: [],
    source: {
      repositoryId,
      repositoryRelativePath: path,
      revision: "test",
      range: {
        start: { line: 1, column: 0 },
        end: { line: 1, column: 1 },
      },
    },
  };
}

function snapshot(
  entities: GraphEntity[],
  relationships: GraphSnapshot["relationships"],
): GraphSnapshot {
  return {
    schemaVersion: 1,
    repositoryId,
    revision: "test",
    entities,
    evidence: [],
    relationships,
  };
}

describe("buildEntityNeighborhood", () => {
  it("builds a selected entity neighborhood with relationship direction and labels", () => {
    const root = entity("root", "root");
    const imported = entity("imported", "imported");
    const importer = entity("importer", "importer");
    const unrelated = entity("unrelated", "unrelated");
    const result = buildEntityNeighborhood(
      snapshot(
        [root, imported, importer, unrelated],
        [
          {
            id: "edge-out",
            sourceEntityId: root.id,
            targetEntityId: imported.id,
            type: "IMPORTS",
            state: "actual",
            evidenceIds: [],
          },
          {
            id: "edge-in",
            sourceEntityId: importer.id,
            targetEntityId: root.id,
            type: "RENDERS",
            state: "actual",
            evidenceIds: [],
          },
          {
            id: "edge-unrelated",
            sourceEntityId: unrelated.id,
            targetEntityId: imported.id,
            type: "IMPORTS",
            state: "actual",
            evidenceIds: [],
          },
        ],
      ),
      root.id,
    );

    expect(result.nodes.map((node) => node.id)).toEqual([
      "root",
      "imported",
      "importer",
    ]);
    expect(result.nodes.find((node) => node.id === "root")?.selected).toBe(
      true,
    );
    expect(
      result.nodes.find((node) => node.id === "imported")?.position.x,
    ).toBe(600);
    expect(
      result.nodes.find((node) => node.id === "importer")?.position.x,
    ).toBe(0);
    expect(result.edges).toMatchObject([
      { id: "edge-out", source: "root", target: "imported", label: "IMPORTS" },
      { id: "edge-in", source: "importer", target: "root", label: "RENDERS" },
    ]);
    expect(result.totalRelationshipCount).toBe(2);
    expect(result.omittedNeighborCount).toBe(0);
  });

  it("bounds the graph and omits entities outside the supported browse kinds", () => {
    const center = entity("center", "center");
    const neighbors = Array.from({ length: 18 }, (_, index) =>
      entity(
        `neighbor-${index.toString().padStart(2, "0")}`,
        `neighbor-${index}`,
      ),
    );
    const packageEntity = entity("package", "package", "package");
    const relationships: GraphSnapshot["relationships"] = [
      ...neighbors.map((neighbor, index) => ({
        id: `edge-${index}`,
        sourceEntityId: center.id,
        targetEntityId: neighbor.id,
        type: "IMPORTS",
        state: "actual" as const,
        evidenceIds: [],
      })),
      {
        id: "package-edge",
        sourceEntityId: center.id,
        targetEntityId: packageEntity.id,
        type: "CONTAINS",
        state: "actual",
        evidenceIds: [],
      },
    ];

    const result = buildEntityNeighborhood(
      snapshot([center, ...neighbors, packageEntity], relationships),
      center.id,
    );

    expect(result.nodes).toHaveLength(17);
    expect(result.edges).toHaveLength(16);
    expect(result.omittedNeighborCount).toBe(2);
    expect(result.totalRelationshipCount).toBe(18);
  });

  it("returns an empty neighborhood when the selected entity is not browsable", () => {
    const packageEntity = entity("package", "package", "package");
    const result = buildEntityNeighborhood(
      snapshot([packageEntity], []),
      packageEntity.id,
    );

    expect(result).toEqual({
      nodes: [],
      edges: [],
      omittedNeighborCount: 0,
      totalRelationshipCount: 0,
    });
  });
});
