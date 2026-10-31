import websocket from "@fastify/websocket";
import { randomUUID } from "node:crypto";
import type {
  GraphEntity,
  GraphRelationship,
  GraphSnapshot,
} from "@codifier/domain";
import { evaluateArchitectureRules } from "@codifier/domain";
import {
  analysisJobSchema,
  type AnalysisChangeSummary,
  type AnalysisJob,
  type AnalysisJobResult,
  analyzeRepositoryRequestSchema,
  graphSnapshotSchema,
  installArchitectureTemplateRequestSchema,
  intendedComponentMappingRequestSchema,
  intendedComponentRequestSchema,
  sourceFreshnessRequestSchema,
} from "@codifier/contracts";
import {
  analyzeRepository,
  preserveIntendedGraphItems,
  RepositoryAnalysisCancelledError,
  RepositoryAnalysisError,
  validateSourceFreshness,
} from "@codifier/analysis-core";
import { EventEmitter } from "node:events";
import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import type { GraphStore, PersistedAnalysisJob } from "@codifier/storage";
import { readGitContext } from "./git-context.js";
import {
  findArchitectureTemplate,
  listArchitectureTemplates,
  templateComponentEntityId,
  templateComponentEvidence,
} from "./marketplace/catalog.js";

export interface AgentServerOptions {
  token: string;
  store: GraphStore;
  host?: string;
  port?: number;
  allowedOrigins?: string[];
  logLevel?: string;
}

interface RepositoryParams {
  repositoryId: string;
}

interface IntendedComponentParams extends RepositoryParams {
  componentId: string;
}

interface AnalysisJobParams {
  jobId: string;
}

interface AnalysisJobRecord {
  value: AnalysisJob;
  controller: AbortController;
  request: {
    rootPath: string;
    revision: string | null;
    excludePatterns?: string[];
    respectGitignore?: boolean;
  };
  lastPersistedAt: number;
  lastPersistedPhase: AnalysisJob["progress"]["phase"];
}

const maxActiveAnalysisJobs = 2;
const maxRetainedAnalysisJobs = 50;

