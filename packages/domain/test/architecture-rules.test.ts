import { describe, expect, it } from "vitest";
import { evaluateArchitectureRules, type GraphSnapshot } from "../src/index.js";

const repositoryId = "7b9442d6-faaa-49f9-a39e-7de8a276a978";
const firstFileId = "9ac38590-a7ac-4101-bfc9-dc323d1c9301";
const secondFileId = "8201f145-13bb-4a40-8d28-2e99458ab8bb";
const firstComponentId = "b4a1d2e3-7f6a-4a5b-8c9d-0123456789ab";
const secondComponentId = "c4a1d2e3-7f6a-4a5b-8c9d-0123456789ab";
const firstEvidenceId = "05a4d48e-1e17-4ca7-9e03-773ea13d3561";
const secondEvidenceId = "15a4d48e-1e17-4ca7-9e03-773ea13d3561";
const firstRelationshipId = "9e94e1f3-8a77-4de6-9957-562e07163ddd";
const secondRelationshipId = "ae94e1f3-8a77-4de6-9957-562e07163ddd";
const firstMappingId = "be94e1f3-8a77-4de6-9957-562e07163ddd";
const secondMappingId = "ce94e1f3-8a77-4de6-9957-562e07163ddd";

function snapshot(): GraphSnapshot {
  return {
    schemaVersion: 1,
    repositoryId,
    revision: "a1b2c3d",
    entities: [
      {
        id: firstFileId,
        kind: "file",
        name: "first.ts",
        state: "actual",
        evidenceIds: [firstEvidenceId],
      },
      {
        id: secondFileId,
        kind: "file",
        name: "second.ts",
        state: "actual",
        evidenceIds: [secondEvidenceId],
      },
      {
        id: firstComponentId,
        kind: "component",
        name: "Core",
        state: "intended",
        evidenceIds: [firstEvidenceId],
      },
      {
        id: secondComponentId,
        kind: "component",
        name: "Interface",
        state: "intended",
        evidenceIds: [secondEvidenceId],
      },
    ],
    evidence: [
      {
        id: firstEvidenceId,
        origin: "source-analysis",
        description: "First file declaration.",
      },
      {
        id: secondEvidenceId,
        origin: "source-analysis",
        description: "Second file declaration.",
      },
    ],
    relationships: [],
  };
}

