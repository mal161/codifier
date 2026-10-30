import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  Evidence,
  GraphEntity,
  GraphRelationship,
  GraphSnapshot,
  SourceLocator,
} from "@codifier/domain";
import type { AnalysisJob } from "@codifier/contracts";
import {
  cancelAnalysisJob,
  checkAgent,
  getAnalysisJob,
  getGraph,
  normalizeAgentUrl,
  startAnalysisJob,
  type AnalysisResult,
} from "./agent/client.js";
import { createVscodeUri } from "./navigation/vscode.js";

const defaultAgentUrl = "http://127.0.0.1:4141";
const maxVisibleEntities = 250;

export function App() {
  const [agentUrl, setAgentUrl] = useState(defaultAgentUrl);
  const [token, setToken] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [snapshotRootPath, setSnapshotRootPath] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisJob, setAnalysisJob] = useState<AnalysisJob | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busyAction, setBusyAction] = useState<
    "connect" | "load" | "analyze" | null
  >(null);
  const isBusy = busyAction !== null;
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const entities = snapshot?.entities ?? [];
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
  const selectedEntity =
    visibleEntities.find((entity) => entity.id === selectedEntityId) ??
    visibleEntities[0] ??
    null;
  const sourceNavigation = useMemo(() => {
    const sourceRootPath = snapshotRootPath.trim() || repositoryPath.trim();
    if (!selectedEntity?.source || !sourceRootPath) {
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
  }, [repositoryPath, selectedEntity, snapshotRootPath]);

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
      setSnapshotRootPath(repositoryPath.trim());
      setAnalysis(null);
      setAnalysisJob(null);
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
    try {
      const baseUrl = normalizeAgentUrl(agentUrl);
      let job = await startAnalysisJob(
        baseUrl,
        token,
        repositoryPath,
        repositoryId.trim() || undefined,
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
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-5 px-5 py-4 sm:px-8">
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
                {busyAction === "connect" ? "Connecting…" : "Connect to agent"}
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
              <Field label="Repository folder path" htmlFor="repository-path">
                <input
                  autoComplete="off"
                  className={inputClass}
                  disabled={isBusy}
                  id="repository-path"
                  onChange={(event) => setRepositoryPath(event.target.value)}
                  placeholder="C:\projects\my-app"
                  spellCheck={false}
                  value={repositoryPath}
                />
                <span className="mt-1.5 block text-[11px] leading-4 text-muted">
                  The agent reads this folder locally. No source is uploaded.
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
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={primaryButtonClass}
                  disabled={isBusy || token.length === 0}
                  type="submit"
                >
                  {busyAction === "analyze" ? "Analyzing…" : "Analyze folder"}
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

          {analysis?.changeSummary && (
            <AnalysisChangeSummaryCard summary={analysis.changeSummary} />
          )}
          {analysis && <CoverageCard analysis={analysis} />}
          <p className="px-1 text-[11px] leading-5 text-muted">
            Analysis runs on your machine. Unsupported files and diagnostics are
            shown rather than silently treated as complete.
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
          </div>

          {analysis?.diagnostics.length ? (
            <DiagnosticsPanel
              analysis={analysis}
              onSelectPath={(path) => setSearch(path)}
            />
          ) : null}

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
              <EmptyExplorer hasSnapshot={snapshot !== null} search={search} />
            )}
            {visibleEntities.length > maxVisibleEntities && (
              <p className="px-3 py-3 text-center text-[11px] leading-5 text-muted">
                Showing the first {maxVisibleEntities} of{" "}
                {visibleEntities.length} items. Refine your search to narrow the
                list.
              </p>
            )}
          </div>
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
              onSelectEntity={setSelectedEntityId}
              relationships={relatedItems}
              sourceNavigation={sourceNavigation}
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
  entity,
  evidence,
  onCopyLocation,
  onSelectEntity,
  relationships,
  sourceNavigation,
}: {
  entity: GraphEntity;
  evidence: Evidence[];
  onCopyLocation: (locator: SourceLocator) => void;
  onSelectEntity: (entityId: string) => void;
  relationships: {
    other: GraphEntity;
    relationship: GraphRelationship;
    evidence: Evidence[];
  }[];
  sourceNavigation: { uri: string | null; error: string | null };
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
            {!sourceNavigation.uri && (
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
            No analyzed relationships are attached to this item.
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