export function createAgentServer(
  options: AgentServerOptions,
): FastifyInstance {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4141;
  const allowedOrigins = new Set(
    (options.allowedOrigins ?? []).map(normalizeAllowedOrigin),
  );
  const events = new EventEmitter();
  const analysisJobs = new Map<string, AnalysisJobRecord>();
  const activeJobPromises = new Set<Promise<void>>();

  if (host !== "127.0.0.1") {
    throw new Error("The local agent must bind to 127.0.0.1.");
  }
  if (Buffer.byteLength(options.token, "utf8") < 32) {
    throw new Error("CODIFIER_AGENT_TOKEN must contain at least 32 bytes.");
  }

  const app = Fastify({
    bodyLimit: 1_048_576,
    logger: {
      level: options.logLevel ?? "info",
      redact: {
        paths: ["req.headers.authorization"],
        remove: true,
      },
    },
  });

  for (const stored of options.store
    .listAnalysisJobs(maxRetainedAnalysisJobs)
    .reverse()) {
    try {
      const value = analysisJobSchema.parse(JSON.parse(stored.jobJson));
      const parsedRequest = analyzeRepositoryRequestSchema.safeParse(
        JSON.parse(stored.requestJson),
      );
      if (!parsedRequest.success) {
        options.store.deleteAnalysisJob(stored.id);
        continue;
      }
      const record: AnalysisJobRecord = {
        value,
        controller: new AbortController(),
        request: {
          rootPath: parsedRequest.data.rootPath,
          revision: parsedRequest.data.revision ?? null,
          ...(parsedRequest.data.excludePatterns
            ? { excludePatterns: parsedRequest.data.excludePatterns }
            : {}),
          ...(parsedRequest.data.respectGitignore !== undefined
            ? { respectGitignore: parsedRequest.data.respectGitignore }
            : {}),
        },
        lastPersistedAt: stored.updatedAt,
        lastPersistedPhase: value.progress.phase,
      };
      if (isActiveJob(value.status)) {
        value.status = "failed";
        value.progress = {
          phase: "failed",
          currentFile: null,
          completedFiles: value.progress.completedFiles,
          totalFiles: value.progress.totalFiles,
        };
        value.error =
          "The local agent restarted before this analysis finished. Retry the analysis to resume from the last committed graph.";
      }
      analysisJobs.set(value.id, record);
      persistAnalysisJob(options.store, record);
    } catch (error) {
      app.log.warn(
        { err: error, analysisJobId: stored.id },
        "A persisted analysis job could not be restored.",
      );
      options.store.deleteAnalysisJob(stored.id);
    }
  }

  app.register(websocket, { options: { maxPayload: 65_536 } });

  app.addHook("onRequest", async (request, reply) => {
    const requestOrigin = request.headers.origin;
    const origin = requestOrigin ? normalizeRequestOrigin(requestOrigin) : null;

    if (requestOrigin && (!origin || !allowedOrigins.has(origin))) {
      return reply.code(403).send({ error: "origin_not_allowed" });
    }

    if (!isExpectedHost(request, port)) {
      return reply.code(400).send({ error: "host_not_allowed" });
    }

    if (origin) {
      reply.header("access-control-allow-origin", origin);
      reply.header("vary", "Origin");
    }

    if (request.method === "OPTIONS") {
      if (!origin) {
        return reply.code(403).send({ error: "origin_not_allowed" });
      }
      return reply
        .header(
          "access-control-allow-methods",
          "GET, PUT, POST, DELETE, OPTIONS",
        )
        .header("access-control-allow-headers", "authorization, content-type")
        .header("access-control-max-age", "600")
        .code(204)
        .send();
    }

    const authorization = request.headers.authorization;
    if (!authorization || !hasValidBearerToken(authorization, options.token)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.addHook("onClose", async () => {
    for (const job of analysisJobs.values()) {
      if (isActiveJob(job.value.status)) {
        job.controller.abort();
      }
    }
    await Promise.allSettled(activeJobPromises);
  });

  app.get("/v1/health", async () => ({ status: "ok" }));

  app.get<{ Querystring: { repositoryId?: string } }>(
    "/v1/marketplace/templates",
    async (request, reply) => {
      const repositoryId = request.query.repositoryId
        ? parseRepositoryId(request.query.repositoryId)
        : undefined;
      if (request.query.repositoryId && !repositoryId) {
        return reply.code(400).send({ error: "invalid_repository_id" });
      }

      const snapshot = repositoryId
        ? options.store.getGraph(repositoryId)
        : undefined;
      if (repositoryId && !snapshot) {
        return reply.code(404).send({ error: "repository_not_found" });
      }
      return listArchitectureTemplates(snapshot ?? undefined);
    },
  );

  app.get<{ Params: RepositoryParams }>(
    "/v1/repositories/:repositoryId/architecture-rules",
    async (request, reply) => {
      const repositoryId = parseRepositoryId(request.params.repositoryId);
      if (!repositoryId) {
        return reply.code(400).send({ error: "invalid_repository_id" });
      }

      const snapshot = options.store.getGraph(repositoryId);
      if (!snapshot) {
        return reply.code(404).send({ error: "repository_not_found" });
      }
      return evaluateArchitectureRules(snapshot);
    },
  );

  app.post<{ Params: RepositoryParams }>(
    "/v1/repositories/:repositoryId/source-freshness",
    async (request, reply) => {
      const repositoryId = parseRepositoryId(request.params.repositoryId);
      if (!repositoryId) {
        return reply.code(400).send({ error: "invalid_repository_id" });
      }
      const parsed = sourceFreshnessRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_source_freshness_request" });
      }
      const snapshot = options.store.getGraph(repositoryId);
      if (!snapshot) {
        return reply.code(404).send({ error: "repository_not_found" });
      }
      return validateSourceFreshness(
        parsed.data.rootPath,
        snapshot,
        parsed.data.entityId,
      );
    },
  );

  app.post<{ Params: RepositoryParams }>(
    "/v1/repositories/:repositoryId/marketplace/templates",
    async (request, reply) => {
      const repositoryId = parseRepositoryId(request.params.repositoryId);
      if (!repositoryId) {
        return reply.code(400).send({ error: "invalid_repository_id" });
      }
      const parsed = installArchitectureTemplateRequestSchema.safeParse(
        request.body,
      );
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_architecture_template_request",
          issues: parsed.error.issues.map(({ path, message }) => ({
            path,
            message,
          })),
        });
      }

      const template = findArchitectureTemplate(parsed.data.templateId);
      if (!template) {
        return reply
          .code(404)
          .send({ error: "architecture_template_not_found" });
      }
      const snapshot = options.store.getGraph(repositoryId);
      if (!snapshot) {
        return reply.code(404).send({ error: "repository_not_found" });
      }

      const entities = [...snapshot.entities];
      const evidenceItems = [...snapshot.evidence];
      let changed = false;
      for (const component of template.components) {
        const entityId = templateComponentEntityId(
          repositoryId,
          template.id,
          component.id,
        );
        const expectedEvidence = templateComponentEvidence(
          repositoryId,
          template.id,
          component.id,
          template.version,
          component.description,
        );
        const existingEntity = entities.find(
          (entity) => entity.id === entityId,
        );
        const existingEvidence = evidenceItems.find(
          (evidence) => evidence.id === expectedEvidence.id,
        );

        if (
          (existingEntity &&
            (existingEntity.kind !== "component" ||
              existingEntity.state !== "intended" ||
              existingEntity.name !== component.name ||
              !existingEntity.evidenceIds.includes(expectedEvidence.id))) ||
          (existingEvidence &&
            (existingEvidence.origin !== expectedEvidence.origin ||
              existingEvidence.description !== expectedEvidence.description))
        ) {
          return reply.code(409).send({
            error: "architecture_template_identity_conflict",
          });
        }

        if (!existingEvidence) {
          evidenceItems.push(expectedEvidence);
          changed = true;
        }
        if (!existingEntity) {
          entities.push({
            id: entityId,
            kind: "component",
            name: component.name,
            state: "intended",
            evidenceIds: [expectedEvidence.id],
          });
          changed = true;
        }
      }

      if (!changed) {
        return snapshot;
      }
      const updatedSnapshot: GraphSnapshot = {
        ...snapshot,
        entities,
        evidence: evidenceItems,
      };
      options.store.replaceGraph(updatedSnapshot);
      const persistedSnapshot = options.store.getGraph(repositoryId);
      if (!persistedSnapshot) {
        throw new Error(
          "The repository graph was unavailable after template installation.",
        );
      }
      events.emit("graph.updated", repositoryId, persistedSnapshot.revision);
      return persistedSnapshot;
    },
  );

  app.get<{ Params: RepositoryParams }>(
    "/v1/repositories/:repositoryId/graph",
    async (request, reply) => {
      const repositoryId = parseRepositoryId(request.params.repositoryId);
      if (!repositoryId) {
        return reply.code(400).send({ error: "invalid_repository_id" });
      }

      const snapshot = options.store.getGraph(repositoryId);
      if (!snapshot) {
        return reply.code(404).send({ error: "repository_not_found" });
      }

      return snapshot;
    },
  );

  app.get<{ Params: RepositoryParams }>(
    "/v1/repositories/:repositoryId/revisions",
    async (request, reply) => {
      const repositoryId = parseRepositoryId(request.params.repositoryId);
      if (!repositoryId) {
        return reply.code(400).send({ error: "invalid_repository_id" });
      }
      if (!options.store.getGraph(repositoryId)) {
        return reply.code(404).send({ error: "repository_not_found" });
      }
      return { revisions: options.store.listGraphRevisions(repositoryId) };
    },
  );

  app.get<{ Params: RepositoryParams & { revisionId: string } }>(
    "/v1/repositories/:repositoryId/revisions/:revisionId",
    async (request, reply) => {
      const repositoryId = parseRepositoryId(request.params.repositoryId);
      const revisionId = parseRepositoryId(request.params.revisionId);
      if (!repositoryId || !revisionId) {
        return reply.code(400).send({ error: "invalid_revision_identifier" });
      }
      const snapshot = options.store.getGraphRevision(repositoryId, revisionId);
      if (!snapshot) {
        return reply.code(404).send({ error: "graph_revision_not_found" });
      }
      return snapshot;
    },
  );

  app.put<{ Params: RepositoryParams }>(
    "/v1/repositories/:repositoryId/graph",
    async (request, reply) => {
      const repositoryId = parseRepositoryId(request.params.repositoryId);
      if (!repositoryId) {
        return reply.code(400).send({ error: "invalid_repository_id" });
      }

      const parsed = graphSnapshotSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_graph_snapshot",
          issues: parsed.error.issues.map(({ path, message }) => ({
            path,
            message,
          })),
        });
      }

      if (parsed.data.repositoryId !== repositoryId) {
        return reply.code(400).send({ error: "repository_id_mismatch" });
      }

      options.store.replaceGraph(parsed.data);
      events.emit("graph.updated", repositoryId, parsed.data.revision);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: RepositoryParams }>(
    "/v1/repositories/:repositoryId/intended-components",
    async (request, reply) => {
      const repositoryId = parseRepositoryId(request.params.repositoryId);
      if (!repositoryId) {
        return reply.code(400).send({ error: "invalid_repository_id" });
      }
      const parsed = intendedComponentRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_intended_component",
          issues: parsed.error.issues.map(({ path, message }) => ({
            path,
            message,
          })),
        });
      }
      const snapshot = options.store.getGraph(repositoryId);
      if (!snapshot) {
        return reply.code(404).send({ error: "repository_not_found" });
      }

      const evidenceId = randomUUID();
      const component: GraphEntity = {
        id: randomUUID(),
        kind: "component",
        name: parsed.data.name,
        state: "intended",
        evidenceIds: [evidenceId],
      };
      const evidence = {
        id: evidenceId,
        origin: "developer" as const,
        description: "Developer-authored intended component.",
      };
      const updatedSnapshot: GraphSnapshot = {
        ...snapshot,
        entities: [...snapshot.entities, component],
        evidence: [...snapshot.evidence, evidence],
      };
      options.store.replaceGraph(updatedSnapshot);
      events.emit("graph.updated", repositoryId, updatedSnapshot.revision);
      return updatedSnapshot;
    },
  );

  app.post<{ Params: IntendedComponentParams }>(
    "/v1/repositories/:repositoryId/intended-components/:componentId/mappings",
    async (request, reply) => {
      const repositoryId = parseRepositoryId(request.params.repositoryId);
      if (!repositoryId) {
        return reply.code(400).send({ error: "invalid_repository_id" });
      }
      const componentId = parseRepositoryId(request.params.componentId);
      if (!componentId) {
        return reply.code(400).send({ error: "invalid_component_id" });
      }
      const parsed = intendedComponentMappingRequestSchema.safeParse(
        request.body,
      );
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_intended_component_mapping",
          issues: parsed.error.issues.map(({ path, message }) => ({
            path,
            message,
          })),
        });
      }
      const snapshot = options.store.getGraph(repositoryId);
      if (!snapshot) {
        return reply.code(404).send({ error: "repository_not_found" });
      }

      const component = snapshot.entities.find(
        (entity) => entity.id === componentId,
      );
      if (
        !component ||
        component.kind !== "component" ||
        component.state !== "intended"
      ) {
        return reply.code(404).send({ error: "intended_component_not_found" });
      }
      const actualEntity = snapshot.entities.find(
        (entity) => entity.id === parsed.data.entityId,
      );
      if (
        !actualEntity ||
        actualEntity.state !== "actual" ||
        (actualEntity.kind !== "file" && actualEntity.kind !== "symbol")
      ) {
        return reply.code(404).send({ error: "actual_entity_not_found" });
      }

      const existingMapping = snapshot.relationships.find(
        (relationship) =>
          relationship.sourceEntityId === componentId &&
          relationship.targetEntityId === actualEntity.id &&
          relationship.type === "MAPS_TO" &&
          relationship.state === "intended",
      );
      if (existingMapping) {
        return snapshot;
      }

      const evidenceId = randomUUID();
      const evidence = {
        id: evidenceId,
        origin: "developer" as const,
        description: `Developer mapped "${actualEntity.name}" to intended component "${component.name}".`,
      };
      const relationship: GraphRelationship = {
        id: randomUUID(),
        sourceEntityId: component.id,
        targetEntityId: actualEntity.id,
        type: "MAPS_TO",
        state: "intended",
        evidenceIds: [evidenceId],
      };
      const updatedSnapshot: GraphSnapshot = {
        ...snapshot,
        evidence: [...snapshot.evidence, evidence],
        relationships: [...snapshot.relationships, relationship],
      };
      options.store.replaceGraph(updatedSnapshot);
      events.emit("graph.updated", repositoryId, updatedSnapshot.revision);
      return updatedSnapshot;
    },
  );

  app.delete<{ Params: IntendedComponentParams & { entityId: string } }>(
    "/v1/repositories/:repositoryId/intended-components/:componentId/mappings/:entityId",
    async (request, reply) => {
      const repositoryId = parseRepositoryId(request.params.repositoryId);
      const componentId = parseRepositoryId(request.params.componentId);
      const entityId = parseRepositoryId(request.params.entityId);
      if (!repositoryId || !componentId || !entityId) {
        return reply.code(400).send({ error: "invalid_mapping_identifier" });
      }
      const snapshot = options.store.getGraph(repositoryId);
      if (!snapshot) return reply.code(404).send({ error: "repository_not_found" });
      const mapping = snapshot.relationships.find(
        (relationship) =>
          relationship.sourceEntityId === componentId &&
          relationship.targetEntityId === entityId &&
          relationship.type === "MAPS_TO" &&
          relationship.state === "intended",
      );
      if (!mapping) return reply.code(404).send({ error: "mapping_not_found" });
      const relationships = snapshot.relationships.filter(
        (relationship) => relationship.id !== mapping.id,
      );
      const referencedEvidenceIds = new Set([
        ...snapshot.entities.flatMap((entity) => entity.evidenceIds),
        ...relationships.flatMap((relationship) => relationship.evidenceIds),
      ]);
      const updatedSnapshot: GraphSnapshot = {
        ...snapshot,
        relationships,
        evidence: snapshot.evidence.filter((item) => referencedEvidenceIds.has(item.id)),
      };
      options.store.replaceGraph(updatedSnapshot);
      events.emit("graph.updated", repositoryId, updatedSnapshot.revision);
      return updatedSnapshot;
    },
  );

  app.post<{ Params: RepositoryParams }>(
    "/v1/repositories/:repositoryId/analyze",
    async (request, reply) => {
      const repositoryId = parseRepositoryId(request.params.repositoryId);
      if (!repositoryId) {
        return reply.code(400).send({ error: "invalid_repository_id" });
      }

      const parsed = analyzeRepositoryRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_analysis_request",
          issues: parsed.error.issues.map(({ path, message }) => ({
            path,
            message,
          })),
        });
      }

      try {
        const gitContext = await readGitContext(parsed.data.rootPath);
        const report = await analyzeRepository({
          repositoryId,
          repositoryRoot: parsed.data.rootPath,
          revision: parsed.data.revision ?? gitContext.commit,
          excludePatterns: parsed.data.excludePatterns,
          respectGitignore: parsed.data.respectGitignore,
          previousSnapshot: options.store.getGraph(repositoryId),
        });
        if (report.canPersist) {
          const previousSnapshot = options.store.getGraph(repositoryId);
          const snapshot = preserveIntendedGraphItems(
            { ...report.snapshot, gitContext },
            previousSnapshot,
          );
          options.store.replaceGraph(snapshot);
          events.emit("graph.updated", repositoryId, snapshot.revision);
        }
        return {
          repositoryId,
          coverage: report.coverage,
          diagnostics: report.diagnostics,
          diagnosticsTruncated: report.diagnosticsTruncated,
          persisted: report.canPersist,
          reconciliation: report.reconciliation,
        };
      } catch (error) {
        if (error instanceof RepositoryAnalysisError) {
          return reply
            .code(error.code === "repository_unavailable" ? 422 : 400)
            .send({ error: error.code, message: error.message });
        }
        throw error;
      }
    },
  );

  app.post("/v1/analyze", async (request, reply) => {
    const parsed = analyzeRepositoryRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_analysis_request",
        issues: parsed.error.issues.map(({ path, message }) => ({
          path,
          message,
        })),
      });
    }

    const repositoryId = randomUUID();
    try {
      const gitContext = await readGitContext(parsed.data.rootPath);
      const report = await analyzeRepository({
        repositoryId,
        repositoryRoot: parsed.data.rootPath,
        revision: parsed.data.revision ?? gitContext.commit,
        excludePatterns: parsed.data.excludePatterns,
        respectGitignore: parsed.data.respectGitignore,
        previousSnapshot: options.store.getGraph(repositoryId),
      });
      if (report.canPersist) {
        const previousSnapshot = options.store.getGraph(repositoryId);
        const snapshot = preserveIntendedGraphItems(
          { ...report.snapshot, gitContext },
          previousSnapshot,
        );
        options.store.replaceGraph(snapshot);
        events.emit("graph.updated", repositoryId, snapshot.revision);
      }
      return {
        repositoryId,
        coverage: report.coverage,
        diagnostics: report.diagnostics,
        diagnosticsTruncated: report.diagnosticsTruncated,
        persisted: report.canPersist,
        reconciliation: report.reconciliation,
      };
    } catch (error) {
      if (error instanceof RepositoryAnalysisError) {
        return reply
          .code(error.code === "repository_unavailable" ? 422 : 400)
          .send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.post<{ Params: RepositoryParams }>(
    "/v1/repositories/:repositoryId/analysis-jobs",
    async (request, reply) => {
      const repositoryId = parseRepositoryId(request.params.repositoryId);
      if (!repositoryId) {
        return reply.code(400).send({ error: "invalid_repository_id" });
      }
      const parsed = analyzeRepositoryRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_analysis_request",
          issues: parsed.error.issues.map(({ path, message }) => ({
            path,
            message,
          })),
        });
      }
      const job = createAnalysisJob(
        repositoryId,
        parsed.data.rootPath,
        parsed.data.revision ?? null,
      );
      if ("error" in job) {
        return reply.code(job.statusCode).send({ error: job.error });
      }
      return reply.code(202).send(job.value);
    },
  );

  app.post("/v1/analysis-jobs", async (request, reply) => {
    const parsed = analyzeRepositoryRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_analysis_request",
        issues: parsed.error.issues.map(({ path, message }) => ({
          path,
          message,
        })),
      });
    }
    const job = createAnalysisJob(
      randomUUID(),
      parsed.data.rootPath,
      parsed.data.revision ?? null,
    );
    if ("error" in job) {
      return reply.code(job.statusCode).send({ error: job.error });
    }
    return reply.code(202).send(job.value);
  });

  app.get<{ Params: AnalysisJobParams }>(
    "/v1/analysis-jobs/:jobId",
    async (request, reply) => {
      const record = analysisJobs.get(request.params.jobId);
      if (!record) {
        return reply.code(404).send({ error: "analysis_job_not_found" });
      }
      reply.header("cache-control", "no-store");
      return record.value;
    },
  );

  app.delete<{ Params: AnalysisJobParams }>(
    "/v1/analysis-jobs/:jobId",
    async (request, reply) => {
      const record = analysisJobs.get(request.params.jobId);
      if (!record) {
        return reply.code(404).send({ error: "analysis_job_not_found" });
      }
      if (isActiveJob(record.value.status)) {
        record.value.status = "cancelling";
        record.controller.abort();
        persistAnalysisJob(options.store, record);
      }
      reply.header("cache-control", "no-store");
      return record.value;
    },
  );

  app.register(async (websocketApp) => {
    websocketApp.get("/v1/events", { websocket: true }, (socket: WebSocket) => {
      const listener = (repositoryId: string, revision: string | null) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(
            JSON.stringify({
              type: "graph.updated",
              repositoryId,
              revision,
            }),
          );
        }
      };

      events.on("graph.updated", listener);
      socket.send(JSON.stringify({ type: "connected" }));
      socket.once("close", () => events.off("graph.updated", listener));
      socket.once("error", () => events.off("graph.updated", listener));
    });
  });

  return app;

  function createAnalysisJob(
    repositoryId: string,
    repositoryRoot: string,
    revision: string | null,
    excludePatterns?: string[],
    respectGitignore?: boolean,
  ): { value: AnalysisJob } | { error: string; statusCode: number } {
    if (
      [...analysisJobs.values()].some(
        ({ value }) =>
          value.repositoryId === repositoryId && isActiveJob(value.status),
      )
    ) {
      return { error: "analysis_already_running", statusCode: 409 };
    }
    const activeCount = [...analysisJobs.values()].filter(({ value }) =>
      isActiveJob(value.status),
    ).length;
    if (activeCount >= maxActiveAnalysisJobs) {
      return { error: "analysis_capacity_reached", statusCode: 503 };
    }
    pruneAnalysisJobs(analysisJobs, options.store);
    if (analysisJobs.size >= maxRetainedAnalysisJobs) {
      return { error: "analysis_job_capacity_reached", statusCode: 503 };
    }

    const controller = new AbortController();
    const value = analysisJobSchema.parse({
      id: randomUUID(),
      repositoryId,
      status: "queued",
      progress: {
        phase: "inventory",
        currentFile: null,
        completedFiles: 0,
        totalFiles: null,
      },
    });
    const record: AnalysisJobRecord = {
      value,
      controller,
      request: {
        rootPath: repositoryRoot,
        revision,
        ...(excludePatterns ? { excludePatterns } : {}),
        ...(respectGitignore !== undefined ? { respectGitignore } : {}),
      },
      lastPersistedAt: 0,
      lastPersistedPhase: "inventory",
    };
    analysisJobs.set(value.id, record);
    persistAnalysisJob(options.store, record);
    const task = new Promise<void>((resolveTask) => {
      setImmediate(resolveTask);
    }).then(() =>
      executeAnalysisJob(
        record,
        repositoryRoot,
        revision,
        excludePatterns,
        respectGitignore,
        options.store,
        events,
        app.log,
      ),
    );
    activeJobPromises.add(task);
    void task.then(
      () => activeJobPromises.delete(task),
      (error: unknown) => {
        app.log.error(
          { err: error, analysisJobId: value.id },
          "Analysis job execution failed outside its handler.",
        );
        activeJobPromises.delete(task);
      },
    );
    return { value: structuredClone(value) };
  }
}

