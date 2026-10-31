import { describe, expect, it } from "vitest";
import { validateGraphSnapshot, type GraphSnapshot } from "../src/index.js";

const repositoryId = "7b9442d6-faaa-49f9-a39e-7de8a276a978";
const evidenceId = "05a4d48e-1e17-4ca7-9e03-773ea13d3561";
const firstEntityId = "9ac38590-a7ac-4101-bfc9-dc323d1c9301";
const secondEntityId = "8201f145-13bb-4a40-8d28-2e99458ab8bb";
const relationshipId = "9e94e1f3-8a77-4de6-9957-562e07163ddd";

function validSnapshot(): GraphSnapshot {
  return {
    schemaVersion: 1,
    repositoryId,
    revision: "a1b2c3d",
    evidence: [
      {
        id: evidenceId,
        origin: "source-analysis",
        description: "Declaration discovered in source.",
        source: {
          repositoryId,
          repositoryRelativePath: "src/index.ts",
          revision: "a1b2c3d",
          range: {
            start: { line: 1, column: 0 },
            end: { line: 1, column: 10 },
          },
        },
      },
    ],
    entities: [
      {
        id: firstEntityId,
        kind: "symbol",
        name: "first",
        state: "actual",
        evidenceIds: [evidenceId],
      },
      {
        id: secondEntityId,
        kind: "symbol",
        name: "second",
        state: "actual",
        evidenceIds: [evidenceId],
      },
    ],
    relationships: [
      {
        id: relationshipId,
        sourceEntityId: firstEntityId,
        targetEntityId: secondEntityId,
        type: "DEPENDS_ON",
        state: "actual",
        evidenceIds: [evidenceId],
      },
    ],
  };
}

describe("validateGraphSnapshot", () => {
  it("accepts a graph with supported evidence and matching endpoints", () => {
    expect(validateGraphSnapshot(validSnapshot())).toEqual([]);
  });

  it("requires evidence references to resolve", () => {
    const snapshot = validSnapshot();
    snapshot.entities[0]!.evidenceIds = [
      "b04d9f9b-1e3d-4c44-82db-905f5f325737",
    ];

    expect(validateGraphSnapshot(snapshot)).toContainEqual(
      expect.objectContaining({ code: "missing-evidence-reference" }),
    );
  });

  it("requires relationship endpoints to exist", () => {
    const snapshot = validSnapshot();
    snapshot.relationships[0]!.targetEntityId =
      "b04d9f9b-1e3d-4c44-82db-905f5f325737";

    expect(validateGraphSnapshot(snapshot)).toContainEqual(
      expect.objectContaining({ code: "missing-relationship-endpoint" }),
    );
  });

  it("does not allow intended and actual graph states to be mixed in a relationship", () => {
    const snapshot = validSnapshot();
    snapshot.entities[0]!.state = "intended";

    expect(validateGraphSnapshot(snapshot)).toContainEqual(
      expect.objectContaining({ code: "state-mismatch" }),
    );
  });

  it("allows intended MAPS_TO relationships from intent to actual code", () => {
    const snapshot = validSnapshot();
    const intendedEntityId = "b4a1d2e3-7f6a-4a5b-8c9d-0123456789ab";
    const intendedEvidenceId = "b4a1d2e3-7f6a-4a5b-8c9d-1123456789ab";
    snapshot.evidence.push({
      id: intendedEvidenceId,
      origin: "developer",
      description: "Developer-authored component mapping.",
    });
    snapshot.entities.push({
      id: intendedEntityId,
      kind: "component",
      name: "Core",
      state: "intended",
      evidenceIds: [intendedEvidenceId],
    });
    snapshot.relationships.push({
      id: "b4a1d2e3-7f6a-4a5b-8c9d-2123456789ab",
      sourceEntityId: intendedEntityId,
      targetEntityId: firstEntityId,
      type: "MAPS_TO",
      state: "intended",
      evidenceIds: [intendedEvidenceId],
    });

    expect(validateGraphSnapshot(snapshot)).toEqual([]);
  });

  it("requires source locators to belong to the snapshot repository", () => {
    const snapshot = validSnapshot();
    snapshot.evidence[0]!.source!.repositoryId =
      "b04d9f9b-1e3d-4c44-82db-905f5f325737";

    expect(validateGraphSnapshot(snapshot)).toContainEqual(
      expect.objectContaining({ code: "repository-mismatch" }),
    );
  });

  it("rejects absolute and traversal source paths", () => {
    const snapshot = validSnapshot();
    snapshot.evidence[0]!.source!.repositoryRelativePath = "C:/src/index.ts";

    expect(validateGraphSnapshot(snapshot)).toContainEqual(
      expect.objectContaining({ code: "invalid-source-path" }),
    );
  });

  it("rejects source ranges with invalid or descending positions", () => {
    const snapshot = validSnapshot();
    snapshot.evidence[0]!.source!.range.end = { line: 0, column: 0 };

    expect(validateGraphSnapshot(snapshot)).toContainEqual(
      expect.objectContaining({ code: "invalid-source-range" }),
    );
  });

  it("requires a non-empty evidence trail for every relationship", () => {
    const snapshot = validSnapshot();
    snapshot.relationships[0]!.evidenceIds = [];

    expect(validateGraphSnapshot(snapshot)).toContainEqual(
      expect.objectContaining({ code: "missing-evidence" }),
    );
  });
});
