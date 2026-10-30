import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGraphStore } from "@codifier/storage";
import { analysisJobSchema, type AnalysisJob } from "@codifier/contracts";
import { createAgentServer } from "../src/server.js";
import { WebSocket } from "ws";
import type { FastifyInstance } from "fastify";

const token = "this-is-a-test-token-with-at-least-32-bytes";
const repositoryId = "7b9442d6-faaa-49f9-a39e-7de8a276a978";
const evidenceId = "05a4d48e-1e17-4ca7-9e03-773ea13d3561";
const entityId = "9ac38590-a7ac-4101-bfc9-dc323d1c9301";

const servers: FastifyInstance[] = [];
const stores: ReturnType<typeof openGraphStore>[] = [];
const temporaryDirectories: string[] = [];

async function startTestServer(): Promise<{
  app: FastifyInstance;
  baseUrl: string;
}> {
  const store = openGraphStore(":memory:");
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
    await writeFile(
      join(root, "index.ts"),
      "export function greet(name: string) { return `Hi ${name}`; }\n",
    );
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