async function executeAnalysisJob(
  record: AnalysisJobRecord,
  repositoryRoot: string,
  revision: string | null,
  excludePatterns: string[] | undefined,
  respectGitignore: boolean | undefined,
  store: GraphStore,
  events: EventEmitter,
  logger: FastifyInstance["log"],
): Promise<void> {
  if (record.controller.signal.aborted) {
    markJobCancelled(record.value);
    persistAnalysisJob(store, record);
    return;
  }
  record.value.status = "running";
  persistAnalysisJob(store, record);
  try {
    const previousSnapshot = store.getGraph(record.value.repositoryId);
    const gitContext = await readGitContext(repositoryRoot);
    const report = await analyzeRepository({
      repositoryId: record.value.repositoryId,
      repositoryRoot,
      revision: revision ?? gitContext.commit,
      excludePatterns,
      respectGitignore,
      previousSnapshot,
      signal: record.controller.signal,
      onProgress: (progress) => {
        if (record.value.status !== "cancelling") {
          record.value.status = "running";
        }
        record.value.progress = progress;
        if (
          record.lastPersistedPhase !== progress.phase ||
          Date.now() - record.lastPersistedAt >= 250
        ) {
          persistAnalysisJob(store, record);
        }
      },
    });
    if (record.controller.signal.aborted) {
      markJobCancelled(record.value);
      persistAnalysisJob(store, record);
      return;
    }

    let persisted = false;
    let persistedSnapshot = report.snapshot;
    let changeSummaryBase = previousSnapshot;
    if (report.canPersist) {
      record.value.progress = {
        phase: "persisting",
        currentFile: null,
        completedFiles: report.coverage.analyzedFiles,
        totalFiles: report.coverage.analyzedFiles,
      };
      persistAnalysisJob(store, record);
      if (record.controller.signal.aborted) {
        markJobCancelled(record.value);
        persistAnalysisJob(store, record);
        return;
      }
      changeSummaryBase = store.getGraph(record.value.repositoryId);
      persistedSnapshot = preserveIntendedGraphItems(
        { ...report.snapshot, gitContext },
        changeSummaryBase,
      );
      persisted = true;
    }
    const result: AnalysisJobResult = {
      coverage: report.coverage,
      diagnostics: report.diagnostics,
      diagnosticsTruncated: report.diagnosticsTruncated,
      persisted,
      reconciliation: report.reconciliation,
      ...(persisted
        ? {
            changeSummary: summarizeGraphChanges(
              changeSummaryBase,
              persistedSnapshot,
            ),
          }
        : {}),
    };
    record.value.result = result;
    record.value.status = "completed";
    record.value.progress = {
      phase: "complete",
      currentFile: null,
      completedFiles: report.coverage.analyzedFiles,
      totalFiles: report.coverage.analyzedFiles,
    };
    if (persisted) {
      store.replaceGraph(persistedSnapshot, persistedAnalysisJob(record));
      markAnalysisJobPersisted(record);
    } else {
      persistAnalysisJob(store, record);
    }
    if (persisted) {
      try {
        events.emit(
          "graph.updated",
          record.value.repositoryId,
          persistedSnapshot.revision,
        );
      } catch (error) {
        logger.warn(
          { err: error, analysisJobId: record.value.id },
          "Graph persisted, but notifying subscribers failed.",
        );
      }
    }
  } catch (error) {
    if (
      error instanceof RepositoryAnalysisCancelledError ||
      record.controller.signal.aborted
    ) {
      markJobCancelled(record.value);
      persistAnalysisJob(store, record);
      return;
    }
    logger.error(
      { err: error, analysisJobId: record.value.id },
      "Analysis job failed.",
    );
    record.value.status = "failed";
    record.value.progress = {
      phase: "failed",
      currentFile: null,
      completedFiles: record.value.progress.completedFiles,
      totalFiles: record.value.progress.totalFiles,
    };
    record.value.error =
      error instanceof RepositoryAnalysisError
        ? error.message
        : "Analysis failed unexpectedly. Check the local agent logs.";
    persistAnalysisJob(store, record);
  }
}

