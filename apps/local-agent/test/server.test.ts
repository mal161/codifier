import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGraphStore } from "@codifier/storage";
import {
  analysisJobSchema,
  architectureRuleEvaluationSchema,
  type AnalysisJob,
} from "@codifier/contracts";
import { createAgentServer } from "../src/server.js";
import { WebSocket } from "ws";
import type { FastifyInstance } from "fastify";

const token = "this-is-a-test-token-with-at-least-32-bytes";
const repositoryId = "7b9442d6-faaa-49f9-a39e-7de8a276a978";
const evidenceId = "05a4d48e-1e17-4ca7-9e03-773ea13d3561";
const entityId = "9ac38590-a7ac-4101-bfc9-dc323d1c9301";
const interruptedJobId = "3a4a9cc2-60eb-4aa7-8668-5f2c7736a834";

const servers: FastifyInstance[] = [];
const stores: ReturnType<typeof openGraphStore>[] = [];
const temporaryDirectories: string[] = [];

async function startTestServer(store = openGraphStore(":memory:")): Promise<{
  app: FastifyInstance;
  baseUrl: string;
}> {
  const app = createAgentServer({
    token,
    store,
    port: 0,
    allowedOrigins: ["http://localhost:5173"],
    logLevel: "silent",
  });
  stores.push(store);
  servers.push(app);

  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  return { app, baseUrl: address };
}

function headers(value = token): Record<string, string> {
  return { authorization: `Bearer ${value}` };
}

function createSnapshot(name = "root") {
  return {
    schemaVersion: 1 as const,
    repositoryId,
    revision: "a1b2c3d",
    entities: [
      {
        id: entityId,
        kind: "repository" as const,
        name,
        state: "actual" as const,
        evidenceIds: [evidenceId],
      },
    ],
    evidence: [
      {
        id: evidenceId,
        origin: "developer" as const,
        description: "Repository registered by its owner.",
      },
    ],
    relationships: [],
  };
}

async function waitForJob(
  baseUrl: string,
  initialJob: AnalysisJob,
): Promise<AnalysisJob> {
  let job = initialJob;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (job.status === "completed" || job.status === "failed") {
      return job;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    const response = await fetch(
      `${baseUrl}/v1/analysis-jobs/${initialJob.id}`,
      { headers: headers() },
    );
    expect(response.status).toBe(200);
    job = analysisJobSchema.parse(await response.json());
  }
  throw new Error(`Analysis job ${initialJob.id} did not finish in time.`);
}

