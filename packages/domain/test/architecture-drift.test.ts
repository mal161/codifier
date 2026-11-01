import { describe, expect, it } from "vitest";
import {
  evaluateArchitectureRules,
  maxFindingSourceLocations,
  type GraphEntity,
  type GraphRelationship,
  type GraphSnapshot,
  type SourceLocator,
} from "../src/index.js";

const repositoryId = "7b9442d6-faaa-49f9-a39e-7de8a276a978";
let counter = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${(counter++).toString(16).padStart(12, "0")}`;

function locator(path: string, line: number, endLine = line): SourceLocator {
  return {
    repositoryId,
    repositoryRelativePath: path,
    revision: "rev",
    range: { start: { line, column: 1 }, end: { line: endLine, column: 10 } },
  };
}

class GraphBuilder {
  readonly graph: GraphSnapshot = {
    schemaVersion: 1,
    repositoryId,
    revision: "rev",
    entities: [],
    evidence: [],
    relationships: [],
  };

  evidence(source?: SourceLocator): string {
    const id = uuid();
    this.graph.evidence.push({
      id,
      origin: source ? "source-analysis" : "developer",
      description: "Test evidence.",
      ...(source ? { source } : {}),
    });
    return id;
  }

  entity(
    kind: GraphEntity["kind"],
    name: string,
    state: GraphEntity["state"],
    source?: SourceLocator,
  ): string {
    const id = uuid();
    this.graph.entities.push({
      id,
      kind,
      name,
      state,
      evidenceIds: [this.evidence(source)],
      ...(source ? { source } : {}),
    });
    return id;
  }

  file(path: string): string {
    return this.entity("file", path, "actual", locator(path, 1, 40));
  }

  component(name: string): string {
    return this.entity("component", name, "intended");
  }

  relate(
    type: string,
    sourceEntityId: string,
    targetEntityId: string,
    state: GraphRelationship["state"],
    source?: SourceLocator,
  ): string {
    const id = uuid();
    this.graph.relationships.push({
      id,
      sourceEntityId,
      targetEntityId,
      type,
      state,
      evidenceIds: [this.evidence(source)],
    });
    return id;
  }

  map(componentId: string, entityId: string): string {
    return this.relate("MAPS_TO", componentId, entityId, "intended");
  }
}

describe("conflicting nested mappings", () => {
  it("reports code mapped to a different component than its nearest mapped container", () => {
    const g = new GraphBuilder();
    const file = g.file("src/billing.ts");
    const klass = g.entity(
      "symbol",
      "Invoice",
      "actual",
      locator("src/billing.ts", 3, 30),
    );
    const method = g.entity(
      "symbol",
      "total",
      "actual",
      locator("src/billing.ts", 10, 12),
    );
    const fileContainsClass = g.relate(
      "CONTAINS",
      file,
      klass,
      "actual",
      locator("src/billing.ts", 3, 30),
    );
    const classContainsMethod = g.relate(
      "CONTAINS",
      klass,
      method,
      "actual",
      locator("src/billing.ts", 10, 12),
    );
    const billing = g.component("Billing");
    const reporting = g.component("Reporting");
    const fileMapping = g.map(billing, file);
    const methodMapping = g.map(reporting, method);

    const finding = evaluateArchitectureRules(g.graph).findings.find(
      (candidate) => candidate.ruleId === "conflicting-nested-mapping",
    );

    expect(finding).toMatchObject({
      severity: "warning",
      // The unmapped class in between is traversed but not an owner.
      entityIds: [method, file, billing, reporting].sort(),
      relationshipIds: [
        fileContainsClass,
        classContainsMethod,
        fileMapping,
        methodMapping,
      ].sort(),
    });
    expect(finding!.message).toContain('"total" is mapped to Reporting');
    expect(finding!.message).toContain('"src/billing.ts" is mapped to Billing');
    // Containment evidence comes first, then the entities themselves.
    expect(
      finding!.sourceLocations.map((source) => source.range.start.line),
    ).toEqual([3, 10, 1]);
  });

  it("does not report nested code that shares a component with its container", () => {
    const g = new GraphBuilder();
    const file = g.file("src/a.ts");
    const symbol = g.entity("symbol", "a", "actual", locator("src/a.ts", 2));
    g.relate("CONTAINS", file, symbol, "actual");
    const core = g.component("Core");
    const shared = g.component("Shared");
    g.map(core, file);
    g.map(shared, file);
    g.map(core, symbol);

    expect(
      evaluateArchitectureRules(g.graph).findings.some(
        (finding) => finding.ruleId === "conflicting-nested-mapping",
      ),
    ).toBe(false);
  });

  it("terminates on malformed containment cycles", () => {
    const g = new GraphBuilder();
    const first = g.file("a.ts");
    const second = g.file("b.ts");
    g.relate("CONTAINS", first, second, "actual");
    g.relate("CONTAINS", second, first, "actual");
    g.map(g.component("One"), first);

    expect(() => evaluateArchitectureRules(g.graph)).not.toThrow();
  });
});

describe("intended dependency conflicts", () => {
  it("reports cycles among intended component dependencies as intent-only findings", () => {
    const g = new GraphBuilder();
    const api = g.component("API");
    const domain = g.component("Domain");
    const store = g.component("Store");
    const edges = [
      g.relate("DEPENDS_ON", api, domain, "intended"),
      g.relate("DEPENDS_ON", domain, store, "intended"),
      g.relate("DEPENDS_ON", store, domain, "intended"),
    ];

    const finding = evaluateArchitectureRules(g.graph).findings.find(
      (candidate) => candidate.ruleId === "intended-dependency-cycle",
    );

    expect(finding).toMatchObject({
      entityIds: [domain, store].sort(),
      relationshipIds: [edges[1], edges[2]].sort(),
      sourceLocations: [],
      sourceLocationCount: 0,
    });
    expect(finding!.message).toContain("Domain, Store");
  });

  it("notes when observed code depends against the intended direction", () => {
    const g = new GraphBuilder();
    const uiFile = g.file("src/ui.ts");
    const coreFile = g.file("src/core.ts");
    const ui = g.component("UI");
    const core = g.component("Core");
    g.map(ui, uiFile);
    g.map(core, coreFile);
    g.relate("DEPENDS_ON", ui, core, "intended");
    g.relate("IMPORTS", coreFile, uiFile, "actual", locator("src/core.ts", 4));

    const findings = evaluateArchitectureRules(g.graph).findings;
    const unplanned = findings.find(
      (finding) => finding.ruleId === "unplanned-observed-dependency",
    )!;

    expect(unplanned.message).toContain(
      'The intended dependency runs the other way, from "UI" to "Core".',
    );
    // The exact import statement is the first location.
    expect(unplanned.sourceLocations[0]).toEqual(locator("src/core.ts", 4));
    expect(
      findings.some(
        (finding) => finding.ruleId === "unrealized-intended-dependency",
      ),
    ).toBe(true);
  });
});

describe("finding source locations", () => {
  it("de-duplicates, orders, and caps locations while reporting the full count", () => {
    const g = new GraphBuilder();
    const files = Array.from({ length: 14 }, (_, position) =>
      g.file(`src/f${String(position).padStart(2, "0")}.ts`),
    );
    files.forEach((file, position) =>
      g.relate(
        "IMPORTS",
        file,
        files[(position + 1) % files.length]!,
        "actual",
        locator(`src/f${String(position).padStart(2, "0")}.ts`, 2),
      ),
    );

    const cycle = evaluateArchitectureRules(g.graph).findings.find(
      (finding) => finding.ruleId === "dependency-cycle",
    )!;

    expect(cycle.sourceLocationCount).toBe(28);
    expect(cycle.sourceLocations).toHaveLength(maxFindingSourceLocations);
    expect(cycle.sourceLocations[0]).toEqual(locator("src/f00.ts", 2));
    expect(
      cycle.sourceLocations.every((source) => source.range.start.line === 2),
    ).toBe(true);
  });

  it("leaves intent-only findings without locations", () => {
    const g = new GraphBuilder();
    g.component("Unmapped");

    expect(evaluateArchitectureRules(g.graph).findings).toEqual([
      expect.objectContaining({
        ruleId: "unmapped-intended-component",
        sourceLocations: [],
        sourceLocationCount: 0,
      }),
    ]);
  });
});

describe("rule evaluation performance", () => {
  it("evaluates a large mapped graph in near-linear time", () => {
    const g = new GraphBuilder();
    const files = Array.from({ length: 20_000 }, (_, position) =>
      g.file(`src/m${position}.ts`),
    );
    const components = Array.from({ length: 200 }, (_, position) =>
      g.component(`C${position}`),
    );
    files.forEach((file, position) => {
      g.map(components[position % components.length]!, file);
      for (const offset of [1, 7, 31]) {
        g.relate(
          "IMPORTS",
          file,
          files[(position + offset) % files.length]!,
          "actual",
          locator(`src/m${position}.ts`, offset),
        );
      }
    });
    components.forEach((component, position) =>
      g.relate(
        "DEPENDS_ON",
        component,
        components[(position + 1) % components.length]!,
        "intended",
      ),
    );

    const started = performance.now();
    const result = evaluateArchitectureRules(g.graph);
    const elapsed = performance.now() - started;

    expect(result.findings.length).toBeGreaterThan(0);
    // Quadratic behaviour on this graph takes minutes; linear takes well
    // under a second. The bound is loose to stay stable on slow CI hosts.
    expect(elapsed).toBeLessThan(8_000);
  }, 30_000);
});