function summarizeGraphChanges(
  previousSnapshot: GraphSnapshot | null,
  currentSnapshot: GraphSnapshot,
): AnalysisChangeSummary {
  return {
    initialAnalysis: previousSnapshot === null,
    entities: compareGraphItems(
      previousSnapshot?.entities ?? [],
      currentSnapshot.entities,
    ),
    relationships: compareGraphItems(
      previousSnapshot?.relationships ?? [],
      currentSnapshot.relationships,
    ),
  };
}

function compareGraphItems<T extends GraphEntity | GraphRelationship>(
  previous: T[],
  current: T[],
): AnalysisChangeSummary["entities"] {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const currentById = new Map(current.map((item) => [item.id, item]));
  let changed = 0;
  for (const [id, currentItem] of currentById) {
    const previousItem = previousById.get(id);
    if (
      previousItem &&
      JSON.stringify(previousItem) !== JSON.stringify(currentItem)
    ) {
      changed += 1;
    }
  }
  return {
    added: [...currentById.keys()].filter((id) => !previousById.has(id)).length,
    changed,
    removed: [...previousById.keys()].filter((id) => !currentById.has(id))
      .length,
  };
}

function markJobCancelled(job: AnalysisJob): void {
  job.status = "cancelled";
  job.progress = {
    phase: "cancelled",
    currentFile: null,
    completedFiles: job.progress.completedFiles,
    totalFiles: job.progress.totalFiles,
  };
}