describe("evaluateArchitectureRules", () => {
  it("reports unmapped intended components as reviewable design gaps", () => {
    const graph = snapshot();

    const result = evaluateArchitectureRules(graph);

    expect(result).toMatchObject({
      repositoryId,
      revision: "a1b2c3d",
      ruleSetVersion: "1.2.0",
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        ruleId: "unmapped-intended-component",
        severity: "info",
        entityIds: [firstComponentId],
        evidenceIds: [firstEvidenceId],
      }),
    );
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]!.message).toContain("not automatically a defect");
  });

  it("reports dependency cycles with the exact graph and evidence references", () => {
    const graph = snapshot();
    graph.relationships.push(
      {
        id: firstRelationshipId,
        sourceEntityId: firstFileId,
        targetEntityId: secondFileId,
        type: "IMPORTS",
        state: "actual",
        evidenceIds: [firstEvidenceId],
      },
      {
        id: secondRelationshipId,
        sourceEntityId: secondFileId,
        targetEntityId: firstFileId,
        type: "DEPENDS_ON",
        state: "actual",
        evidenceIds: [secondEvidenceId],
      },
      {
        id: firstMappingId,
        sourceEntityId: firstComponentId,
        targetEntityId: firstFileId,
        type: "MAPS_TO",
        state: "intended",
        evidenceIds: [firstEvidenceId],
      },
    );

    const result = evaluateArchitectureRules(graph);
    const cycle = result.findings.find(
      (finding) => finding.ruleId === "dependency-cycle",
    );

    expect(cycle).toMatchObject({
      severity: "warning",
      entityIds: [secondFileId, firstFileId, firstComponentId],
      relationshipIds: [firstRelationshipId, secondRelationshipId],
      evidenceIds: [firstEvidenceId, secondEvidenceId],
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        ruleId: "unmapped-intended-component",
        entityIds: [secondComponentId],
      }),
    );
  });

  it("reports self-dependencies and overlapping intent mappings", () => {
    const graph = snapshot();
    graph.relationships.push(
      {
        id: firstRelationshipId,
        sourceEntityId: firstFileId,
        targetEntityId: firstFileId,
        type: "REEXPORTS",
        state: "actual",
        evidenceIds: [firstEvidenceId],
      },
      {
        id: firstMappingId,
        sourceEntityId: firstComponentId,
        targetEntityId: firstFileId,
        type: "MAPS_TO",
        state: "intended",
        evidenceIds: [firstEvidenceId],
      },
      {
        id: secondMappingId,
        sourceEntityId: secondComponentId,
        targetEntityId: firstFileId,
        type: "MAPS_TO",
        state: "intended",
        evidenceIds: [secondEvidenceId],
      },
    );

    const result = evaluateArchitectureRules(graph);

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "dependency-cycle",
          entityIds: [firstFileId, firstComponentId, secondComponentId],
          relationshipIds: [firstRelationshipId],
        }),
        expect.objectContaining({
          ruleId: "overlapping-intent-mappings",
          entityIds: [firstFileId, firstComponentId, secondComponentId],
          relationshipIds: [firstMappingId, secondMappingId],
          evidenceIds: [firstEvidenceId, secondEvidenceId],
        }),
      ]),
    );
    expect(
      result.findings.some(
        (finding) => finding.ruleId === "unmapped-intended-component",
      ),
    ).toBe(false);
  });

  it("ignores intended dependencies and relationships outside the rule scope", () => {
    const graph = snapshot();
    graph.relationships.push(
      {
        id: firstRelationshipId,
        sourceEntityId: firstFileId,
        targetEntityId: secondFileId,
        type: "CALLS",
        state: "actual",
        evidenceIds: [firstEvidenceId],
      },
      {
        id: secondRelationshipId,
        sourceEntityId: secondFileId,
        targetEntityId: firstFileId,
        type: "IMPORTS",
        state: "intended",
        evidenceIds: [secondEvidenceId],
      },
    );

    const result = evaluateArchitectureRules(graph);

    expect(
      result.findings.some((finding) => finding.ruleId === "dependency-cycle"),
    ).toBe(false);
  });

  it("compares intended component dependencies with dependencies between mapped code", () => {
    const graph = snapshot();
    graph.relationships.push(
      {
        id: firstMappingId,
        sourceEntityId: firstComponentId,
        targetEntityId: firstFileId,
        type: "MAPS_TO",
        state: "intended",
        evidenceIds: [firstEvidenceId],
      },
      {
        id: secondMappingId,
        sourceEntityId: secondComponentId,
        targetEntityId: secondFileId,
        type: "MAPS_TO",
        state: "intended",
        evidenceIds: [secondEvidenceId],
      },
      {
        id: firstRelationshipId,
        sourceEntityId: firstFileId,
        targetEntityId: secondFileId,
        type: "IMPORTS",
        state: "actual",
        evidenceIds: [firstEvidenceId],
      },
    );

    const unplanned = evaluateArchitectureRules(graph).findings.find(
      (finding) => finding.ruleId === "unplanned-observed-dependency",
    );
    expect(unplanned).toMatchObject({
      severity: "warning",
      entityIds: [secondFileId, firstFileId, firstComponentId, secondComponentId],
      relationshipIds: [firstRelationshipId, firstMappingId, secondMappingId],
      evidenceIds: [firstEvidenceId, secondEvidenceId],
    });

    graph.relationships.push({
      id: secondRelationshipId,
      sourceEntityId: firstComponentId,
      targetEntityId: secondComponentId,
      type: "DEPENDS_ON",
      state: "intended",
      evidenceIds: [secondEvidenceId],
    });
    expect(
      evaluateArchitectureRules(graph).findings.some(
        (finding) => finding.ruleId === "unplanned-observed-dependency",
      ),
    ).toBe(false);

    graph.relationships = graph.relationships.filter(
      (relationship) => relationship.id !== firstRelationshipId,
    );
    expect(evaluateArchitectureRules(graph).findings).toContainEqual(
      expect.objectContaining({
        ruleId: "unrealized-intended-dependency",
        severity: "info",
        entityIds: [secondFileId, firstFileId, firstComponentId, secondComponentId],
        relationshipIds: [secondRelationshipId],
      }),
    );
  });

  it("returns findings in a stable order", () => {
    const graph = snapshot();
    const expected = evaluateArchitectureRules(graph);
    graph.entities.reverse();

    expect(evaluateArchitectureRules(graph)).toEqual(expected);
  });

  it("evaluates long dependency chains without recursive traversal", () => {
    const graph = snapshot();
    const entityCount = 5_000;
    const chainEntities = Array.from({ length: entityCount }, (_, index) => ({
      id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
      kind: "file" as const,
      name: `file-${index}.ts`,
      state: "actual" as const,
      evidenceIds: [],
    }));
    graph.entities = chainEntities;
    graph.relationships = chainEntities.slice(0, -1).map((entity, index) => ({
      id: `10000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
      sourceEntityId: entity.id,
      targetEntityId: chainEntities[index + 1]!.id,
      type: "IMPORTS",
      state: "actual" as const,
      evidenceIds: [],
    }));

    expect(
      evaluateArchitectureRules(graph).findings.some(
        (finding) => finding.ruleId === "dependency-cycle",
      ),
    ).toBe(false);
  });
});
