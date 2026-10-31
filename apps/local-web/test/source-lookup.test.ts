import { describe, expect, it } from "vitest";
import type { GraphEntity, GraphSnapshot } from "@codifier/domain";
import { lookupEntitiesAtSourceLocation } from "../src/navigation/source-lookup.js";

const repositoryId = "7b9442d6-faaa-49f9-a39e-7de8a276a978";

function createEntity(
  id: string,
  name: string,
  kind: GraphEntity["kind"],
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
  path = "src/index.ts",
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
      revision: "test-revision",
      range: {
        start: { line: startLine, column: startColumn },
        end: { line: endLine, column: endColumn },
      },
    },
  };
}

function createSnapshot(entities: GraphEntity[]): GraphSnapshot {
  return {
    schemaVersion: 1,
    repositoryId,
    revision: "test-revision",
    entities,
    evidence: [],
    relationships: [],
  };
}

describe("lookupEntitiesAtSourceLocation", () => {
  const file = createEntity("file", "src/index.ts", "file", 1, 0, 30, 0);
  const outer = createEntity("outer", "outer", "symbol", 4, 0, 20, 1);
  const inner = createEntity("inner", "inner", "symbol", 7, 2, 9, 3);

  it("finds enclosing entities by a line and ranks the narrowest range first", () => {
    const matches = lookupEntitiesAtSourceLocation(
      createSnapshot([file, outer, inner]),
      "src/index.ts:8",
    );

    expect(matches.map((entity) => entity.id)).toEqual([
      "inner",
      "outer",
      "file",
    ]);
  });

  it("accepts Windows separators and resolves a 1-based column within ranges", () => {
    const matches = lookupEntitiesAtSourceLocation(
      createSnapshot([file, outer, inner]),
      "src\\index.ts:8:3",
    );

    expect(matches.map((entity) => entity.id)).toEqual([
      "inner",
      "outer",
      "file",
    ]);
    expect(
      lookupEntitiesAtSourceLocation(
        createSnapshot([file, outer, inner]),
        "src/index.ts:9:4",
      ).map((entity) => entity.id),
    ).toEqual(["outer", "file"]);
  });

  it("returns no matches for a source location outside graph ranges", () => {
    expect(
      lookupEntitiesAtSourceLocation(
        createSnapshot([file, outer, inner]),
        "src/index.ts:25:1",
      ).map((entity) => entity.id),
    ).toEqual(["file"]);
    expect(
      lookupEntitiesAtSourceLocation(
        createSnapshot([file, outer, inner]),
        "src/missing.ts:8",
      ),
    ).toEqual([]);
  });

  it.each([
    "",
    "src/index.ts",
    "src/index.ts:0",
    "src/index.ts:8:0",
    "../src/index.ts:8",
    "src/../index.ts:8",
    "C:\\repo\\src\\index.ts:8",
    "/repo/src/index.ts:8",
    "src/index.ts:999999999999999999999999999999",
  ])("rejects malformed or unsafe location %s", (location) => {
    expect(() =>
      lookupEntitiesAtSourceLocation(createSnapshot([file]), location),
    ).toThrow();
  });
});