function persistAnalysisJob(
  store: GraphStore,
  record: AnalysisJobRecord,
): void {
  store.saveAnalysisJob(persistedAnalysisJob(record));
  markAnalysisJobPersisted(record);
}

function persistedAnalysisJob(
  record: AnalysisJobRecord,
): Omit<PersistedAnalysisJob, "updatedAt"> {
  return {
    id: record.value.id,
    repositoryId: record.value.repositoryId,
    status: record.value.status,
    jobJson: JSON.stringify(record.value),
    requestJson: JSON.stringify({
      rootPath: record.request.rootPath,
      revision: record.request.revision,
      ...(record.request.excludePatterns
        ? { excludePatterns: record.request.excludePatterns }
        : {}),
      ...(record.request.respectGitignore !== undefined
        ? { respectGitignore: record.request.respectGitignore }
        : {}),
    }),
  };
}

function markAnalysisJobPersisted(record: AnalysisJobRecord): void {
  record.lastPersistedAt = Date.now();
  record.lastPersistedPhase = record.value.progress.phase;
}

function pruneAnalysisJobs(
  jobs: Map<string, AnalysisJobRecord>,
  store: GraphStore,
): void {
  for (const [id, record] of jobs) {
    if (jobs.size < maxRetainedAnalysisJobs) {
      break;
    }
    if (!isActiveJob(record.value.status)) {
      jobs.delete(id);
      store.deleteAnalysisJob(id);
    }
  }
}

