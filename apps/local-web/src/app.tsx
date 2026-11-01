import { lazy, Suspense, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type {
  Evidence,
  GitContext,
  GraphEntity,
  GraphRelationship,
  GraphSnapshot,
  SourceLocator,
} from "@codifier/domain";
import type {
  AnalysisJob,
  ArchitectureRuleEvaluation,
  ArchitectureRuleFinding,
  ArchitectureTemplate,
} from "@codifier/contracts";
import {
  cancelAnalysisJob,
  checkSourceFreshness,
  checkAgent,
  createIntendedComponent,
  exportGraphHistory,
  getArchitectureRuleEvaluation,
  getAnalysisJob,
  getGraph,
  installArchitectureTemplate,
  listArchitectureTemplates,
  listGraphRevisions,
  mapEntityToIntendedComponent,
  normalizeAgentUrl,
  removeEntityMapping,
  restoreGraphRevision,
  startAnalysisJob,
  type GraphRevisionSummary,
  type SourceFreshness,
  type AnalysisResult,
} from "./agent/client.js";
import { lookupEntitiesAtSourceLocation } from "./navigation/source-lookup.js";
import { createVscodeUri } from "./navigation/vscode.js";

const defaultAgentUrl = "http://127.0.0.1:4141";
const maxVisibleEntities = 250;
const NeighborhoodMap = lazy(() =>
  import("./graph/neighborhood-map.js").then((module) => ({
    default: module.NeighborhoodMap,
  })),
);

export function App() {
  const [agentUrl, setAgentUrl] = useState(defaultAgentUrl);
  const [token, setToken] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [excludePatternText, setExcludePatternText] = useState("");
  const [respectGitignore, setRespectGitignore] = useState(true);
  const [snapshotRootPath, setSnapshotRootPath] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisJob, setAnalysisJob] = useState<AnalysisJob | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedIntentComponentId, setSelectedIntentComponentId] = useState<
    string | null
  >(null);
  const [intendedComponentName, setIntendedComponentName] = useState("");
  const [mapDisplay, setMapDisplay] = useState<"browse" | "map">("browse");
  const [activeView, setActiveView] = useState<
    "explorer" | "marketplace" | "rules"
  >("explorer");
  const [marketplaceTemplates, setMarketplaceTemplates] = useState<
    ArchitectureTemplate[]
  >([]);
  const [ruleEvaluation, setRuleEvaluation] =
    useState<ArchitectureRuleEvaluation | null>(null);
  const [search, setSearch] = useState("");
  const [sourceLocation, setSourceLocation] = useState("");
  const [sourceMatches, setSourceMatches] = useState<GraphEntity[] | null>(
    null,
  );
  const [sourceFreshness, setSourceFreshness] = useState<{
    entityId: string;
    result: SourceFreshness;
  } | null>(null);
  const [busyAction, setBusyAction] = useState<
    | "connect"
    | "load"
    | "analyze"
    | "intent-create"
    | "intent-map"
    | "intent-unmap"
    | "marketplace-load"
    | "template-install"
    | "rules-load"
    | "source-check"
    | "history-load"
    | "history-restore"
    | "history-export"
    | null
  >(null);
  // History is tied to the graph object it was loaded for, so any later graph
  // change hides it instead of showing a stale list.
  const [history, setHistory] = useState<{
    snapshot: GraphSnapshot;
    revisions: GraphRevisionSummary[];
  } | null>(null);
  const isBusy = busyAction !== null;
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const entities = snapshot?.entities ?? [];
  const intendedComponents = useMemo(
    () =>
      entities
        .filter(
          (entity) =>
            entity.kind === "component" && entity.state === "intended",
        )
        .sort((left, right) => left.name.localeCompare(right.name)),
    [entities],
  );
  const selectedIntentComponent =
    intendedComponents.find(
      (component) => component.id === selectedIntentComponentId,
    ) ??
    intendedComponents[0] ??
    null;
  const entityById = useMemo(
    () => new Map(entities.map((entity) => [entity.id, entity])),
    [entities],
  );
  const visibleEntities = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return entities
      .filter((entity) => entity.kind === "file" || entity.kind === "symbol")
      .filter(
        (entity) =>
          !query ||
          entity.name.toLocaleLowerCase().includes(query) ||
          entity.source?.repositoryRelativePath
            .toLocaleLowerCase()
            .includes(query),
      )
      .sort((left, right) => {
        const pathOrder = sourcePath(left).localeCompare(sourcePath(right));
        return pathOrder || left.name.localeCompare(right.name);
      });
  }, [entities, search]);
  const displayEntities = visibleEntities.slice(0, maxVisibleEntities);
  const selectedGraphEntity = selectedEntityId
    ? entityById.get(selectedEntityId)
    : undefined;
  const selectedEntity =
    (selectedGraphEntity &&
    ((selectedGraphEntity.state === "actual" &&
      (selectedGraphEntity.kind === "file" ||
        selectedGraphEntity.kind === "symbol")) ||
      (selectedGraphEntity.state === "intended" &&
        selectedGraphEntity.kind === "component"))
      ? selectedGraphEntity
      : undefined) ??
    visibleEntities[0] ??
    null;
  const sourceNavigation = useMemo(() => {
    const sourceRootPath = snapshotRootPath.trim() || repositoryPath.trim();
    if (
      !selectedEntity?.source ||
      !sourceRootPath ||
      sourceFreshness?.entityId !== selectedEntity.id ||
      sourceFreshness.result.status !== "current"
    ) {
      return { uri: null, error: null };
    }
    try {
      return {
        uri: createVscodeUri(sourceRootPath, selectedEntity.source),
        error: null,
      };
    } catch (reason) {
      if (!(reason instanceof Error)) {
        throw reason;
      }
      return { uri: null, error: reason.message };
    }
  }, [repositoryPath, selectedEntity, snapshotRootPath, sourceFreshness]);

  async function verifySelectedSource(): Promise<void> {
    if (!snapshot || !selectedEntity?.source) return;
    const rootPath = snapshotRootPath.trim() || repositoryPath.trim();
    if (!rootPath) {
      setError(
        "Enter the repository folder path to verify this source location.",
      );
      return;
    }
    setBusyAction("source-check");
    setError(null);
    setNotice(null);
    try {
      const result = await checkSourceFreshness(
        normalizeAgentUrl(agentUrl),
        token,
        snapshot.repositoryId,
        rootPath,
        selectedEntity.id,
      );
      setSourceFreshness({ entityId: selectedEntity.id, result });
      if (result.status === "current") setNotice(result.message);
      else setError(result.message);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function connectToAgent(): Promise<void> {
    setBusyAction("connect");
    setError(null);
    setNotice(null);
    try {
      const baseUrl = normalizeAgentUrl(agentUrl);
      await checkAgent(baseUrl, token);
      setAgentUrl(baseUrl);
      setIsConnected(true);
      setNotice("Connected to the local agent.");
    } catch (reason) {
      setIsConnected(false);
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function loadHistory(): Promise<void> {
    if (!snapshot) return;
    setBusyAction("history-load");
    setError(null);
    setNotice(null);
    try {
      const revisions = await listGraphRevisions(
        normalizeAgentUrl(agentUrl),
        token,
        snapshot.repositoryId,
      );
      setHistory({ snapshot, revisions });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function restoreRevision(
    revision: GraphRevisionSummary,
  ): Promise<void> {
    if (!snapshot) return;
    setBusyAction("history-restore");
    setError(null);
    setNotice(null);
    try {
      const baseUrl = normalizeAgentUrl(agentUrl);
      const result = await restoreGraphRevision(
        baseUrl,
        token,
        snapshot.repositoryId,
        revision.id,
      );
      const revisions = await listGraphRevisions(
        baseUrl,
        token,
        snapshot.repositoryId,
      );
      setSnapshot(result.graph);
      setHistory({ snapshot: result.graph, revisions });
      setSourceFreshness(null);
      setSourceMatches(null);
      setAnalysis(null);
      setRuleEvaluation(null);
      setSelectedEntityId(null);
      setNotice(
        result.status === "restored"
          ? `Restored revision ${revision.sequence} as new revision ${result.revision.sequence}. Earlier history is kept.`
          : `Revision ${revision.sequence} already matches the current graph; nothing changed.`,
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function downloadHistory(): Promise<void> {
    if (!snapshot) return;
    setBusyAction("history-export");
    setError(null);
    setNotice(null);
    try {
      const text = await exportGraphHistory(
        normalizeAgentUrl(agentUrl),
        token,
        snapshot.repositoryId,
      );
      const url = URL.createObjectURL(
        new Blob([text], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `codifier-history-${snapshot.repositoryId}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(
        "History exported. It contains graph metadata and source locations, not file contents.",
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function openMarketplace(): Promise<void> {
    setActiveView("marketplace");
    setBusyAction("marketplace-load");
    setError(null);
    setNotice(null);
    try {
      const baseUrl = normalizeAgentUrl(agentUrl);
      const templates = await listArchitectureTemplates(
        baseUrl,
        token,
        snapshot?.repositoryId,
      );
      setAgentUrl(baseUrl);
      setMarketplaceTemplates(templates);
      setIsConnected(true);
      setNotice("Loaded the bundled architecture template catalog.");
    } catch (reason) {
      setIsConnected(false);
      setMarketplaceTemplates([]);
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function openArchitectureRules(): Promise<void> {
    setActiveView("rules");
    setRuleEvaluation(null);
    setError(null);
    setNotice(null);
    if (!snapshot) {
      return;
    }

    setBusyAction("rules-load");
    try {
      const baseUrl = normalizeAgentUrl(agentUrl);
      const evaluation = await getArchitectureRuleEvaluation(
        baseUrl,
        token,
        snapshot.repositoryId,
      );
      setRuleEvaluation(evaluation);
      setAgentUrl(baseUrl);
      setIsConnected(true);
    } catch (reason) {
      setIsConnected(false);
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  function showRuleEntity(entityId: string): void {
    setSelectedEntityId(entityId);
    setActiveView("explorer");
  }

  async function installTemplate(
    template: ArchitectureTemplate,
  ): Promise<void> {
    if (!snapshot) {
      setError("Analyze or load a repository before installing a template.");
      return;
    }
    setBusyAction("template-install");
    setError(null);
    setNotice(null);
    try {
      const baseUrl = normalizeAgentUrl(agentUrl);
      const updatedSnapshot = await installArchitectureTemplate(
        baseUrl,
        token,
        snapshot.repositoryId,
        template.id,
      );
      setSnapshot(updatedSnapshot);
      setSourceFreshness(null);
      setRepositoryId(updatedSnapshot.repositoryId);
      setMarketplaceTemplates((current) =>
        current.map((item) =>
          item.id === template.id ? { ...item, installed: true } : item,
        ),
      );
      setIsConnected(true);
      setNotice(
        `Added ${template.components.length} intended components from "${template.title}". No source code was changed.`,
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function loadSavedGraph(): Promise<void> {
    setBusyAction("load");
    setError(null);
    setNotice(null);
    try {
      const baseUrl = normalizeAgentUrl(agentUrl);
      const graph = await getGraph(baseUrl, token, repositoryId.trim());
      if (!graph) {
        throw new Error("No saved graph exists for this repository UUID.");
      }
      setSnapshot(graph);
      setSourceFreshness(null);
      setSnapshotRootPath(repositoryPath.trim());
      setAnalysis(null);
      setAnalysisJob(null);
      setSourceMatches(null);
      setSourceFreshness(null);
      setRepositoryId(graph.repositoryId);
      setIsConnected(true);
      setSelectedEntityId(null);
      setNotice("Saved graph loaded from the local agent.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function analyze(): Promise<void> {
    const analyzedRootPath = repositoryPath.trim();
    setBusyAction("analyze");
    setError(null);
    setNotice(null);
    setAnalysis(null);
    setAnalysisJob(null);
    setSourceMatches(null);
    try {
      const baseUrl = normalizeAgentUrl(agentUrl);
      let job = await startAnalysisJob(
        baseUrl,
        token,
        repositoryPath,
        repositoryId.trim() || undefined,
        undefined,
        {
          excludePatterns: excludePatternText
            .split(/\r?\n/)
            .map((pattern) => pattern.trim())
            .filter(Boolean),
          respectGitignore,
        },
      );
      setAnalysisJob(job);
      setRepositoryId(job.repositoryId);
      setIsConnected(true);
      while (
        job.status === "queued" ||
        job.status === "running" ||
        job.status === "cancelling"
      ) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
        job = await getAnalysisJob(baseUrl, token, job.id);
        setAnalysisJob(job);
      }

      if (job.status === "cancelled") {
        setNotice("Analysis cancelled. The saved graph was left unchanged.");
        return;
      }
      if (job.status === "failed") {
        throw new Error(
          job.error ?? "Analysis failed without an error message.",
        );
      }
      if (!job.result) {
        throw new Error(
          "The agent completed analysis without returning a result.",
        );
      }

      const result: AnalysisResult = {
        repositoryId: job.repositoryId,
        ...job.result,
      };
      setAnalysis(result);
      const graph = await getGraph(baseUrl, token, job.repositoryId);
      setSnapshot(graph);
      setSourceFreshness(null);
      if (result.persisted) {
        setSnapshotRootPath(analyzedRootPath);
      } else if (!graph) {
        setSnapshotRootPath("");
      } else if (!snapshotRootPath) {
        setSnapshotRootPath(analyzedRootPath);
      }
      setSelectedEntityId(null);
      setNotice(
        result.persisted
          ? "Analysis complete. The saved graph is up to date."
          : "Analysis was incomplete; the last saved graph was left unchanged.",
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function cancelAnalysis(): Promise<void> {
    if (!analysisJob || analysisJob.status === "cancelled") {
      return;
    }
    try {
      const job = await cancelAnalysisJob(
        normalizeAgentUrl(agentUrl),
        token,
        analysisJob.id,
      );
      setAnalysisJob(job);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function addIntendedComponent(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!snapshot) {
      setError(
        "Analyze or load a repository before creating intended components.",
      );
      return;
    }

    setBusyAction("intent-create");
    setError(null);
    setNotice(null);
    try {
      const previousEntityIds = new Set(
        snapshot.entities.map((entity) => entity.id),
      );
      const updatedSnapshot = await createIntendedComponent(
        normalizeAgentUrl(agentUrl),
        token,
        snapshot.repositoryId,
        intendedComponentName,
      );
      const component = updatedSnapshot.entities.find(
        (entity) =>
          entity.kind === "component" &&
          entity.state === "intended" &&
          !previousEntityIds.has(entity.id),
      );
      if (!component) {
        throw new Error(
          "The agent did not return the newly created component.",
        );
      }
      setSnapshot(updatedSnapshot);
      setSourceFreshness(null);
      setSelectedIntentComponentId(component.id);
      setSelectedEntityId(component.id);
      setIntendedComponentName("");
      setNotice(
        "Intended component created. Select actual code to map it, or leave it unmapped to record a gap.",
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function mapSelectedEntityToIntent(): Promise<void> {
    if (
      !snapshot ||
      !selectedIntentComponent ||
      !selectedEntity ||
      selectedEntity.state !== "actual" ||
      (selectedEntity.kind !== "file" && selectedEntity.kind !== "symbol")
    ) {
      setError("Select an actual file or symbol and an intended component.");
      return;
    }

    setBusyAction("intent-map");
    setError(null);
    setNotice(null);
    try {
      const updatedSnapshot = await mapEntityToIntendedComponent(
        normalizeAgentUrl(agentUrl),
        token,
        snapshot.repositoryId,
        selectedIntentComponent.id,
        selectedEntity.id,
      );
      setSnapshot(updatedSnapshot);
      setSourceFreshness(null);
      setNotice(
        `Mapped "${selectedEntity.name}" to "${selectedIntentComponent.name}".`,
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function unmapSelectedEntityFromIntent(): Promise<void> {
    if (!snapshot || !selectedIntentComponent || !selectedEntity) return;
    setBusyAction("intent-unmap");
    setError(null);
    setNotice(null);
    try {
      const updatedSnapshot = await removeEntityMapping(
        normalizeAgentUrl(agentUrl),
        token,
        snapshot.repositoryId,
        selectedIntentComponent.id,
        selectedEntity.id,
      );
      setSnapshot(updatedSnapshot);
      setSourceFreshness(null);
      setNotice(`Removed the mapping for "${selectedEntity.name}".`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  function findSourceLocation(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!snapshot) {
      setError("Load or analyze a repository before looking up source.");
      return;
    }

    try {
      const matches = lookupEntitiesAtSourceLocation(snapshot, sourceLocation);
      setSourceMatches(matches);
      setError(null);
      setNotice(
        matches.length === 0
          ? `No graph items cover ${sourceLocation.trim()}.`
          : `Found ${matches.length} graph item${matches.length === 1 ? "" : "s"} at ${sourceLocation.trim()}.`,
      );
      if (matches[0]) {
        setSelectedEntityId(matches[0].id);
        setSearch("");
        setMapDisplay("browse");
      }
    } catch (reason) {
      setSourceMatches(null);
      setError(errorMessage(reason));
    }
  }

  async function copyLocation(locator: SourceLocator): Promise<void> {
    const { start, end } = locator.range;
    const location = `${locator.repositoryRelativePath}:${start.line}:${start.column + 1}-${end.line}:${end.column + 1}`;
    try {
      await navigator.clipboard.writeText(location);
      setNotice(`Copied ${location}`);
      setError(null);
    } catch (reason) {
      setError(`Could not copy the source location: ${errorMessage(reason)}`);
    }
  }

  const entityEvidence = selectedEntity
    ? evidenceForEntity(snapshot, selectedEntity)
    : [];
  const relatedItems = selectedEntity
    ? relationshipsForEntity(snapshot, selectedEntity, entityById)
    : [];

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line bg-white/80">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-5 py-4 sm:flex-nowrap sm:gap-5 sm:px-8">
          <a
            aria-label="Codifier codebase map home"
            className="flex items-center gap-3 text-ink no-underline"
            href="#top"
          >
            <span className="grid size-10 place-items-center rounded-xl bg-forest text-lg font-semibold text-white">
              c.
            </span>
            <span>
              <span className="block text-[17px] font-semibold tracking-[-0.04em]">
                codifier
              </span>
              <span className="block text-[11px] uppercase tracking-[0.16em] text-muted">
                local codebase map
              </span>
            </span>
          </a>
          <nav
            aria-label="Primary"
            className="order-3 flex w-full items-center justify-center gap-1 rounded-xl border border-line bg-canvas p-1 sm:order-none sm:w-auto"
          >
            <button
              aria-current={activeView === "explorer" ? "page" : undefined}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                activeView === "explorer"
                  ? "bg-white text-forest shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
              disabled={isBusy}
              onClick={() => setActiveView("explorer")}
              type="button"
            >
              Explore
            </button>
            <button
              aria-current={activeView === "marketplace" ? "page" : undefined}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                activeView === "marketplace"
                  ? "bg-white text-forest shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
              disabled={isBusy}
              onClick={() => void openMarketplace()}
              type="button"
            >
              Marketplace
            </button>
            <button
              aria-current={activeView === "rules" ? "page" : undefined}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                activeView === "rules"
                  ? "bg-white text-forest shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
              disabled={isBusy}
              onClick={() => void openArchitectureRules()}
              type="button"
            >
              Rules
            </button>
          </nav>
          <div
            aria-live="polite"
            className="flex items-center gap-2 rounded-full border border-line bg-white px-3 py-2 text-xs font-medium text-muted"
          >
            <span
              className={`size-2 rounded-full ${isConnected ? "bg-good" : "bg-stone-300"}`}
            />
            {isConnected ? "Agent connected" : "Not connected"}
          </div>
        </div>
      </header>

      <main
        className="mx-auto grid max-w-[1500px] gap-6 px-5 py-8 sm:px-8 lg:grid-cols-[300px_minmax(300px,1fr)_minmax(330px,0.9fr)]"
        id="top"
      >
        {activeView === "marketplace" ? (
          <MarketplacePage
            hasRepository={snapshot !== null}
            isBusy={isBusy}
            isConnected={isConnected}
            isLoading={busyAction === "marketplace-load"}
            onInstall={(template) => void installTemplate(template)}
            onNavigateExplorer={() => setActiveView("explorer")}
            templates={marketplaceTemplates}
          />
        ) : activeView === "rules" ? (
          <ArchitectureRulesPage
            evaluation={ruleEvaluation}
            hasRepository={snapshot !== null}
            isLoading={busyAction === "rules-load"}
            onNavigateExplorer={() => setActiveView("explorer")}
            onRefresh={() => void openArchitectureRules()}
            onSelectEntity={showRuleEntity}
            snapshot={snapshot}
          />
        ) : (
          <>
            <aside className="space-y-5">
              <section className="rounded-2xl border border-line bg-white p-5 shadow-card">
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-forest">
                      Workspace
                    </p>
                    <h1 className="mt-1 text-xl font-semibold tracking-[-0.04em]">
                      Explore a codebase
                    </h1>
                  </div>
                  <span className="rounded-lg bg-mist px-2 py-1 text-[11px] font-medium text-forest">
                    local only
                  </span>
                </div>

                <div className="space-y-4">
                  <Field label="Agent address" htmlFor="agent-url">
                    <input
                      autoComplete="url"
                      className={inputClass}
                      disabled={isBusy}
                      id="agent-url"
                      onChange={(event) => setAgentUrl(event.target.value)}
                      spellCheck={false}
                      value={agentUrl}
                    />
                  </Field>
                  <Field label="Agent token" htmlFor="agent-token">
                    <input
                      autoComplete="off"
                      className={inputClass}
                      disabled={isBusy}
                      id="agent-token"
                      onChange={(event) => setToken(event.target.value)}
                      placeholder="Paste your local token"
                      type="password"
                      value={token}
                    />
                    <span className="mt-1.5 block text-[11px] leading-4 text-muted">
                      Kept in memory only; never saved by this page.
                    </span>
                  </Field>
                  <button
                    className={secondaryButtonClass}
                    disabled={isBusy || token.length === 0}
                    onClick={() => void connectToAgent()}
                    type="button"
                  >
                    {busyAction === "connect"
                      ? "Connecting…"
                      : "Connect to agent"}
                  </button>
                </div>
              </section>

              <section className="rounded-2xl border border-line bg-white p-5 shadow-card">
                <div className="mb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-forest">
                    Analyze
                  </p>
                  <h2 className="mt-1 text-base font-semibold tracking-[-0.03em]">
                    Create or refresh a map
                  </h2>
                </div>
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void analyze();
                  }}
                >
                  <Field
                    label="Repository folder path"
                    htmlFor="repository-path"
                  >
                    <input
                      autoComplete="off"
                      className={inputClass}
                      disabled={isBusy}
                      id="repository-path"
                      onChange={(event) =>
                        setRepositoryPath(event.target.value)
                      }
                      placeholder="C:\projects\my-app"
                      spellCheck={false}
                      value={repositoryPath}
                    />
                    <span className="mt-1.5 block text-[11px] leading-4 text-muted">
                      The agent reads this folder locally. No source is
                      uploaded.
                    </span>
                  </Field>
                  <Field label="Saved repository UUID" htmlFor="repository-id">
                    <input
                      autoComplete="off"
                      className={inputClass}
                      disabled={isBusy}
                      id="repository-id"
                      onChange={(event) => setRepositoryId(event.target.value)}
                      placeholder="Optional for a new repository"
                      spellCheck={false}
                      value={repositoryId}
                    />
                  </Field>
                  <label className="flex items-start gap-2 text-xs leading-5 text-ink">
                    <input
                      checked={respectGitignore}
                      className="mt-1 accent-forest"
                      disabled={isBusy}
                      onChange={(event) =>
                        setRespectGitignore(event.target.checked)
                      }
                      type="checkbox"
                    />
                    <span>Honor repository .gitignore rules</span>
                  </label>
                  <Field
                    label="Additional excluded paths (one glob per line)"
                    htmlFor="analysis-exclusions"
                  >
                    <textarea
                      className={`${inputClass} min-h-20 resize-y`}
                      disabled={isBusy}
                      id="analysis-exclusions"
                      onChange={(event) =>
                        setExcludePatternText(event.target.value)
                      }
                      placeholder={"generated/**\nfixtures/large-data"}
                      spellCheck={false}
                      value={excludePatternText}
                    />
                    <span className="mt-1.5 block text-[11px] leading-4 text-muted">
                      Repository-relative patterns add exclusions; safety
                      directories cannot be included.
                    </span>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className={primaryButtonClass}
                      disabled={isBusy || token.length === 0}
                      type="submit"
                    >
                      {busyAction === "analyze"
                        ? "Analyzing…"
                        : "Analyze folder"}
                    </button>
                    <button
                      className={secondaryButtonClass}
                      disabled={isBusy || token.length === 0 || !repositoryId}
                      onClick={() => void loadSavedGraph()}
                      type="button"
                    >
                      {busyAction === "load" ? "Loading…" : "Load saved"}
                    </button>
                  </div>
                  {analysisJob && (
                    <AnalysisProgressCard
                      job={analysisJob}
                      onCancel={() => void cancelAnalysis()}
                    />
                  )}
                </form>
              </section>

              {snapshot && (
                <section
                  aria-label="Intended architecture"
                  className="rounded-2xl border border-line bg-white p-5 shadow-card"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-forest">
                    Intended architecture
                  </p>
                  <h2 className="mt-1 text-base font-semibold tracking-[-0.03em]">
                    Developer-authored components
                  </h2>
                  <form
                    className="mt-4 space-y-2"
                    onSubmit={addIntendedComponent}
                  >
                    <label
                      className="sr-only"
                      htmlFor="intended-component-name"
                    >
                      Intended component name
                    </label>
                    <input
                      className={inputClass}
                      disabled={!isConnected || isBusy}
                      id="intended-component-name"
                      maxLength={120}
                      onChange={(event) =>
                        setIntendedComponentName(event.target.value)
                      }
                      placeholder="e.g. Billing service"
                      value={intendedComponentName}
                    />
                    <button
                      className={secondaryButtonClass}
                      disabled={
                        !isConnected ||
                        isBusy ||
                        intendedComponentName.trim().length === 0
                      }
                      type="submit"
                    >
                      {busyAction === "intent-create"
                        ? "Creating…"
                        : "Create intended component"}
                    </button>
                  </form>
                  {intendedComponents.length > 0 ? (
                    <ul className="mt-4 max-h-48 space-y-1 overflow-y-auto">
                      {intendedComponents.map((component) => {
                        const mappingCount = snapshot.relationships.filter(
                          (relationship) =>
                            relationship.sourceEntityId === component.id &&
                            relationship.type === "MAPS_TO" &&
                            relationship.state === "intended",
                        ).length;
                        return (
                          <li key={component.id}>
                            <button
                              aria-current={
                                selectedIntentComponent?.id === component.id
                                  ? "true"
                                  : undefined
                              }
                              className={`w-full rounded-lg px-3 py-2 text-left ${
                                selectedIntentComponent?.id === component.id
                                  ? "bg-mist text-forest"
                                  : "hover:bg-canvas"
                              }`}
                              onClick={() => {
                                setSelectedIntentComponentId(component.id);
                                setSelectedEntityId(component.id);
                              }}
                              type="button"
                            >
                              <span className="block truncate text-xs font-medium">
                                {component.name}
                              </span>
                              <span className="mt-0.5 block text-[10px] text-muted">
                                {mappingCount > 0
                                  ? `${mappingCount} mapped code item${mappingCount === 1 ? "" : "s"}`
                                  : "No code mapped yet"}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-3 text-[11px] leading-5 text-muted">
                      Add intended components to compare developer-authored
                      architecture with observed code.
                    </p>
                  )}
                </section>
              )}

              {analysis?.changeSummary && (
                <AnalysisChangeSummaryCard summary={analysis.changeSummary} />
              )}
              {analysis?.reconciliation && (
                <ReconciliationCard reconciliation={analysis.reconciliation} />
              )}
              {analysis && <CoverageCard analysis={analysis} />}
              {snapshot && <GitContextCard context={snapshot.gitContext} />}
              {snapshot && isConnected && (
                <RevisionHistoryCard
                  busyAction={busyAction}
                  isBusy={isBusy}
                  onExport={() => void downloadHistory()}
                  onLoad={() => void loadHistory()}
                  onRestore={(revision) => void restoreRevision(revision)}
                  revisions={
                    history?.snapshot === snapshot ? history.revisions : null
                  }
                />
              )}
              <p className="px-1 text-[11px] leading-5 text-muted">
                Analysis runs on your machine. Unsupported files and diagnostics
                are shown rather than silently treated as complete.
              </p>
            </aside>

            <section
              aria-label="Repository explorer"
              className="flex min-h-[520px] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-card lg:min-h-[calc(100vh-150px)]"
            >
              <div className="border-b border-line px-5 pb-4 pt-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-forest">
                      Map
                    </p>
                    <h2 className="mt-1 truncate text-lg font-semibold tracking-[-0.04em]">
                      {snapshot
                        ? repositoryName(
                            snapshot,
                            snapshotRootPath || repositoryPath,
                          )
                        : "Your repository, made navigable"}
                    </h2>
                  </div>
                  {snapshot && (
                    <span className="shrink-0 rounded-full bg-mist px-2.5 py-1 text-[11px] font-medium text-forest">
                      {visibleEntities.length} items
                    </span>
                  )}
                </div>
                <label className="relative mt-4 block">
                  <span className="sr-only">Search files and symbols</span>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                  >
                    ⌕
                  </span>
                  <input
                    className={`${inputClass} pl-9`}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search files and symbols"
                    type="search"
                    value={search}
                  />
                </label>
                <form className="mt-3" onSubmit={findSourceLocation}>
                  <label
                    className="mb-1.5 block text-xs font-medium text-ink"
                    htmlFor="source-location"
                  >
                    Find source in map
                  </label>
                  <div className="flex gap-2">
                    <input
                      autoComplete="off"
                      className={inputClass}
                      disabled={!snapshot}
                      id="source-location"
                      onChange={(event) => {
                        setSourceLocation(event.target.value);
                        setSourceMatches(null);
                      }}
                      placeholder="src/file.ts:24:8"
                      spellCheck={false}
                      value={sourceLocation}
                    />
                    <button
                      className={secondaryButtonClass}
                      disabled={!snapshot || sourceLocation.trim().length === 0}
                      type="submit"
                    >
                      Find
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-muted">
                    Repository-relative path and 1-based line, optionally
                    column. Backslashes are accepted.
                  </p>
                </form>
                {sourceMatches && (
                  <div
                    aria-label="Source location matches"
                    className="mt-3 rounded-xl border border-line bg-canvas p-2"
                    role="region"
                  >
                    {sourceMatches.length > 0 ? (
                      <>
                        <p className="px-2 py-1 text-[10px] font-medium text-muted">
                          {sourceMatches.length} matching graph item
                          {sourceMatches.length === 1 ? "" : "s"}
                        </p>
                        <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                          {sourceMatches.map((entity) => (
                            <li key={entity.id}>
                              <button
                                aria-current={
                                  selectedEntity?.id === entity.id
                                    ? "true"
                                    : undefined
                                }
                                className={`w-full rounded-lg px-2 py-2 text-left ${
                                  selectedEntity?.id === entity.id
                                    ? "bg-white text-forest"
                                    : "hover:bg-white"
                                }`}
                                onClick={() => setSelectedEntityId(entity.id)}
                                type="button"
                              >
                                <span className="block truncate text-xs font-medium">
                                  {entity.kind}: {entity.name}
                                </span>
                                <span className="mt-0.5 block truncate font-mono text-[10px] text-muted">
                                  {sourcePath(entity)} ·{" "}
                                  {formatRange(entity.source!)}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="px-2 py-2 text-xs text-muted">
                        No graph items cover this location.
                      </p>
                    )}
                  </div>
                )}
                {snapshot && (
                  <div
                    aria-label="Map display"
                    className="mt-3 inline-flex rounded-lg border border-line bg-canvas p-1"
                    role="group"
                  >
                    <button
                      aria-pressed={mapDisplay === "browse"}
                      className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition ${
                        mapDisplay === "browse"
                          ? "bg-white text-forest shadow-sm"
                          : "text-muted hover:text-ink"
                      }`}
                      onClick={() => setMapDisplay("browse")}
                      type="button"
                    >
                      Browse list
                    </button>
                    <button
                      aria-pressed={mapDisplay === "map"}
                      className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition ${
                        mapDisplay === "map"
                          ? "bg-white text-forest shadow-sm"
                          : "text-muted hover:text-ink"
                      }`}
                      onClick={() => setMapDisplay("map")}
                      type="button"
                    >
                      Relationship map
                    </button>
                  </div>
                )}
              </div>

              {analysis?.diagnostics.length ? (
                <DiagnosticsPanel
                  analysis={analysis}
                  onSelectPath={(path) => setSearch(path)}
                />
              ) : null}

              {mapDisplay === "map" &&
              snapshot &&
              selectedEntity &&
              selectedEntity.state === "actual" &&
              (selectedEntity.kind === "file" ||
                selectedEntity.kind === "symbol") ? (
                <Suspense
                  fallback={
                    <div
                      className="grid min-h-80 flex-1 place-items-center text-sm text-muted"
                      role="status"
                    >
                      Loading relationship map…
                    </div>
                  }
                >
                  <NeighborhoodMap
                    onSelectEntity={(entityId) => {
                      setSearch("");
                      setSelectedEntityId(entityId);
                    }}
                    selectedEntity={selectedEntity}
                    snapshot={snapshot}
                  />
                </Suspense>
              ) : mapDisplay === "map" && snapshot && selectedEntity ? (
                <div className="grid min-h-80 flex-1 place-items-center px-6 text-center">
                  <div>
                    <p className="text-sm font-medium text-ink">
                      Relationship map shows observed code
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      Select a file or symbol in Browse list to explore its
                      neighborhood.
                    </p>
                    <button
                      className={`${secondaryButtonClass} mt-3`}
                      onClick={() => setMapDisplay("browse")}
                      type="button"
                    >
                      Browse files and symbols
                    </button>
                  </div>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {visibleEntities.length > 0 ? (
                    <ul className="space-y-0.5">
                      {displayEntities.map((entity) => (
                        <li key={entity.id}>
                          <button
                            aria-current={selectedEntity?.id === entity.id}
                            className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                              selectedEntity?.id === entity.id
                                ? "bg-mist text-forest"
                                : "text-ink hover:bg-canvas"
                            }`}
                            onClick={() => setSelectedEntityId(entity.id)}
                            type="button"
                          >
                            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-white text-[10px] font-semibold uppercase text-muted">
                              {entity.kind === "file" ? "F" : "S"}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block break-words text-sm font-medium">
                                {entity.name}
                              </span>
                              <span className="mt-0.5 block truncate text-[11px] text-muted">
                                {sourcePath(entity)}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyExplorer
                      hasSnapshot={snapshot !== null}
                      search={search}
                    />
                  )}
                  {visibleEntities.length > maxVisibleEntities && (
                    <p className="px-3 py-3 text-center text-[11px] leading-5 text-muted">
                      Showing the first {maxVisibleEntities} of{" "}
                      {visibleEntities.length} items. Refine your search to
                      narrow the list.
                    </p>
                  )}
                </div>
              )}
              <div className="border-t border-line px-4 py-3 text-[11px] text-muted">
                {snapshot
                  ? `Revision ${snapshot.revision ?? "not specified"} · ${snapshot.entities.length} graph entities`
                  : "Connect to the local agent and analyze a repository to begin."}
              </div>
            </section>

            <section
              aria-label="Selected item details"
              className="min-h-[360px] rounded-2xl border border-line bg-white p-5 shadow-card lg:min-h-[calc(100vh-150px)] lg:overflow-y-auto"
            >
              {selectedEntity ? (
                <EntityDetails
                  entity={selectedEntity}
                  evidence={entityEvidence}
                  onCopyLocation={(locator) => void copyLocation(locator)}
                  intendedComponent={selectedIntentComponent}
                  isMapping={busyAction === "intent-map"}
                  onMapToIntendedComponent={() =>
                    void mapSelectedEntityToIntent()
                  }
                  onUnmapFromIntendedComponent={() =>
                    void unmapSelectedEntityFromIntent()
                  }
                  isUnmapping={busyAction === "intent-unmap"}
                  isMapped={Boolean(
                    snapshot?.relationships.some(
                      (relationship) =>
                        relationship.sourceEntityId ===
                          selectedIntentComponent?.id &&
                        relationship.targetEntityId === selectedEntity.id &&
                        relationship.type === "MAPS_TO" &&
                        relationship.state === "intended",
                    ),
                  )}
                  onSelectEntity={setSelectedEntityId}
                  relationships={relatedItems}
                  canMapToIntendedComponent={
                    isConnected && !isBusy && selectedIntentComponent !== null
                  }
                  sourceNavigation={sourceNavigation}
                  onVerifySource={() => void verifySelectedSource()}
                  isCheckingSource={busyAction === "source-check"}
                  sourceFreshness={
                    sourceFreshness?.entityId === selectedEntity.id
                      ? sourceFreshness.result
                      : null
                  }
                />
              ) : (
                <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-6 text-center">
                  <span className="grid size-14 place-items-center rounded-2xl bg-mist text-forest">
                    <MapGlyph />
                  </span>
                  <h2 className="mt-4 text-base font-semibold tracking-[-0.03em]">
                    Evidence, not guesswork
                  </h2>
                  <p className="mt-2 max-w-xs text-sm leading-6 text-muted">
                    Choose a file or symbol to inspect its source location,
                    relationships, and the evidence behind them.
                  </p>
                </div>
              )}
            </section>
          </>
        )}

        <div
          aria-live="polite"
          className={`fixed bottom-5 left-1/2 z-10 w-[min(90vw,540px)] -translate-x-1/2 rounded-xl border px-4 py-3 text-sm shadow-lg ${
            error
              ? "border-red-200 bg-red-50 text-red-800"
              : notice
                ? "border-green-200 bg-green-50 text-green-900"
                : "hidden"
          }`}
          role={error ? "alert" : "status"}
        >
          {error ?? notice}
          <button
            aria-label="Dismiss message"
            className="ml-3 font-semibold underline underline-offset-2"
            onClick={() => {
              setError(null);
              setNotice(null);
            }}
            type="button"
          >
            Dismiss
          </button>
        </div>
      </main>
    </div>
  );
}

function MarketplacePage({
  hasRepository,
  isBusy,
  isConnected,
  isLoading,
  onInstall,
  onNavigateExplorer,
  templates,
}: {
  hasRepository: boolean;
  isBusy: boolean;
  isConnected: boolean;
  isLoading: boolean;
  onInstall: (template: ArchitectureTemplate) => void;
  onNavigateExplorer: () => void;
  templates: ArchitectureTemplate[];
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const categories = useMemo(
    () => ["All", ...new Set(templates.map((template) => template.category))],
    [templates],
  );
  const visibleTemplates = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return templates.filter((template) => {
      const matchesCategory =
        category === "All" || template.category === category;
      const searchableText = [
        template.title,
        template.description,
        template.category,
        ...template.tags,
        ...template.components.map(
          (component) => `${component.name} ${component.description}`,
        ),
      ]
        .join(" ")
        .toLocaleLowerCase();
      return (
        matchesCategory &&
        (!normalizedQuery || searchableText.includes(normalizedQuery))
      );
    });
  }, [category, query, templates]);

  return (
    <section
      aria-label="Architecture marketplace"
      className="space-y-6 lg:col-span-3"
    >
      <div className="rounded-2xl border border-line bg-white p-6 shadow-card sm:p-8">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-forest">
              Local catalog
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-ink">
              Architecture marketplace
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              Start with a reusable architecture outline, then adapt it to your
              codebase. Templates add intended components to the selected
              repository; they never edit source files.
            </p>
          </div>
          <span className="inline-flex w-fit items-center rounded-full border border-line bg-canvas px-3 py-2 text-xs font-medium text-muted">
            Bundled · works without an account
          </span>
        </div>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="marketplace-search">
            Search architecture templates
          </label>
          <input
            className={`${inputClass} sm:max-w-md`}
            id="marketplace-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search templates, components, or tags"
            type="search"
            value={query}
          />
          <div
            aria-label="Template categories"
            className="flex flex-wrap items-center gap-1.5"
            role="group"
          >
            {categories.map((item) => (
              <button
                aria-pressed={category === item}
                className={`rounded-full px-3 py-2 text-xs font-medium transition ${
                  category === item
                    ? "bg-forest text-white"
                    : "border border-line bg-white text-muted hover:text-ink"
                }`}
                key={item}
                onClick={() => setCategory(item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <p
            className="mt-8 rounded-xl border border-line bg-canvas px-4 py-6 text-sm text-muted"
            role="status"
          >
            Loading the local catalog…
          </p>
        ) : !isConnected ? (
          <div className="mt-8 rounded-xl border border-line bg-canvas px-5 py-6">
            <h2 className="font-semibold text-ink">
              Connect to the local agent
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              The bundled catalog is served by your local Codifier agent. No
              marketplace server or account is used.
            </p>
            <button
              className={`${secondaryButtonClass} mt-4`}
              onClick={onNavigateExplorer}
              type="button"
            >
              Go to workspace connection
            </button>
          </div>
        ) : visibleTemplates.length > 0 ? (
          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            {visibleTemplates.map((template) => (
              <article
                className="flex flex-col rounded-2xl border border-line bg-white p-5 transition hover:border-forest/30"
                key={template.id}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-forest">
                      {template.category}
                    </span>
                    <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-ink">
                      {template.title}
                    </h2>
                  </div>
                  <span className="shrink-0 rounded-lg bg-canvas px-2 py-1 text-[10px] font-medium text-muted">
                    v{template.version}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted">
                  {template.description}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {template.tags.map((tag) => (
                    <span
                      className="rounded-full bg-canvas px-2.5 py-1 text-[10px] text-muted"
                      key={tag}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-5 border-t border-line pt-4">
                  <h3 className="text-xs font-semibold text-ink">
                    Intended components
                  </h3>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                    {template.components.map((component) => (
                      <li
                        className="rounded-lg bg-canvas px-3 py-2"
                        key={component.id}
                      >
                        <span className="block text-xs font-medium text-ink">
                          {component.name}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-4 text-muted">
                          {component.description}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
                  <span className="text-[11px] text-muted">
                    {template.publisher}
                  </span>
                  <button
                    className={
                      template.installed
                        ? secondaryButtonClass
                        : primaryButtonClass
                    }
                    disabled={
                      isBusy ||
                      template.installed ||
                      !isConnected ||
                      !hasRepository
                    }
                    onClick={() => onInstall(template)}
                    type="button"
                  >
                    {template.installed
                      ? "Installed"
                      : isBusy
                        ? "Installing…"
                        : "Add to repository"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-8 rounded-xl border border-dashed border-line px-5 py-8 text-center text-sm text-muted">
            {templates.length === 0
              ? "The local catalog has no templates yet."
              : "No templates match your search."}
          </p>
        )}

        <div className="mt-6 flex flex-col justify-between gap-3 rounded-xl border border-line bg-canvas p-4 sm:flex-row sm:items-center">
          <p className="text-xs leading-5 text-muted">
            Rule packs are not installable yet. They will be added after
            architecture rules have a supported evaluation format.
          </p>
          {!hasRepository && (
            <button
              className={`${secondaryButtonClass} shrink-0`}
              onClick={onNavigateExplorer}
              type="button"
            >
              Analyze or load a repository
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function ArchitectureRulesPage({
  evaluation,
  hasRepository,
  isLoading,
  onNavigateExplorer,
  onRefresh,
  onSelectEntity,
  snapshot,
}: {
  evaluation: ArchitectureRuleEvaluation | null;
  hasRepository: boolean;
  isLoading: boolean;
  onNavigateExplorer: () => void;
  onRefresh: () => void;
  onSelectEntity: (entityId: string) => void;
  snapshot: GraphSnapshot | null;
}) {
  const entityById = useMemo(
    () =>
      new Map(snapshot?.entities.map((entity) => [entity.id, entity]) ?? []),
    [snapshot],
  );
  const evidenceById = useMemo(
    () => new Map(snapshot?.evidence.map((item) => [item.id, item]) ?? []),
    [snapshot],
  );
  const warningCount =
    evaluation?.findings.filter((finding) => finding.severity === "warning")
      .length ?? 0;
  const infoCount =
    evaluation?.findings.filter((finding) => finding.severity === "info")
      .length ?? 0;

  return (
    <section
      aria-label="Architecture rules"
      className="space-y-6 lg:col-span-3"
    >
      <div className="rounded-2xl border border-line bg-white p-6 shadow-card sm:p-8">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-forest">
              Local graph review
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-ink">
              Architecture rules
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              Review explicit graph conditions backed by your saved entities,
              relationships, and evidence. Findings are prompts for developer
              review, not compliance or quality guarantees.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-line bg-canvas px-3 py-2 text-xs font-medium text-muted">
              Local evaluation
            </span>
            {hasRepository && (
              <button
                className={secondaryButtonClass}
                disabled={isLoading}
                onClick={onRefresh}
                type="button"
              >
                {isLoading ? "Evaluating…" : "Refresh"}
              </button>
            )}
          </div>
        </div>

        {!hasRepository ? (
          <div className="mt-8 rounded-xl border border-line bg-canvas px-5 py-6">
            <h2 className="font-semibold text-ink">
              Select a repository first
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Analyze a local folder or load a saved graph to evaluate
              architecture rules.
            </p>
            <button
              className={`${primaryButtonClass} mt-4`}
              onClick={onNavigateExplorer}
              type="button"
            >
              Go to workspace
            </button>
          </div>
        ) : isLoading ? (
          <p
            className="mt-8 rounded-xl border border-line bg-canvas px-4 py-6 text-sm text-muted"
            role="status"
          >
            Evaluating the saved graph locally…
          </p>
        ) : evaluation ? (
          <>
            <div className="mt-7 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-canvas px-3 py-1.5 text-xs text-muted">
                {evaluation.findings.length} finding
                {evaluation.findings.length === 1 ? "" : "s"}
              </span>
              <span className="rounded-full bg-canvas px-3 py-1.5 text-xs text-muted">
                {warningCount} review warning{warningCount === 1 ? "" : "s"}
              </span>
              <span className="rounded-full bg-canvas px-3 py-1.5 text-xs text-muted">
                {infoCount} design gap{infoCount === 1 ? "" : "s"}
              </span>
              <span className="ml-auto text-[11px] text-muted">
                Rule set v{evaluation.ruleSetVersion} · graph revision{" "}
                {evaluation.revision ?? "not specified"}
              </span>
            </div>
            {evaluation.findings.length === 0 ? (
              <div className="mt-5 rounded-xl border border-line bg-canvas px-5 py-7 text-center">
                <h2 className="font-semibold text-ink">
                  No findings from these review rules
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted">
                  This only means the current checks found no matching graph
                  conditions; it is not a compliance determination.
                </p>
              </div>
            ) : (
              <ul className="mt-5 space-y-3">
                {evaluation.findings.map((finding) => (
                  <ArchitectureRuleFindingCard
                    entityById={entityById}
                    evidenceById={evidenceById}
                    finding={finding}
                    key={`${finding.ruleId}:${finding.entityIds.join(",")}`}
                    onSelectEntity={onSelectEntity}
                  />
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="mt-8 rounded-xl border border-line bg-canvas px-5 py-6">
            <h2 className="font-semibold text-ink">
              Rule evaluation is not loaded
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Connect to the local agent to evaluate this repository’s saved
              graph.
            </p>
            <button
              className={`${secondaryButtonClass} mt-4`}
              onClick={onRefresh}
              type="button"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function ArchitectureRuleFindingCard({
  entityById,
  evidenceById,
  finding,
  onSelectEntity,
}: {
  entityById: Map<string, GraphEntity>;
  evidenceById: Map<string, Evidence>;
  finding: ArchitectureRuleFinding;
  onSelectEntity: (entityId: string) => void;
}) {
  const relatedEntities = finding.entityIds
    .map((entityId) => entityById.get(entityId))
    .filter((entity): entity is GraphEntity => entity !== undefined);
  const evidence = finding.evidenceIds
    .map((evidenceId) => evidenceById.get(evidenceId))
    .filter((item): item is Evidence => item !== undefined);
  const displayedEvidence = evidence.slice(0, 3);

  return (
    <li className="rounded-xl border border-line bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`mt-0.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${
              finding.severity === "warning"
                ? "bg-amber-50 text-amber-800"
                : "bg-sky-50 text-sky-800"
            }`}
          >
            {finding.severity === "warning" ? "Review" : "Info"}
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">{finding.title}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              {finding.message}
            </p>
          </div>
        </div>
        <code className="rounded bg-canvas px-2 py-1 text-[10px] text-muted">
          {finding.ruleId}
        </code>
      </div>
      {relatedEntities.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {relatedEntities.map((entity) => (
            <button
              className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-left text-xs text-ink hover:border-forest/40 hover:text-forest"
              key={entity.id}
              onClick={() => onSelectEntity(entity.id)}
              type="button"
            >
              {entity.kind}: {entity.name}
            </button>
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-[11px] text-muted">
        <span>
          {finding.relationshipIds.length} relationship
          {finding.relationshipIds.length === 1 ? "" : "s"} referenced
        </span>
        <span>
          {finding.evidenceIds.length} evidence item
          {finding.evidenceIds.length === 1 ? "" : "s"}
        </span>
      </div>
      {displayedEvidence.length > 0 && (
        <ul aria-label="Finding evidence" className="mt-3 space-y-2">
          {displayedEvidence.map((item) => (
            <li
              className="rounded-lg bg-canvas px-3 py-2 text-xs leading-5 text-muted"
              key={item.id}
            >
              <span className="font-medium text-ink">{item.origin}</span>
              <span>: {item.description}</span>
              {item.source && (
                <span className="mt-0.5 block font-mono text-[10px]">
                  {item.source.repositoryRelativePath}:
                  {item.source.range.start.line}
                </span>
              )}
            </li>
          ))}
          {evidence.length > displayedEvidence.length && (
            <li className="px-1 text-[10px] text-muted">
              And {evidence.length - displayedEvidence.length} more evidence
              item{evidence.length - displayedEvidence.length === 1 ? "" : "s"}.
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

const inputClass =
  "w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-stone-400 focus:border-forest focus:ring-2 focus:ring-forest/15";
const primaryButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-xl bg-forest px-3 py-2 text-xs font-semibold text-white transition hover:bg-forest-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest disabled:cursor-not-allowed disabled:opacity-45";
const secondaryButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-ink transition hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest disabled:cursor-not-allowed disabled:opacity-45";

function Field({
  children,
  htmlFor,
  label,
}: {
  children: ReactNode;
  htmlFor: string;
  label: string;
}) {
  return (
    <div>
      <label
        className="mb-1.5 block text-xs font-medium text-ink"
        htmlFor={htmlFor}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function CoverageCard({ analysis }: { analysis: AnalysisResult }) {
  const coverage = analysis.coverage;
  return (
    <section
      aria-label="Analysis coverage"
      className="rounded-2xl border border-line bg-white p-5 shadow-card"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-forest">
            Coverage
          </p>
          <h2 className="mt-1 text-base font-semibold tracking-[-0.03em]">
            {analysis.persisted ? "Map updated" : "Partial analysis"}
          </h2>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
            analysis.persisted
              ? "bg-green-50 text-green-800"
              : "bg-amber-50 text-amber-800"
          }`}
        >
          {analysis.persisted ? "Saved" : "Not saved"}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <CoverageMetric label="Discovered" value={coverage.filesDiscovered} />
        <CoverageMetric label="Supported" value={coverage.supportedFiles} />
        <CoverageMetric label="Analyzed" value={coverage.analyzedFiles} />
        <CoverageMetric label="Unsupported" value={coverage.unsupportedFiles} />
        <CoverageMetric
          label="Skipped / failed"
          value={coverage.skippedFiles + coverage.failedFiles}
        />
      </dl>
      {(coverage.truncated || coverage.excludedDirectories > 0) && (
        <p className="mt-3 text-[11px] leading-5 text-muted">
          {coverage.truncated && "Inventory reached its configured limit. "}
          {coverage.excludedDirectories > 0 &&
            `${coverage.excludedDirectories} generated or excluded directories omitted.`}
        </p>
      )}
    </section>
  );
}

function AnalysisChangeSummaryCard({
  summary,
}: {
  summary: NonNullable<AnalysisResult["changeSummary"]>;
}) {
  return (
    <section
      aria-label="Analysis changes"
      className="rounded-2xl border border-line bg-white p-5 shadow-card"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-forest">
        Change summary
      </p>
      <h2 className="mt-1 text-base font-semibold tracking-[-0.03em]">
        {summary.initialAnalysis
          ? "Initial map created"
          : "Since last analysis"}
      </h2>
      {summary.initialAnalysis ? (
        <p className="mt-2 text-[11px] leading-5 text-muted">
          Added {summary.entities.added} graph items and{" "}
          {summary.relationships.added} relationships.
        </p>
      ) : (
        <dl className="mt-3 space-y-3">
          <ChangeSummaryRow label="Graph items" counts={summary.entities} />
          <ChangeSummaryRow
            label="Relationships"
            counts={summary.relationships}
          />
        </dl>
      )}
    </section>
  );
}

function ReconciliationCard({
  reconciliation,
}: {
  reconciliation: NonNullable<AnalysisResult["reconciliation"]>;
}) {
  const changedCount =
    reconciliation.addedFiles.length +
    reconciliation.changedFiles.length +
    reconciliation.removedFiles.length +
    reconciliation.renamedFiles.length;
  return (
    <section
      aria-label="File reconciliation"
      className="rounded-2xl border border-line bg-white p-5 shadow-card"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-forest">
        File reconciliation
      </p>
      <h2 className="mt-1 text-base font-semibold tracking-[-0.03em]">
        {reconciliation.mode === "initial"
          ? "Initial analysis"
          : reconciliation.mode === "unchanged"
            ? "No analyzed file changes"
            : `${changedCount} file change${changedCount === 1 ? "" : "s"}`}
      </h2>
      <p className="mt-2 text-[11px] leading-5 text-muted">
        {reconciliation.reason}
      </p>
      {reconciliation.mode === "full-fallback" && (
        <dl className="mt-3 space-y-1 text-[11px] text-muted">
          <div>Added: {reconciliation.addedFiles.length}</div>
          <div>Edited: {reconciliation.changedFiles.length}</div>
          <div>Removed: {reconciliation.removedFiles.length}</div>
          <div>Renamed: {reconciliation.renamedFiles.length}</div>
        </dl>
      )}
    </section>
  );
}

function ChangeSummaryRow({
  label,
  counts,
}: {
  label: string;
  counts: { added: number; changed: number; removed: number };
}) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
        {label}
      </dt>
      <dd className="mt-1 flex flex-wrap gap-2 text-[11px] font-medium tabular-nums">
        <span className="rounded-md bg-green-50 px-2 py-1 text-green-800">
          +{counts.added} added
        </span>
        <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-800">
          {counts.changed} changed
        </span>
        <span className="rounded-md bg-stone-100 px-2 py-1 text-stone-700">
          -{counts.removed} removed
        </span>
      </dd>
    </div>
  );
}

function AnalysisProgressCard({
  job,
  onCancel,
}: {
  job: AnalysisJob;
  onCancel: () => void;
}) {
  const phaseLabels: Record<AnalysisJob["progress"]["phase"], string> = {
    inventory: "Scanning repository",
    reading: "Reading files",
    parsing: "Analyzing syntax",
    resolving: "Resolving relationships",
    persisting: "Saving graph",
    complete: "Analysis complete",
    cancelled: "Analysis cancelled",
    failed: "Analysis failed",
  };
  const { completedFiles, totalFiles } = job.progress;
  const percent =
    totalFiles && totalFiles > 0
      ? Math.min(100, Math.round((completedFiles / totalFiles) * 100))
      : null;
  const active = job.status === "queued" || job.status === "running";

  return (
    <section
      aria-label="Analysis progress"
      aria-live="polite"
      className="rounded-xl border border-line bg-canvas p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-ink">
            {phaseLabels[job.progress.phase]}
          </p>
          <p className="mt-1 text-[11px] text-muted">
            {percent === null
              ? `${completedFiles} files discovered`
              : `${completedFiles} of ${totalFiles} files · ${percent}%`}
          </p>
          {job.progress.currentFile && (
            <p className="mt-1 break-all text-[10px] text-muted">
              {job.progress.currentFile}
            </p>
          )}
        </div>
        {active && (
          <button
            className="shrink-0 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[11px] font-semibold text-ink hover:bg-white/70 disabled:opacity-50"
            disabled={job.status !== "running" && job.status !== "queued"}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        )}
        {job.status === "cancelling" && (
          <span className="shrink-0 text-[11px] font-medium text-muted">
            Cancelling…
          </span>
        )}
      </div>
      <div
        aria-label={
          percent === null
            ? phaseLabels[job.progress.phase]
            : `${percent}% complete`
        }
        aria-valuemax={percent === null ? undefined : 100}
        aria-valuemin={percent === null ? undefined : 0}
        aria-valuenow={percent ?? undefined}
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-200"
        role="progressbar"
      >
        <div
          className={`h-full rounded-full bg-forest transition-all ${
            percent === null && active ? "w-1/3 animate-pulse" : ""
          }`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
    </section>
  );
}

function GitContextCard({ context }: { context: GitContext | undefined }) {
  const statusLabel = context?.workingTree
    ? {
        clean: "Clean working tree",
        dirty: "Uncommitted changes",
        "not-a-repository": "Not a Git repository",
        unavailable: "Git is unavailable",
        unknown: "Working-tree state unknown",
      }[context.workingTree]
    : "Git context not captured";
  const statusClass =
    context?.workingTree === "clean"
      ? "bg-green-50 text-green-800"
      : context?.workingTree === "dirty"
        ? "bg-amber-50 text-amber-800"
        : "bg-canvas text-muted";

  return (
    <section
      aria-label="Git context"
      className="rounded-2xl border border-line bg-white p-5 shadow-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-forest">
            Git context
          </p>
          <h2 className="mt-1 text-base font-semibold tracking-[-0.03em]">
            Repository revision
          </h2>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${statusClass}`}
        >
          {statusLabel}
        </span>
      </div>
      {context?.commit ? (
        <dl className="mt-3 space-y-2 text-[11px]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Commit</dt>
            <dd className="font-mono text-ink" title={context.commit}>
              {context.commit.slice(0, 12)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Branch</dt>
            <dd className="max-w-[65%] truncate text-right text-ink">
              {context.branch ?? "Detached HEAD"}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-2 text-[11px] leading-5 text-muted">
          {context?.workingTree === "not-a-repository"
            ? "Analysis is not associated with a Git commit."
            : context?.workingTree === "unavailable"
              ? "Git could not be found; analysis remains available without revision metadata."
              : context?.workingTree === "unknown"
                ? "Git metadata could not be read for this analysis."
                : "Re-analyze this repository to capture its Git context."}
        </p>
      )}
      {context?.workingTree === "dirty" && (
        <p className="mt-2 text-[10px] leading-4 text-muted">
          Source ranges describe the analyzed working tree; the commit above is
          its HEAD baseline.
        </p>
      )}
    </section>
  );
}

function RevisionHistoryCard({
  busyAction,
  isBusy,
  onExport,
  onLoad,
  onRestore,
  revisions,
}: {
  busyAction: string | null;
  isBusy: boolean;
  onExport: () => void;
  onLoad: () => void;
  onRestore: (revision: GraphRevisionSummary) => void;
  revisions: GraphRevisionSummary[] | null;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const current = revisions?.at(-1);
  const ordered = revisions ? [...revisions].reverse() : [];
  const sequenceOf = (id: string | null) =>
    revisions?.find((revision) => revision.id === id)?.sequence;

  return (
    <section
      aria-label="Revision history"
      className="rounded-2xl border border-line bg-white p-5 shadow-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-forest">
            History
          </p>
          <h2 className="mt-1 text-base font-semibold tracking-[-0.03em]">
            Graph revisions
          </h2>
        </div>
        <button
          className={secondaryButtonClass}
          disabled={isBusy}
          onClick={onExport}
          type="button"
        >
          {busyAction === "history-export" ? "Exporting…" : "Export"}
        </button>
      </div>
      {revisions === null ? (
        <button
          className={`${secondaryButtonClass} mt-3 w-full`}
          disabled={isBusy}
          onClick={onLoad}
          type="button"
        >
          {busyAction === "history-load" ? "Loading…" : "Show revision history"}
        </button>
      ) : (
        <>
          <p className="mt-2 text-[11px] leading-5 text-muted">
            Restoring saves an earlier graph as a new revision. Nothing is
            deleted.
          </p>
          <ol className="mt-3 max-h-72 space-y-2 overflow-y-auto">
            {ordered.map((revision) => {
              const isCurrent = revision.id === current?.id;
              const restoredFrom = sequenceOf(revision.restoredFromRevisionId);
              const { added, changed, removed } = revision.changeCounts;
              return (
                <li
                  className="rounded-xl border border-line bg-canvas p-3 text-[11px]"
                  key={revision.id}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink">
                      Revision {revision.sequence}
                      {isCurrent && (
                        <span className="ml-2 rounded-full bg-mist px-2 py-0.5 text-[10px] font-medium text-forest">
                          current
                        </span>
                      )}
                    </span>
                    <time
                      className="text-muted"
                      dateTime={new Date(revision.createdAt).toISOString()}
                    >
                      {new Date(revision.createdAt).toLocaleString()}
                    </time>
                  </div>
                  <p className="mt-1 text-muted">
                    {restoredFrom !== undefined
                      ? `Restored from revision ${restoredFrom}. `
                      : ""}
                    {added} added, {changed} changed, {removed} removed
                    {revision.sourceRevision
                      ? ` · source ${revision.sourceRevision.slice(0, 12)}`
                      : ""}
                  </p>
                  {!isCurrent &&
                    (pendingId === revision.id ? (
                      <div className="mt-2 flex gap-2">
                        <button
                          className={primaryButtonClass}
                          disabled={isBusy}
                          onClick={() => {
                            setPendingId(null);
                            onRestore(revision);
                          }}
                          type="button"
                        >
                          Confirm restore of revision {revision.sequence}
                        </button>
                        <button
                          className={secondaryButtonClass}
                          disabled={isBusy}
                          onClick={() => setPendingId(null)}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className={`${secondaryButtonClass} mt-2`}
                        disabled={isBusy}
                        onClick={() => setPendingId(revision.id)}
                        type="button"
                      >
                        {busyAction === "history-restore"
                          ? "Restoring…"
                          : "Restore this revision"}
                      </button>
                    ))}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

function CoverageMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-canvas px-3 py-2.5">
      <dt className="text-[10px] uppercase tracking-[0.12em] text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums text-ink">
        {value}
      </dd>
    </div>
  );
}

function DiagnosticsPanel({
  analysis,
  onSelectPath,
}: {
  analysis: AnalysisResult;
  onSelectPath: (path: string) => void;
}) {
  const diagnostics = analysis.diagnostics.slice(0, 6);
  return (
    <section
      aria-label="Analysis diagnostics"
      className="border-b border-line bg-amber-50/70 px-4 py-3"
    >
      <h3 className="text-xs font-semibold text-amber-950">
        Diagnostics ({analysis.diagnostics.length}
        {analysis.diagnosticsTruncated ? "+" : ""})
      </h3>
      <ul className="mt-2 space-y-2">
        {diagnostics.map((diagnostic, index) => (
          <li
            className="text-[11px] leading-4 text-amber-900"
            key={`${diagnostic.code}:${diagnostic.path ?? "repository"}:${index}`}
          >
            <span className="font-semibold">{diagnostic.code}</span>
            {diagnostic.path ? (
              <button
                className="ml-1 underline decoration-amber-700/40 underline-offset-2"
                onClick={() => onSelectPath(diagnostic.path!)}
                type="button"
              >
                {diagnostic.path}
              </button>
            ) : null}
            <p className="mt-0.5 text-amber-800">{diagnostic.message}</p>
          </li>
        ))}
        {analysis.diagnosticsTruncated && (
          <li className="text-[11px] text-amber-800">
            Additional diagnostics were omitted from this response.
          </li>
        )}
      </ul>
    </section>
  );
}

function EmptyExplorer({
  hasSnapshot,
  search,
}: {
  hasSnapshot: boolean;
  search: string;
}) {
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center px-6 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-canvas text-muted">
        <SearchGlyph />
      </span>
      <h3 className="mt-3 text-sm font-semibold text-ink">
        {hasSnapshot
          ? search
            ? "No matching items"
            : "No files or symbols in this graph"
          : "Start with a repository"}
      </h3>
      <p className="mt-1.5 max-w-xs text-xs leading-5 text-muted">
        {hasSnapshot
          ? search
            ? "Try a different name or path."
            : "This snapshot has no browsable files or symbols."
          : "Connect to your local agent, enter a repository folder, and run an analysis."}
      </p>
    </div>
  );
}

function EntityDetails({
  canMapToIntendedComponent,
  entity,
  evidence,
  intendedComponent,
  isMapping,
  isMapped,
  isUnmapping,
  onUnmapFromIntendedComponent,
  onMapToIntendedComponent,
  onCopyLocation,
  onSelectEntity,
  relationships,
  sourceNavigation,
  onVerifySource,
  isCheckingSource,
  sourceFreshness,
}: {
  canMapToIntendedComponent: boolean;
  entity: GraphEntity;
  evidence: Evidence[];
  intendedComponent: GraphEntity | null;
  isMapping: boolean;
  isMapped: boolean;
  isUnmapping: boolean;
  onMapToIntendedComponent: () => void;
  onUnmapFromIntendedComponent: () => void;
  onCopyLocation: (locator: SourceLocator) => void;
  onSelectEntity: (entityId: string) => void;
  relationships: {
    other: GraphEntity;
    relationship: GraphRelationship;
    evidence: Evidence[];
  }[];
  sourceNavigation: { uri: string | null; error: string | null };
  onVerifySource: () => void;
  isCheckingSource: boolean;
  sourceFreshness: SourceFreshness | null;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-mist px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-forest">
          {entity.kind}
        </span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
          {entity.state}
        </span>
      </div>
      <h2 className="mt-3 break-words text-2xl font-semibold leading-tight tracking-[-0.05em]">
        {entity.name}
      </h2>

      {entity.source ? (
        <div className="mt-5 rounded-xl border border-line bg-canvas p-3.5">
          <div className="flex flex-col gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                Source location
              </p>
              <p className="mt-1 break-all font-mono text-xs leading-5 text-ink">
                {entity.source.repositoryRelativePath}
              </p>
              <p className="mt-1 text-[11px] text-muted">
                {formatRange(entity.source)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className={`${secondaryButtonClass} min-h-8 px-2.5 py-1.5 text-[10px]`}
                disabled={isCheckingSource}
                onClick={onVerifySource}
                type="button"
              >
                {isCheckingSource ? "Checking source…" : "Check freshness"}
              </button>
              <a
                aria-disabled={!sourceNavigation.uri}
                aria-label={`Open ${entity.source.repositoryRelativePath} at line ${entity.source.range.start.line} in VS Code`}
                className={`${secondaryButtonClass} min-h-8 px-2.5 py-1.5 text-[10px] ${sourceNavigation.uri ? "" : "pointer-events-none opacity-45"}`}
                href={sourceNavigation.uri ?? undefined}
                rel="noreferrer"
                tabIndex={sourceNavigation.uri ? 0 : -1}
              >
                Open in VS Code
              </a>
              <button
                aria-label={`Copy source location for ${entity.name}`}
                className="shrink-0 rounded-xl border border-line bg-white px-2.5 py-1.5 text-[10px] font-semibold text-ink hover:bg-mist focus-visible:outline-2 focus-visible:outline-forest"
                onClick={() => onCopyLocation(entity.source!)}
                type="button"
              >
                Copy location
              </button>
            </div>
            {sourceFreshness && sourceFreshness.status !== "current" && (
              <p className="text-[10px] leading-4 text-red-800" role="status">
                {sourceFreshness.message}
              </p>
            )}
            {!sourceNavigation.uri && !sourceFreshness && (
              <p className="text-[10px] leading-4 text-muted">
                {sourceNavigation.error ??
                  "Enter the repository folder path to enable editor navigation."}
              </p>
            )}
          </div>
          <p className="mt-2 border-t border-line pt-2 text-[10px] leading-4 text-muted">
            Revision: {entity.source.revision ?? "not specified"}
          </p>
        </div>
      ) : (
        <p className="mt-4 rounded-xl bg-canvas p-3 text-xs text-muted">
          No source location is recorded for this item.
        </p>
      )}

      {entity.state === "actual" &&
        (entity.kind === "file" || entity.kind === "symbol") && (
          <section className="mt-6 rounded-xl border border-line bg-canvas p-3.5">
            <h3 className="text-xs font-semibold text-ink">
              Intended architecture
            </h3>
            {intendedComponent ? (
              <>
                <p className="mt-1.5 text-[11px] leading-5 text-muted">
                  Map this observed item to{" "}
                  <span className="font-medium text-ink">
                    {intendedComponent.name}
                  </span>
                  .
                </p>
                <button
                  className={`${secondaryButtonClass} mt-2 min-h-8 px-2.5 py-1.5 text-[10px]`}
                  disabled={!canMapToIntendedComponent}
                  onClick={onMapToIntendedComponent}
                  type="button"
                >
                  {isMapping ? "Mapping…" : "Map selected code to component"}
                </button>
                {isMapped && (
                  <button
                    className={`${secondaryButtonClass} mt-2 min-h-8 px-2.5 py-1.5 text-[10px]`}
                    disabled={isUnmapping}
                    onClick={onUnmapFromIntendedComponent}
                    type="button"
                  >
                    {isUnmapping ? "Removing mapping…" : "Remove mapping"}
                  </button>
                )}
              </>
            ) : (
              <p className="mt-1.5 text-[11px] leading-5 text-muted">
                Create an intended component in the sidebar to map this code
                item.
              </p>
            )}
          </section>
        )}

      <section className="mt-6">
        <SectionHeading count={relationships.length} title="Relationships" />
        {relationships.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {relationships.map(
              ({ other, relationship, evidence: edgeEvidence }) => (
                <li
                  className="rounded-xl border border-line p-3"
                  key={relationship.id}
                >
                  <button
                    className="flex w-full items-center justify-between gap-2 text-left"
                    onClick={() => onSelectEntity(other.id)}
                    type="button"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-forest">
                      {relationship.type.replaceAll("_", " ")}
                    </span>
                    <span aria-hidden="true" className="text-muted">
                      ↗
                    </span>
                  </button>
                  <p className="mt-1 break-words text-sm font-medium">
                    {other.name}
                  </p>
                  <EvidenceList evidence={edgeEvidence} compact />
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="mt-3 text-xs leading-5 text-muted">
            No graph relationships are attached to this item.
          </p>
        )}
      </section>

      <section className="mt-6 border-t border-line pt-5">
        <SectionHeading count={evidence.length} title="Evidence" />
        <EvidenceList evidence={evidence} />
      </section>
    </div>
  );
}

function SectionHeading({ count, title }: { count: number; title: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold tracking-[-0.02em]">{title}</h3>
      <span className="text-[11px] tabular-nums text-muted">{count}</span>
    </div>
  );
}

function EvidenceList({
  evidence,
  compact = false,
}: {
  evidence: Evidence[];
  compact?: boolean;
}) {
  if (evidence.length === 0) {
    return (
      <p className={`${compact ? "mt-2" : "mt-3"} text-[11px] text-muted`}>
        No evidence details are attached.
      </p>
    );
  }
  return (
    <ul className={`${compact ? "mt-2" : "mt-3"} space-y-2`}>
      {evidence.map((item) => (
        <li
          className={`${compact ? "text-[10px]" : "text-xs"} leading-5 text-muted`}
          key={item.id}
        >
          <span className="mr-1.5 rounded bg-canvas px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-forest">
            {item.origin}
          </span>
          {item.description}
          {item.source && (
            <span className="mt-1 block font-mono text-[10px] text-muted">
              {item.source.repositoryRelativePath} · {formatRange(item.source)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function evidenceForEntity(
  snapshot: GraphSnapshot | null,
  entity: GraphEntity,
): Evidence[] {
  const ids = new Set(entity.evidenceIds);
  return snapshot?.evidence.filter((item) => ids.has(item.id)) ?? [];
}

function relationshipsForEntity(
  snapshot: GraphSnapshot | null,
  entity: GraphEntity,
  entityById: Map<string, GraphEntity>,
): {
  other: GraphEntity;
  relationship: GraphRelationship;
  evidence: Evidence[];
}[] {
  if (!snapshot) {
    return [];
  }
  return snapshot.relationships.flatMap((relationship) => {
    const outgoing = relationship.sourceEntityId === entity.id;
    const incoming = relationship.targetEntityId === entity.id;
    if (!outgoing && !incoming) {
      return [];
    }
    const otherId = outgoing
      ? relationship.targetEntityId
      : relationship.sourceEntityId;
    const other = entityById.get(otherId);
    if (!other) {
      return [];
    }
    const evidenceIds = new Set(relationship.evidenceIds);
    return [
      {
        other,
        relationship,
        evidence: snapshot.evidence.filter((item) => evidenceIds.has(item.id)),
      },
    ];
  });
}

function repositoryName(
  snapshot: GraphSnapshot,
  repositoryPath: string,
): string {
  const repositoryEntity = snapshot.entities.find(
    (entity) => entity.kind === "repository",
  );
  if (repositoryEntity) {
    return repositoryEntity.name;
  }
  const trimmedPath = repositoryPath.trim().replace(/[\\/]+$/, "");
  const pathParts = trimmedPath.split(/[\\/]/);
  return pathParts.at(-1) || "Repository map";
}

function sourcePath(entity: GraphEntity): string {
  return entity.source?.repositoryRelativePath ?? "Source location unavailable";
}

function formatRange(locator: SourceLocator): string {
  const { start, end } = locator.range;
  return `Line ${start.line}, column ${start.column + 1} – line ${end.line}, column ${end.column + 1}`;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : "An unexpected error occurred.";
}

function SearchGlyph() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
    >
      <circle
        cx="10.8"
        cy="10.8"
        r="6.8"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="m16 16 4.2 4.2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function MapGlyph() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="22"
      viewBox="0 0 24 24"
      width="22"
    >
      <rect
        height="5"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.6"
        width="7"
        x="2.5"
        y="3"
      />
      <rect
        height="5"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.6"
        width="7"
        x="14.5"
        y="16"
      />
      <rect
        height="5"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.6"
        width="7"
        x="2.5"
        y="16"
      />
      <path
        d="M9.5 5.5h2.3a2 2 0 0 1 2 2v10.8M9.5 18.5h3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}