afterEach(async () => {
  for (const app of servers.splice(0)) {
    await app.close();
  }
  for (const store of stores.splice(0)) {
    store.close();
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("local agent API", () => {
  it("requires a bearer token before returning agent data", async () => {
    const { baseUrl } = await startTestServer();

    const response = await fetch(`${baseUrl}/v1/health`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("serves committed graph revision history through authenticated routes", async () => {
    const { baseUrl } = await startTestServer();
    const store = stores.at(-1)!;
    store.replaceGraph(createSnapshot());
    store.replaceGraph(createSnapshot("updated"));

    const historyResponse = await fetch(
      `${baseUrl}/v1/repositories/${repositoryId}/revisions`,
      { headers: headers() },
    );
    expect(historyResponse.status).toBe(200);
    const history = (await historyResponse.json()) as {
      revisions: Array<{
        id: string;
        sequence: number;
        parentRevisionId: string | null;
      }>;
    };
    expect(history.revisions).toHaveLength(2);
    expect(history.revisions[1]).toMatchObject({
      sequence: 2,
      parentRevisionId: history.revisions[0]!.id,
    });

    const snapshotResponse = await fetch(
      `${baseUrl}/v1/repositories/${repositoryId}/revisions/${history.revisions[0]!.id}`,
      { headers: headers() },
    );
    expect(snapshotResponse.status).toBe(200);
    expect(await snapshotResponse.json()).toEqual(createSnapshot());
  });

  it("restores an earlier revision as a new revision through the API", async () => {
    const { baseUrl } = await startTestServer();
    const store = stores.at(-1)!;
    store.replaceGraph(createSnapshot());
    store.replaceGraph(createSnapshot("updated"));
    const [first, second] = store.listGraphRevisions(repositoryId);
    const restoreUrl = (revision: string) =>
      `${baseUrl}/v1/repositories/${repositoryId}/revisions/${revision}/restore`;

    const unauthenticated = await fetch(restoreUrl(first!.id), {
      method: "POST",
    });
    expect(unauthenticated.status).toBe(401);

    const response = await fetch(restoreUrl(first!.id), {
      method: "POST",
      headers: headers(),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "restored",
      revision: {
        sequence: 3,
        parentRevisionId: second!.id,
        restoredFromRevisionId: first!.id,
      },
      graph: createSnapshot(),
    });
    expect(store.listGraphRevisions(repositoryId)).toHaveLength(3);

    const repeated = await fetch(restoreUrl(first!.id), {
      method: "POST",
      headers: headers(),
    });
    expect(await repeated.json()).toMatchObject({ status: "unchanged" });
    expect(store.listGraphRevisions(repositoryId)).toHaveLength(3);

    const missing = await fetch(
      restoreUrl("00000000-0000-4000-8000-000000000001"),
      { method: "POST", headers: headers() },
    );
    expect(missing.status).toBe(404);
    const invalid = await fetch(restoreUrl("not-a-uuid"), {
      method: "POST",
      headers: headers(),
    });
    expect(invalid.status).toBe(400);
  });

  it("restores interrupted jobs as retryable failures after agent restart", async () => {
    const store = openGraphStore(":memory:");
    store.saveAnalysisJob({
      id: interruptedJobId,
      repositoryId,
      status: "running",
      jobJson: JSON.stringify({
        id: interruptedJobId,
        repositoryId,
        status: "running",
        progress: {
          phase: "reading",
          currentFile: "src/index.ts",
          completedFiles: 2,
          totalFiles: 5,
        },
      }),
      requestJson: JSON.stringify({ rootPath: "C:\\projects\\sample" }),
    });
    const { baseUrl } = await startTestServer(store);

    const response = await fetch(
      `${baseUrl}/v1/analysis-jobs/${interruptedJobId}`,
      { headers: headers() },
    );
    expect(response.status).toBe(200);
    const restored = analysisJobSchema.parse(await response.json());
    expect(restored).toMatchObject({
      status: "failed",
      progress: { phase: "failed", completedFiles: 2 },
      error: expect.stringContaining("agent restarted"),
    });
    expect(store.getAnalysisJob(interruptedJobId)?.status).toBe("failed");
  });

  it("rejects unexpected Host and Origin headers", async () => {
    const { app, baseUrl } = await startTestServer();
    const port = new URL(baseUrl).port;

    const invalidHost = await app.inject({
      method: "GET",
      url: "/v1/health",
      headers: { ...headers(), host: `attacker.invalid:${port}` },
    });
    const invalidOrigin = await fetch(`${baseUrl}/v1/health`, {
      headers: { ...headers(), origin: "http://attacker.invalid" },
    });

    expect(invalidHost.statusCode).toBe(400);
    expect(invalidOrigin.status).toBe(403);
  });

  it("validates and stores graph snapshots through the authenticated API", async () => {
    const { baseUrl } = await startTestServer();
    const url = `${baseUrl}/v1/repositories/${repositoryId}/graph`;
    const put = await fetch(url, {
      method: "PUT",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify(createSnapshot()),
    });

    expect(put.status).toBe(204);

    const get = await fetch(url, { headers: headers() });
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(createSnapshot());
  });

  it("rejects graph snapshots with invalid evidence references", async () => {
    const { baseUrl } = await startTestServer();
    const snapshot = createSnapshot();
    snapshot.entities[0]!.evidenceIds = [
      "b04d9f9b-1e3d-4c44-82db-905f5f325737",
    ];

    const response = await fetch(
      `${baseUrl}/v1/repositories/${repositoryId}/graph`,
      {
        method: "PUT",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify(snapshot),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid_graph_snapshot",
    });
  });

  it("installs bundled architecture templates idempotently as imported intent", async () => {
    const { baseUrl } = await startTestServer();
    const graphUrl = `${baseUrl}/v1/repositories/${repositoryId}/graph`;
    const original = {
      ...createSnapshot(),
      gitContext: {
        commit: "a".repeat(40),
        branch: "main",
        workingTree: "dirty" as const,
      },
    };
    const put = await fetch(graphUrl, {
      method: "PUT",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify(original),
    });
    expect(put.status).toBe(204);

    const catalogResponse = await fetch(
      `${baseUrl}/v1/marketplace/templates?repositoryId=${repositoryId}`,
      { headers: headers() },
    );
    expect(catalogResponse.status).toBe(200);
    const catalog = (await catalogResponse.json()) as Array<{
      id: string;
      installed: boolean;
      components: Array<{ name: string }>;
    }>;
    const template = catalog[0]!;
    expect(template.installed).toBe(false);

    const installUrl = `${baseUrl}/v1/repositories/${repositoryId}/marketplace/templates`;
    const install = () =>
      fetch(installUrl, {
        method: "POST",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify({ templateId: template.id }),
      });
    const firstInstall = await install();
    expect(firstInstall.status).toBe(200);
    const installedSnapshot = await firstInstall.json();
    const installedComponents = installedSnapshot.entities.filter(
      (entity: { kind: string; state: string }) =>
        entity.kind === "component" && entity.state === "intended",
    );
    expect(installedComponents).toHaveLength(template.components.length);
    expect(
      installedComponents.map((entity: { name: string }) => entity.name).sort(),
    ).toEqual(template.components.map((component) => component.name).sort());
    expect(installedSnapshot.entities).toContainEqual(original.entities[0]);
    expect(installedSnapshot.gitContext).toEqual(original.gitContext);
    expect(installedSnapshot.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          origin: "imported",
          description: expect.stringContaining(template.id),
        }),
      ]),
    );

    const repeatedInstall = await install();
    expect(repeatedInstall.status).toBe(200);
    expect(await repeatedInstall.json()).toEqual(installedSnapshot);

    const refreshedCatalog = await fetch(
      `${baseUrl}/v1/marketplace/templates?repositoryId=${repositoryId}`,
      { headers: headers() },
    );
    const refreshed = (await refreshedCatalog.json()) as Array<{
      id: string;
      installed: boolean;
    }>;
    expect(refreshed.find((item) => item.id === template.id)?.installed).toBe(
      true,
    );
  });

  it("rejects malformed, unknown, and unavailable architecture templates", async () => {
    const { baseUrl } = await startTestServer();
    const catalogResponse = await fetch(
      `${baseUrl}/v1/marketplace/templates?repositoryId=invalid`,
      { headers: headers() },
    );
    expect(catalogResponse.status).toBe(400);

    const installUrl = `${baseUrl}/v1/repositories/${repositoryId}/marketplace/templates`;
    const missingRepository = await fetch(installUrl, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ templateId: "layered-backend" }),
    });
    expect(missingRepository.status).toBe(404);

    const malformedRequest = await fetch(installUrl, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ templateId: "not valid" }),
    });
    expect(malformedRequest.status).toBe(400);

    const put = await fetch(
      `${baseUrl}/v1/repositories/${repositoryId}/graph`,
      {
        method: "PUT",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify(createSnapshot()),
      },
    );
    expect(put.status).toBe(204);

    const unknownTemplate = await fetch(installUrl, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ templateId: "missing-template" }),
    });
    expect(unknownTemplate.status).toBe(404);
    expect(await unknownTemplate.json()).toEqual({
      error: "architecture_template_not_found",
    });
  });

  it("evaluates architecture rules against the saved graph with evidence", async () => {
    const { baseUrl } = await startTestServer();
    const original = createSnapshot();
    const secondEntityId = "8201f145-13bb-4a40-8d28-2e99458ab8bb";
    const componentId = "b4a1d2e3-7f6a-4a5b-8c9d-0123456789ab";
    const secondRelationshipId = "ae94e1f3-8a77-4de6-9957-562e07163ddd";
    const mappingId = "be94e1f3-8a77-4de6-9957-562e07163ddd";
    const graph = {
      ...original,
      entities: [
        { ...original.entities[0]!, kind: "file" as const, name: "a.ts" },
        {
          ...original.entities[0]!,
          id: secondEntityId,
          kind: "file" as const,
          name: "b.ts",
        },
        {
          ...original.entities[0]!,
          id: componentId,
          kind: "component" as const,
          name: "Core",
          state: "intended" as const,
        },
      ],
      relationships: [
        {
          id: "9e94e1f3-8a77-4de6-9957-562e07163ddd",
          sourceEntityId: entityId,
          targetEntityId: secondEntityId,
          type: "IMPORTS",
          state: "actual" as const,
          evidenceIds: [evidenceId],
        },
        {
          id: secondRelationshipId,
          sourceEntityId: secondEntityId,
          targetEntityId: entityId,
          type: "DEPENDS_ON",
          state: "actual" as const,
          evidenceIds: [evidenceId],
        },
        {
          id: mappingId,
          sourceEntityId: componentId,
          targetEntityId: entityId,
          type: "MAPS_TO",
          state: "intended" as const,
          evidenceIds: [evidenceId],
        },
      ],
    };
    const put = await fetch(
      `${baseUrl}/v1/repositories/${repositoryId}/graph`,
      {
        method: "PUT",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify(graph),
      },
    );
    expect(put.status).toBe(204);

    const response = await fetch(
      `${baseUrl}/v1/repositories/${repositoryId}/architecture-rules`,
      { headers: headers() },
    );
    expect(response.status).toBe(200);
    const evaluation = architectureRuleEvaluationSchema.parse(
      await response.json(),
    );
    expect(evaluation).toMatchObject({
      repositoryId,
      revision: graph.revision,
      ruleSetVersion: "1.1.0",
    });
    expect(evaluation.findings).toContainEqual(
      expect.objectContaining({
        ruleId: "dependency-cycle",
        relationshipIds: [
          "9e94e1f3-8a77-4de6-9957-562e07163ddd",
          secondRelationshipId,
        ],
        evidenceIds: [evidenceId],
      }),
    );
    expect(evaluation.findings).not.toContainEqual(
      expect.objectContaining({ ruleId: "unmapped-intended-component" }),
    );
  });

  it("validates the architecture rule repository and requires a saved graph", async () => {
    const { baseUrl } = await startTestServer();
    const invalidRepositoryId = await fetch(
      `${baseUrl}/v1/repositories/invalid/architecture-rules`,
      { headers: headers() },
    );
    expect(invalidRepositoryId.status).toBe(400);

    const missingGraph = await fetch(
      `${baseUrl}/v1/repositories/${repositoryId}/architecture-rules`,
      { headers: headers() },
    );
    expect(missingGraph.status).toBe(404);
  });

  it("creates intended components and idempotent mappings to actual code", async () => {
    const { baseUrl } = await startTestServer();
    const graphUrl = `${baseUrl}/v1/repositories/${repositoryId}/graph`;
    const original = createSnapshot();
    const actualGraph = {
      ...original,
      entities: [
        {
          ...original.entities[0]!,
          kind: "file" as const,
          name: "src/index.ts",
        },
      ],
    };
    const put = await fetch(graphUrl, {
      method: "PUT",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify(actualGraph),
    });
    expect(put.status).toBe(204);

    const invalidCreate = await fetch(
      `${baseUrl}/v1/repositories/${repositoryId}/intended-components`,
      {
        method: "POST",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify({ name: "   " }),
      },
    );
    expect(invalidCreate.status).toBe(400);

    const create = await fetch(
      `${baseUrl}/v1/repositories/${repositoryId}/intended-components`,
      {
        method: "POST",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify({ name: " Core services " }),
      },
    );
    expect(create.status).toBe(200);
    const createdSnapshot = await create.json();
    const component = createdSnapshot.entities.find(
      (entity: { kind: string; state: string }) =>
        entity.kind === "component" && entity.state === "intended",
    );
    expect(component).toMatchObject({
      name: "Core services",
      state: "intended",
      evidenceIds: [expect.any(String)],
    });
    expect(
      createdSnapshot.evidence.find(
        (item: { id: string }) => item.id === component.evidenceIds[0],
      ),
    ).toMatchObject({ origin: "developer" });

    const mappingsUrl = `${baseUrl}/v1/repositories/${repositoryId}/intended-components/${component.id}/mappings`;
    const missingEntity = await fetch(mappingsUrl, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({
        entityId: "a1b2c3d4-e5f6-4789-8abc-1234567890ab",
      }),
    });
    expect(missingEntity.status).toBe(404);
    expect(await missingEntity.json()).toEqual({
      error: "actual_entity_not_found",
    });

    const mappingBody = JSON.stringify({ entityId });
    const map = async () =>
      fetch(mappingsUrl, {
        method: "POST",
        headers: { ...headers(), "content-type": "application/json" },
        body: mappingBody,
      });
    const firstMapping = await map();
    expect(firstMapping.status).toBe(200);
    const mappedSnapshot = await firstMapping.json();
    expect(mappedSnapshot.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceEntityId: component.id,
          targetEntityId: entityId,
          type: "MAPS_TO",
          state: "intended",
        }),
      ]),
    );

    const repeatedMapping = await map();
    expect(repeatedMapping.status).toBe(200);
    const repeatedSnapshot = await repeatedMapping.json();
    expect(
      repeatedSnapshot.relationships.filter(
        (relationship: { type: string }) => relationship.type === "MAPS_TO",
      ),
    ).toHaveLength(1);

    const removeMapping = await fetch(`${mappingsUrl}/${entityId}`, {
      method: "DELETE",
      headers: headers(),
    });
    expect(removeMapping.status).toBe(200);
    const unmappedSnapshot = await removeMapping.json();
    expect(
      unmappedSnapshot.relationships.some(
        (relationship: { type: string; targetEntityId: string }) =>
          relationship.type === "MAPS_TO" &&
          relationship.targetEntityId === entityId,
      ),
    ).toBe(false);
    expect(
      unmappedSnapshot.evidence.some((item: { description: string }) =>
        item.description.includes("Developer mapped"),
      ),
    ).toBe(false);
  });

  it("analyzes a local fixture through the authenticated agent and stores its graph", async () => {
    const { baseUrl } = await startTestServer();
    const root = await mkdtemp(join(tmpdir(), "codifier-agent-analysis-"));
    temporaryDirectories.push(root);
    await writeFile(
      join(root, "index.ts"),
      "export function greet(name: string) { return `Hello ${name}`; }\n",
    );

    const response = await fetch(`${baseUrl}/v1/analyze`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ rootPath: root, revision: "test-revision" }),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      coverage: {
        filesDiscovered: 1,
        supportedFiles: 1,
        analyzedFiles: 1,
        failedFiles: 0,
      },
      persisted: true,
    });
    expect(result.repositoryId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const graph = await fetch(
      `${baseUrl}/v1/repositories/${result.repositoryId}/graph`,
      { headers: headers() },
    );
    expect(graph.status).toBe(200);
    const firstSnapshot = await graph.json();
    expect(firstSnapshot).toMatchObject({
      repositoryId: result.repositoryId,
      revision: "test-revision",
      entities: expect.arrayContaining([
        expect.objectContaining({ kind: "file", name: "index.ts" }),
        expect.objectContaining({ kind: "symbol", name: "greet" }),
      ]),
    });

    const firstFunctionId = firstSnapshot.entities.find(
      (entity: { kind: string; name: string }) =>
        entity.kind === "symbol" && entity.name === "greet",
    ).id;
    const freshnessUrl = `${baseUrl}/v1/repositories/${result.repositoryId}/source-freshness`;
    const freshCheck = await fetch(freshnessUrl, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ rootPath: root, entityId: firstFunctionId }),
    });
    expect(freshCheck.status).toBe(200);
    expect(await freshCheck.json()).toMatchObject({ status: "current" });
    const createIntent = await fetch(
      `${baseUrl}/v1/repositories/${result.repositoryId}/intended-components`,
      {
        method: "POST",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify({ name: "Greeting service" }),
      },
    );
    expect(createIntent.status).toBe(200);
    const authoredSnapshot = await createIntent.json();
    const intendedComponent = authoredSnapshot.entities.find(
      (entity: { kind: string; state: string }) =>
        entity.kind === "component" && entity.state === "intended",
    );
    const createMapping = await fetch(
      `${baseUrl}/v1/repositories/${result.repositoryId}/intended-components/${intendedComponent.id}/mappings`,
      {
        method: "POST",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify({ entityId: firstFunctionId }),
      },
    );
    expect(createMapping.status).toBe(200);
    await writeFile(
      join(root, "index.ts"),
      "export function greet(name: string) { return `Hi ${name}`; }\n",
    );
    const staleCheck = await fetch(freshnessUrl, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ rootPath: root, entityId: firstFunctionId }),
    });
    expect(await staleCheck.json()).toMatchObject({ status: "stale" });
    const update = await fetch(
      `${baseUrl}/v1/repositories/${result.repositoryId}/analyze`,
      {
        method: "POST",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify({ rootPath: root, revision: "next-revision" }),
      },
    );
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({ persisted: true });

    const updatedGraph = await fetch(
      `${baseUrl}/v1/repositories/${result.repositoryId}/graph`,
      { headers: headers() },
    );
    const updatedSnapshot = await updatedGraph.json();
    expect(
      updatedSnapshot.entities.find(
        (entity: { kind: string; name: string }) =>
          entity.kind === "symbol" && entity.name === "greet",
      ).id,
    ).toBe(firstFunctionId);
    expect(updatedSnapshot.revision).toBe("next-revision");
    expect(updatedSnapshot.entities).toContainEqual(
      expect.objectContaining({
        id: intendedComponent.id,
        name: "Greeting service",
        state: "intended",
      }),
    );
    expect(updatedSnapshot.relationships).toContainEqual(
      expect.objectContaining({
        sourceEntityId: intendedComponent.id,
        targetEntityId: firstFunctionId,
        type: "MAPS_TO",
        state: "intended",
      }),
    );
  });

  it("captures Git commit and dirty working-tree context during analysis", async () => {
    const { baseUrl } = await startTestServer();
    const root = await mkdtemp(join(tmpdir(), "codifier-agent-git-"));
    temporaryDirectories.push(root);
    execFileSync("git", ["-C", root, "init", "--quiet"], {
      stdio: "ignore",
      windowsHide: true,
    });
    execFileSync("git", ["-C", root, "config", "user.name", "Codifier test"], {
      stdio: "ignore",
      windowsHide: true,
    });
    execFileSync(
      "git",
      ["-C", root, "config", "user.email", "codifier-test@example.invalid"],
      { stdio: "ignore", windowsHide: true },
    );
    await writeFile(join(root, "index.ts"), "export const value = 1;\n");
    execFileSync("git", ["-C", root, "add", "index.ts"], {
      stdio: "ignore",
      windowsHide: true,
    });
    execFileSync("git", ["-C", root, "commit", "--quiet", "-m", "initial"], {
      stdio: "ignore",
      windowsHide: true,
    });
    const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    await writeFile(join(root, "index.ts"), "export const value = 2;\n");

    const analyze = await fetch(`${baseUrl}/v1/analyze`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ rootPath: root }),
    });
    expect(analyze.status).toBe(200);
    const result = await analyze.json();
    expect(result).toMatchObject({ persisted: true });

    const graph = await fetch(
      `${baseUrl}/v1/repositories/${result.repositoryId}/graph`,
      { headers: headers() },
    );
    expect(graph.status).toBe(200);
    expect(await graph.json()).toMatchObject({
      revision: commit,
      gitContext: {
        commit,
        workingTree: "dirty",
      },
    });
  });

  it("does not replace a stored graph when repository analysis is incomplete", async () => {
    const { baseUrl } = await startTestServer();
    const root = await mkdtemp(join(tmpdir(), "codifier-agent-partial-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, "broken.ts"), "export function broken( {\n");
    const graphUrl = `${baseUrl}/v1/repositories/${repositoryId}/graph`;
    const original = createSnapshot("existing");
    const put = await fetch(graphUrl, {
      method: "PUT",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify(original),
    });
    expect(put.status).toBe(204);

    const analyze = await fetch(
      `${baseUrl}/v1/repositories/${repositoryId}/analyze`,
      {
        method: "POST",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify({ rootPath: root }),
      },
    );
    expect(analyze.status).toBe(200);
    expect(await analyze.json()).toMatchObject({
      persisted: false,
      coverage: { failedFiles: 1 },
      persistBlockers: [
        {
          reason: "failed_files",
          examples: [{ path: "broken.ts", code: "syntax_error" }],
        },
      ],
    });
    const get = await fetch(graphUrl, { headers: headers() });
    expect(await get.json()).toEqual(original);
  });

  it("runs analysis jobs and exposes their completed result", async () => {
    const { baseUrl } = await startTestServer();
    const root = await mkdtemp(join(tmpdir(), "codifier-agent-job-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, "index.ts"), "export const answer = 42;\n");

    const start = await fetch(`${baseUrl}/v1/analysis-jobs`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ rootPath: root, revision: "job-revision" }),
    });
    expect(start.status).toBe(202);
    const accepted = analysisJobSchema.parse(await start.json());
    expect(accepted).toMatchObject({
      status: "queued",
      progress: { phase: "inventory" },
    });

    const job = await waitForJob(baseUrl, accepted);

    expect(job).toMatchObject({
      status: "completed",
      progress: { phase: "complete" },
      result: {
        coverage: { analyzedFiles: 1 },
        persisted: true,
        changeSummary: {
          initialAnalysis: true,
          entities: { changed: 0, removed: 0 },
          relationships: { changed: 0, removed: 0 },
        },
      },
    });
    expect(job.result?.changeSummary?.entities.added).toBeGreaterThan(0);
    expect(job.result?.changeSummary?.relationships.added).toBeGreaterThan(0);
    const graph = await fetch(
      `${baseUrl}/v1/repositories/${accepted.repositoryId}/graph`,
      { headers: headers() },
    );
    expect(graph.status).toBe(200);
    expect(await graph.json()).toMatchObject({
      revision: "job-revision",
      entities: expect.arrayContaining([
        expect.objectContaining({ kind: "symbol", name: "answer" }),
      ]),
    });
  });

  it("summarizes graph deltas on refresh", async () => {
    const { baseUrl } = await startTestServer();
    const root = await mkdtemp(join(tmpdir(), "codifier-agent-job-refresh-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, "index.ts"), "export const answer = 42;\n");
    await writeFile(join(root, "obsolete.ts"), "export const oldValue = 1;\n");

    const startAnalysis = async (revision: string) => {
      const response = await fetch(
        `${baseUrl}/v1/repositories/${repositoryId}/analysis-jobs`,
        {
          method: "POST",
          headers: { ...headers(), "content-type": "application/json" },
          body: JSON.stringify({ rootPath: root, revision }),
        },
      );
      expect(response.status).toBe(202);
      return analysisJobSchema.parse(await response.json());
    };

    const initialJob = await waitForJob(
      baseUrl,
      await startAnalysis("initial-revision"),
    );
    expect(initialJob.result?.changeSummary?.initialAnalysis).toBe(true);

    await writeFile(join(root, "index.ts"), "export const answer = 43;\n");
    await rm(join(root, "obsolete.ts"));
    await writeFile(join(root, "added.ts"), "export const newValue = 2;\n");

    const refreshJob = await waitForJob(
      baseUrl,
      await startAnalysis("refresh-revision"),
    );
    expect(refreshJob).toMatchObject({
      status: "completed",
      result: {
        persisted: true,
        changeSummary: { initialAnalysis: false },
      },
    });
    expect(refreshJob.result?.changeSummary?.entities.added).toBeGreaterThan(0);
    expect(refreshJob.result?.changeSummary?.entities.changed).toBeGreaterThan(
      0,
    );
    expect(refreshJob.result?.changeSummary?.entities.removed).toBeGreaterThan(
      0,
    );
    expect(
      refreshJob.result?.changeSummary?.relationships.added,
    ).toBeGreaterThan(0);
    expect(
      refreshJob.result?.changeSummary?.relationships.removed,
    ).toBeGreaterThan(0);
  });

  it("omits change summaries when an analysis job is not persisted", async () => {
    const { baseUrl } = await startTestServer();
    const root = await mkdtemp(join(tmpdir(), "codifier-agent-job-partial-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, "broken.ts"), "export function broken( {\n");
    const graphUrl = `${baseUrl}/v1/repositories/${repositoryId}/graph`;
    const original = createSnapshot("preserve-on-partial-job");
    const put = await fetch(graphUrl, {
      method: "PUT",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify(original),
    });
    expect(put.status).toBe(204);

    const start = await fetch(
      `${baseUrl}/v1/repositories/${repositoryId}/analysis-jobs`,
      {
        method: "POST",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify({ rootPath: root }),
      },
    );
    expect(start.status).toBe(202);
    const job = await waitForJob(
      baseUrl,
      analysisJobSchema.parse(await start.json()),
    );

    expect(job).toMatchObject({
      status: "completed",
      result: {
        persisted: false,
        coverage: { failedFiles: 1 },
        persistBlockers: [
          {
            reason: "failed_files",
            examples: [{ path: "broken.ts", code: "syntax_error" }],
          },
        ],
      },
    });
    expect(job.result).not.toHaveProperty("changeSummary");
    const savedGraph = await fetch(graphUrl, { headers: headers() });
    expect(await savedGraph.json()).toEqual(original);
  });

  it("reports analysis job failures with an actionable error", async () => {
    const { baseUrl } = await startTestServer();
    const root = await mkdtemp(join(tmpdir(), "codifier-agent-job-failure-"));
    temporaryDirectories.push(root);
    const start = await fetch(`${baseUrl}/v1/analysis-jobs`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ rootPath: join(root, "missing") }),
    });
    expect(start.status).toBe(202);
    const accepted = await start.json();

    let job = accepted;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (job.status === "failed" || job.status === "completed") {
        break;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      const response = await fetch(
        `${baseUrl}/v1/analysis-jobs/${accepted.id}`,
        { headers: headers() },
      );
      job = await response.json();
    }

    expect(job).toMatchObject({
      status: "failed",
      progress: { phase: "failed" },
      error: "Repository root does not exist or cannot be accessed.",
    });
  });

  it("cancels a job without replacing the previously saved graph", async () => {
    const { baseUrl } = await startTestServer();
    const root = await mkdtemp(join(tmpdir(), "codifier-agent-cancel-"));
    temporaryDirectories.push(root);
    await Promise.all(
      Array.from({ length: 800 }, (_, index) =>
        writeFile(
          join(root, `file-${index}.ts`),
          `export const value${index} = ${index};\n`,
        ),
      ),
    );
    const graphUrl = `${baseUrl}/v1/repositories/${repositoryId}/graph`;
    const original = createSnapshot("preserve-on-cancel");
    const put = await fetch(graphUrl, {
      method: "PUT",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify(original),
    });
    expect(put.status).toBe(204);

    const start = await fetch(
      `${baseUrl}/v1/repositories/${repositoryId}/analysis-jobs`,
      {
        method: "POST",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify({ rootPath: root }),
      },
    );
    expect(start.status).toBe(202);
    const accepted = await start.json();

    const cancel = await fetch(`${baseUrl}/v1/analysis-jobs/${accepted.id}`, {
      method: "DELETE",
      headers: headers(),
    });
    expect(cancel.status).toBe(200);

    let job = await cancel.json();
    for (
      let attempt = 0;
      attempt < 200 && job.status !== "cancelled";
      attempt += 1
    ) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      const response = await fetch(
        `${baseUrl}/v1/analysis-jobs/${accepted.id}`,
        { headers: headers() },
      );
      job = await response.json();
    }

    expect(job).toMatchObject({
      status: "cancelled",
      progress: { phase: "cancelled" },
    });
    const savedGraph = await fetch(graphUrl, { headers: headers() });
    expect(await savedGraph.json()).toEqual(original);
  });

  it("authenticates WebSocket subscribers and publishes graph updates", async () => {
    const { baseUrl } = await startTestServer();
    const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/v1/events`, {
      headers: headers(),
    });
    const connectedMessagePromise = new Promise<string>((resolve, reject) => {
      socket.once("message", (message) => resolve(message.toString()));
      socket.once("error", reject);
      socket.once("unexpected-response", (_request, response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          reject(
            new Error(
              `WebSocket rejected with ${response.statusCode}: ${Buffer.concat(chunks).toString()}`,
            ),
          ),
        );
      });
    });
    const connectedMessage = await connectedMessagePromise;
    expect(JSON.parse(connectedMessage)).toEqual({
      type: "connected",
    });

    const updateMessagePromise = once(socket, "message");
    const response = await fetch(
      `${baseUrl}/v1/repositories/${repositoryId}/graph`,
      {
        method: "PUT",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify(createSnapshot()),
      },
    );
    expect(response.status).toBe(204);

    const [updateMessage] = await updateMessagePromise;
    expect(JSON.parse(updateMessage.toString())).toEqual({
      type: "graph.updated",
      repositoryId,
      revision: "a1b2c3d",
    });

    socket.close();
  });

  it("rejects WebSocket subscribers without a valid bearer token", async () => {
    const { baseUrl } = await startTestServer();
    const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/v1/events`, {
      headers: headers("invalid-token"),
    });
    const responseStatus = new Promise<number>((resolve, reject) => {
      socket.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      socket.once("open", () =>
        reject(new Error("Unauthenticated WebSocket unexpectedly connected.")),
      );
      socket.once("error", reject);
    });

    await expect(responseStatus).resolves.toBe(401);
  });
});