function isActiveJob(status: AnalysisJob["status"]): boolean {
  return status === "queued" || status === "running" || status === "cancelling";
}

function isExpectedHost(
  request: FastifyRequest,
  configuredPort: number,
): boolean {
  const hostHeader = request.headers.host;
  if (!hostHeader) {
    return false;
  }

  const match = /^(127\.0\.0\.1|localhost):(\d{1,5})$/i.exec(hostHeader);
  if (!match) {
    return false;
  }

  const address = request.server.server.address();
  const actualPort =
    configuredPort === 0 && address && typeof address !== "string"
      ? address.port
      : configuredPort;

  return Number(match[2]) === actualPort;
}

function normalizeAllowedOrigin(origin: string): string {
  const normalized = normalizeRequestOrigin(origin);
  if (!normalized) {
    throw new Error(`Invalid local agent origin: ${origin}`);
  }
  return normalized;
}

function normalizeRequestOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.origin !== origin
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function hasValidBearerToken(
  authorization: string,
  expectedToken: string,
): boolean {
  const match = /^Bearer ([\x21-\x7e]+)$/.exec(authorization);
  if (!match) {
    return false;
  }

  const actual = Buffer.from(match[1]!, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseRepositoryId(value: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : null;
}

export function parseGraphSnapshot(value: unknown): GraphSnapshot {
  return graphSnapshotSchema.parse(value);
}
