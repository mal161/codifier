import { createHash } from "node:crypto";
import {
  closeSync,
  openSync,
  lstatSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { lstat, open, opendir, realpath, stat } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  validateGraphSnapshot,
  type Evidence,
  type GraphEntity,
  type GraphRelationship,
  type GraphSnapshot,
  type SourceLocator,
  type SourceRange,
} from "@codifier/domain";
import ts from "typescript";

const supportedExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);
const excludedDirectoryNames = new Set([
  ".codifier",
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);
const maxDiagnosticCount = 200;
const maxPersistBlockerExamples = 5;
const defaultMaxFileCount = 10_000;
const defaultMaxFileBytes = 1_048_576;
const defaultMaxTotalBytes = 104_857_600;

export interface RepositoryAnalysisOptions {
  repositoryId: string;
  repositoryRoot: string;
  revision?: string | null;
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  excludePatterns?: string[];
  respectGitignore?: boolean;
  previousSnapshot?: GraphSnapshot | null;
  signal?: AbortSignal;
  onProgress?: (progress: RepositoryAnalysisProgress) => void;
}

export interface RepositoryAnalysisProgress {
  phase: "inventory" | "reading" | "parsing" | "resolving";
  currentFile: string | null;
  completedFiles: number;
  totalFiles: number | null;
}

export interface AnalysisDiagnostic {
  code: string;
  severity: "warning" | "error";
  message: string;
  path?: string;
  range?: SourceRange;
}

export interface AnalysisCoverage {
  filesDiscovered: number;
  supportedFiles: number;
  analyzedFiles: number;
  unsupportedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  excludedDirectories: number;
  truncated: boolean;
}

export interface RepositoryAnalysisReport {
  snapshot: GraphSnapshot;
  coverage: AnalysisCoverage;
  diagnostics: AnalysisDiagnostic[];
  diagnosticsTruncated: boolean;
  canPersist: boolean;
  /** Why the pass may not replace the saved graph; empty when canPersist. */
  persistBlockers: PersistBlocker[];
  reconciliation: AnalysisReconciliation;
}

export type PersistBlockerReason =
  | "no_analyzed_files"
  | "failed_files"
  | "skipped_files"
  | "truncated";

export interface PersistBlockerExample {
  path?: string;
  code: string;
}

export interface PersistBlocker {
  reason: PersistBlockerReason;
  count: number;
  message: string;
  examples: PersistBlockerExample[];
}

export interface AnalysisReconciliation {
  mode: "initial" | "unchanged" | "full-fallback";
  addedFiles: string[];
  changedFiles: string[];
  removedFiles: string[];
  renamedFiles: Array<{ from: string; to: string }>;
  reason: string;
}

export interface SourceFreshnessResult {
  status: "current" | "stale" | "unresolved";
  message: string;
}

export class RepositoryAnalysisError extends Error {
  constructor(
    public readonly code:
      | "invalid_repository_id"
      | "invalid_repository_root"
      | "invalid_analysis_options"
      | "repository_unavailable",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RepositoryAnalysisError";
  }
}

export class RepositoryAnalysisCancelledError extends Error {
  constructor() {
    super("Repository analysis was cancelled.");
    this.name = "RepositoryAnalysisCancelledError";
  }
}

export async function validateSourceFreshness(
  repositoryRoot: string,
  snapshot: GraphSnapshot,
  entityId: string,
): Promise<SourceFreshnessResult> {
  const entity = snapshot.entities.find(
    (candidate) => candidate.id === entityId && candidate.state === "actual",
  );
  if (!entity?.source || entity.source.repositoryId !== snapshot.repositoryId) {
    return { status: "unresolved", message: "This graph item has no verifiable source location." };
  }
  let root: string;
  try {
    root = await resolveRepositoryRoot(repositoryRoot);
  } catch {
    return { status: "unresolved", message: "The selected repository folder is unavailable." };
  }
  const relativePath = entity.source.repositoryRelativePath;
  const fileEntity = snapshot.entities.find(
    (candidate) =>
      candidate.kind === "file" &&
      candidate.source?.repositoryRelativePath === relativePath,
  );
  const expectedHash = fileEntity?.evidenceIds
    .map((id) => snapshot.evidence.find((item) => item.id === id)?.description ?? "")
    .map((description) => /sha256:([0-9a-f]{64})/.exec(description)?.[1])
    .find((hash) => hash !== undefined);
  if (!expectedHash) {
    return { status: "unresolved", message: "The graph has no source fingerprint for this file." };
  }
  const absolutePath = resolve(root, ...relativePath.split("/"));
  if (!isWithinRoot(root, absolutePath)) {
    return { status: "unresolved", message: "The recorded path escapes the selected repository." };
  }
  try {
    const metadata = await lstat(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      return { status: "unresolved", message: "The recorded source is not a regular file." };
    }
    const actualPath = await realpath(absolutePath);
    if (!isWithinRoot(root, actualPath)) {
      return { status: "unresolved", message: "The recorded source resolves outside the selected repository." };
    }
    const { contents } = await readBoundedFile(
      absolutePath,
      defaultMaxFileBytes,
      undefined,
    );
    if (sha256(contents) !== expectedHash) {
      return { status: "stale", message: "The file changed after this location was analyzed. Re-analyze before opening it." };
    }
    return { status: "current", message: "The file matches the analyzed source revision." };
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { status: "stale", message: "The recorded source file is missing. Re-analyze before opening it." };
    }
    return { status: "unresolved", message: "The source file could not be safely verified." };
  }
}

interface InventoryFile {
  absolutePath: string;
  relativePath: string;
  byteLength: number;
  contents: string;
  contentHash: string;
  sourceFile: ts.SourceFile;
}

interface FileCandidate {
  absolutePath: string;
  relativePath: string;
  byteLength: number;
}

interface GitignoreRule {
  basePath: string;
  pattern: string;
  negated: boolean;
  directoryOnly: boolean;
  anchored: boolean;
}

interface GitignoreReadBudget {
  fileCount: number;
  totalBytes: number;
}

interface Declaration {
  kind: string;
  name: string;
  localName: string;
  start: number;
  end: number;
  fingerprint: string;
  parent?: Declaration;
  routeTargets?: Declaration[];
}

interface AnalyzerProjectConfig {
  compilerOptions: ts.CompilerOptions;
  diagnostics: AnalysisDiagnostic[];
}

interface ProjectConfigReadBudget {
  contents: Map<string, string>;
  totalBytes: number;
  limitReached: boolean;
}

interface WorkspacePackage {
  name: string;
  rootPath: string;
  manifest: Record<string, unknown>;
}

interface PreviousIdentityIndex {
  files: GraphEntity[];
  symbolsByPath: Map<string, GraphEntity[]>;
  evidenceById: Map<string, Evidence>;
}

interface IdentityAllocator {
  fileIds: Map<string, string>;
  symbolId(
    file: InventoryFile,
    declaration: Declaration,
    declarations: Declaration[],
    ordinal: number,
  ): string;
}

export async function analyzeRepository(
  options: RepositoryAnalysisOptions,
): Promise<RepositoryAnalysisReport> {
  throwIfCancelled(options.signal);
  assertUuid(options.repositoryId, "Repository identifier");
  if (options.revision !== undefined && options.revision !== null) {
    if (options.revision.length === 0) {
      throw new RepositoryAnalysisError(
        "invalid_analysis_options",
        "Revision must be non-empty or null.",
      );
    }
  }
  if (
    options.excludePatterns !== undefined &&
    (!Array.isArray(options.excludePatterns) ||
      options.excludePatterns.length > 256 ||
      options.excludePatterns.some(
        (pattern) =>
          typeof pattern !== "string" ||
          pattern.length === 0 ||
          pattern.length > 256 ||
          pattern.split("/").some((segment) => segment === "..") ||
          pattern.startsWith("!") ||
          pattern.startsWith("/") ||
          pattern.includes("\\"),
      ))
  ) {
    throw new RepositoryAnalysisError(
      "invalid_analysis_options",
      "Exclusion patterns must be additive repository-relative globs with no negation or traversal segments, at most 256 characters each and 256 patterns total.",
    );
  }

  const limits = {
    maxFiles: options.maxFiles ?? defaultMaxFileCount,
    maxFileBytes: options.maxFileBytes ?? defaultMaxFileBytes,
    maxTotalBytes: options.maxTotalBytes ?? defaultMaxTotalBytes,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RepositoryAnalysisError(
        "invalid_analysis_options",
        `${name} must be a positive safe integer.`,
      );
    }
  }

  const repositoryRoot = await resolveRepositoryRoot(options.repositoryRoot);
  throwIfCancelled(options.signal);
  if (
    options.previousSnapshot &&
    (options.previousSnapshot.repositoryId !== options.repositoryId ||
      validateGraphSnapshot(options.previousSnapshot).length > 0)
  ) {
    throw new RepositoryAnalysisError(
      "invalid_analysis_options",
      "Previous graph must be a valid snapshot for the same repository.",
    );
  }
  const coverage: AnalysisCoverage = {
    filesDiscovered: 0,
    supportedFiles: 0,
    analyzedFiles: 0,
    unsupportedFiles: 0,
    skippedFiles: 0,
    failedFiles: 0,
    excludedDirectories: 0,
    truncated: false,
  };
  const diagnostics: AnalysisDiagnostic[] = [];
  let diagnosticsTruncated = false;
  const reportDiagnostic = (diagnostic: AnalysisDiagnostic): void => {
    if (diagnostics.length >= maxDiagnosticCount) {
      diagnosticsTruncated = true;
      return;
    }
    if (diagnostic.path === "") {
      const repositoryDiagnostic = { ...diagnostic };
      delete repositoryDiagnostic.path;
      diagnostics.push(repositoryDiagnostic);
      return;
    }
    diagnostics.push(diagnostic);
  };
  // Persistence blockers keep their own bounded examples so the reason a
  // pass was not saved survives diagnostic truncation.
  const blockerExamples: Record<"skipped" | "failed", PersistBlockerExample[]> =
    { skipped: [], failed: [] };
  const recordBlockedFile = (
    kind: "skipped" | "failed",
    path: string | undefined,
    code: string,
  ): void => {
    if (kind === "skipped") coverage.skippedFiles += 1;
    else coverage.failedFiles += 1;
    const examples = blockerExamples[kind];
    if (examples.length < maxPersistBlockerExamples) {
      examples.push(path ? { path, code } : { code });
    }
  };
  const reportSkippedFile = (diagnostic: AnalysisDiagnostic): void => {
    recordBlockedFile("skipped", diagnostic.path, diagnostic.code);
    reportDiagnostic(diagnostic);
  };
  const reportFailedFile = (diagnostic: AnalysisDiagnostic): void => {
    recordBlockedFile("failed", diagnostic.path, diagnostic.code);
    reportDiagnostic(diagnostic);
  };
  const reportProgress = (progress: RepositoryAnalysisProgress): void =>
    options.onProgress?.(progress);
  reportProgress({
    phase: "inventory",
    currentFile: null,
    completedFiles: 0,
    totalFiles: null,
  });
  const projectConfigReadBudget: ProjectConfigReadBudget = {
    contents: new Map(),
    totalBytes: 0,
    limitReached: false,
  };
  const projectConfig = await loadProjectConfig(
    repositoryRoot,
    options.signal,
    "tsconfig.json",
    projectConfigReadBudget,
  );
  throwIfCancelled(options.signal);
  projectConfig.diagnostics.forEach(reportDiagnostic);

  const candidates = await inventoryRepository(
    repositoryRoot,
    coverage,
    reportDiagnostic,
    reportSkippedFile,
    reportFailedFile,
    () => {
      coverage.truncated = true;
    },
    limits.maxFiles,
    options.signal,
    reportProgress,
    options.excludePatterns ?? [],
    options.respectGitignore ?? true,
  );
  const inventoriedPaths = new Set(
    candidates.map((candidate) => candidate.relativePath),
  );
  const projectConfigs = new Map<string, AnalyzerProjectConfig>([
    [repositoryRoot, projectConfig],
  ]);
  const projectConfigCandidates = candidates
    .filter(
      (candidate) =>
        candidate.relativePath.split("/").at(-1) === "tsconfig.json" &&
        dirname(candidate.absolutePath) !== repositoryRoot,
    )
    .sort(
      (left, right) =>
        left.relativePath.split("/").length -
        right.relativePath.split("/").length,
    );
  for (const candidate of projectConfigCandidates) {
    throwIfCancelled(options.signal);
    if (projectConfigs.size >= 32) {
      reportDiagnostic({
        code: "tsconfig_project_limit",
        severity: "warning",
        message:
          "Only the first 32 repository TypeScript project configurations are used for import resolution.",
        path: candidate.relativePath,
      });
      break;
    }
    const config = await loadProjectConfig(
      repositoryRoot,
      options.signal,
      candidate.relativePath,
      projectConfigReadBudget,
    );
    projectConfigs.set(dirname(candidate.absolutePath), config);
    config.diagnostics.forEach(reportDiagnostic);
  }
  const workspacePackages = new Map<string, WorkspacePackage>();
  const ambiguousWorkspacePackageNames = new Set<string>();
  const files: InventoryFile[] = [];
  let totalBytesRead = 0;
  let processedCandidates = 0;
  reportProgress({
    phase: "reading",
    currentFile: null,
    completedFiles: 0,
    totalFiles: candidates.length,
  });

  for (const candidate of candidates) {
    throwIfCancelled(options.signal);
    if (candidate.relativePath.split("/").at(-1) === "package.json") {
      coverage.unsupportedFiles += 1;
      reportDiagnostic({
        code: "unsupported_file",
        severity: "warning",
        message: "File type is not supported by the current analyzer.",
        path: candidate.relativePath,
      });
      const remainingBytes = limits.maxTotalBytes - totalBytesRead;
      if (candidate.byteLength > limits.maxFileBytes) {
        reportSkippedFile({
          code: "workspace_package_manifest_too_large",
          severity: "warning",
          message:
            "Package manifest exceeds the configured file-size limit and was not used for import resolution.",
          path: candidate.relativePath,
        });
      } else if (candidate.byteLength > remainingBytes) {
        reportSkippedFile({
          code: "analysis_size_limit",
          severity: "warning",
          message:
            "Package manifest skipped because the total analysis size limit was reached.",
          path: candidate.relativePath,
        });
      } else {
        try {
          const { contents, byteLength } = await readBoundedFile(
            candidate.absolutePath,
            Math.min(limits.maxFileBytes, remainingBytes),
            options.signal,
          );
          totalBytesRead += byteLength;
          const workspacePackage = parseWorkspacePackage(
            candidate,
            repositoryRoot,
            contents,
            reportDiagnostic,
          );
          if (workspacePackage) {
            const existing = workspacePackages.get(workspacePackage.name);
            if (existing) {
              workspacePackages.delete(workspacePackage.name);
              ambiguousWorkspacePackageNames.add(workspacePackage.name);
              reportDiagnostic({
                code: "workspace_package_name_ambiguous",
                severity: "warning",
                message: `Multiple in-repository packages declare the name "${workspacePackage.name}"; package imports using that name were not resolved.`,
                path: candidate.relativePath,
              });
            } else if (
              !ambiguousWorkspacePackageNames.has(workspacePackage.name)
            ) {
              workspacePackages.set(workspacePackage.name, workspacePackage);
            }
          }
        } catch (error) {
          if (error instanceof RepositoryAnalysisCancelledError) {
            throw error;
          }
          reportSkippedFile({
            code: "workspace_package_manifest_read_failed",
            severity: "warning",
            message:
              "Package manifest could not be read and was not used for import resolution.",
            path: candidate.relativePath,
          });
        }
      }
      processedCandidates += 1;
      reportProgress({
        phase: "reading",
        currentFile: candidate.relativePath,
        completedFiles: processedCandidates,
        totalFiles: candidates.length,
      });
      await yieldToEventLoop(options.signal);
      continue;
    }

    if (
      !supportedExtensions.has(extname(candidate.relativePath).toLowerCase())
    ) {
      coverage.unsupportedFiles += 1;
      reportDiagnostic({
        code: "unsupported_file",
        severity: "warning",
        message: "File type is not supported by the current analyzer.",
        path: candidate.relativePath,
      });
      processedCandidates += 1;
      reportProgress({
        phase: "reading",
        currentFile: candidate.relativePath,
        completedFiles: processedCandidates,
        totalFiles: candidates.length,
      });
      await yieldToEventLoop(options.signal);
      continue;
    }

    coverage.supportedFiles += 1;
    if (candidate.byteLength > limits.maxFileBytes) {
      reportSkippedFile({
        code: "file_too_large",
        severity: "warning",
        message: `File exceeds the ${limits.maxFileBytes}-byte analysis limit.`,
        path: candidate.relativePath,
      });
      processedCandidates += 1;
      reportProgress({
        phase: "reading",
        currentFile: candidate.relativePath,
        completedFiles: processedCandidates,
        totalFiles: candidates.length,
      });
      await yieldToEventLoop(options.signal);
      continue;
    }

    const remainingBytes = limits.maxTotalBytes - totalBytesRead;
    if (candidate.byteLength > remainingBytes) {
      reportSkippedFile({
        code: "analysis_size_limit",
        severity: "warning",
        message:
          "File skipped because the total analysis size limit was reached.",
        path: candidate.relativePath,
      });
      processedCandidates += 1;
      reportProgress({
        phase: "reading",
        currentFile: candidate.relativePath,
        completedFiles: processedCandidates,
        totalFiles: candidates.length,
      });
      await yieldToEventLoop(options.signal);
      continue;
    }

    try {
      const { contents, byteLength } = await readBoundedFile(
        candidate.absolutePath,
        Math.min(limits.maxFileBytes, remainingBytes),
        options.signal,
      );
      totalBytesRead += byteLength;
      const sourceFile = ts.createSourceFile(
        candidate.absolutePath,
        contents,
        ts.ScriptTarget.Latest,
        true,
        scriptKindForPath(candidate.relativePath),
      );
      files.push({
        ...candidate,
        byteLength,
        contents,
        contentHash: sha256(contents),
        sourceFile,
      });
    } catch (error) {
      if (error instanceof RepositoryAnalysisCancelledError) {
        throw error;
      }
      reportSkippedFile({
        code:
          error instanceof FileLimitError
            ? "file_changed_during_analysis"
            : "file_read_failed",
        severity: "warning",
        message:
          error instanceof FileLimitError
            ? "File exceeded the configured size limit while being read."
            : "File could not be read; check repository permissions and retry.",
        path: candidate.relativePath,
      });
    }
    processedCandidates += 1;
    reportProgress({
      phase: "reading",
      currentFile: candidate.relativePath,
      completedFiles: processedCandidates,
      totalFiles: candidates.length,
    });
    await yieldToEventLoop(options.signal);
  }

  throwIfCancelled(options.signal);
  reportProgress({
    phase: "parsing",
    currentFile: null,
    completedFiles: 0,
    totalFiles: files.length,
  });
  const syntacticDiagnostics = await getSyntacticDiagnostics(
    files,
    options.signal,
  );
  throwIfCancelled(options.signal);
  const diagnosticsByFile = new Map<string, ts.Diagnostic[]>();
  for (const diagnostic of syntacticDiagnostics) {
    const file = diagnostic.file;
    if (!file) {
      continue;
    }
    const key = canonicalPath(file.fileName);
    const entries = diagnosticsByFile.get(key) ?? [];
    entries.push(diagnostic);
    diagnosticsByFile.set(key, entries);
  }

  const previous = buildPreviousIdentityIndex(options.previousSnapshot);
  const previousFileForCurrent = reconcileFiles(
    files,
    previous,
    reportDiagnostic,
  );
  const identityAllocator = createIdentityAllocator(
    options.repositoryId,
    files,
    previous,
    previousFileForCurrent,
    reportDiagnostic,
  );

  const entities: GraphEntity[] = [];
  const evidence: Evidence[] = [];
  const relationships: GraphRelationship[] = [];
  const fileEntityIds = new Map<string, string>();
  const revision = options.revision ?? null;

  let analyzedFileCount = 0;
  for (const file of files) {
    throwIfCancelled(options.signal);
    const fileId =
      identityAllocator.fileIds.get(file.relativePath) ??
      stableUuid(`${options.repositoryId}:file:${file.relativePath}`);
    const fileHash = file.contentHash;
    const fileEvidenceId = stableUuid(
      `${options.repositoryId}:evidence:file:${file.relativePath}`,
    );
    const fileLocator = sourceLocator(
      options.repositoryId,
      file.relativePath,
      revision,
      file.sourceFile,
      0,
      file.sourceFile.end,
    );
    entities.push({
      id: fileId,
      kind: "file",
      name: file.relativePath,
      state: "actual",
      evidenceIds: [fileEvidenceId],
      source: fileLocator,
    });
    evidence.push({
      id: fileEvidenceId,
      origin: "source-analysis",
      description: `File discovered by the TypeScript syntax adapter. sha256:${fileHash}`,
      source: fileLocator,
    });
    fileEntityIds.set(file.relativePath, fileId);

    const fileDiagnostics =
      diagnosticsByFile.get(canonicalPath(file.absolutePath)) ?? [];
    if (fileDiagnostics.length > 0) {
      recordBlockedFile("failed", file.relativePath, "syntax_error");
      for (const diagnostic of fileDiagnostics) {
        const start = diagnostic.start ?? 0;
        const end = start + (diagnostic.length ?? 0);
        reportDiagnostic({
          code: `syntax_${diagnostic.code}`,
          severity: "error",
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
          path: file.relativePath,
          range: sourceRange(file.sourceFile, start, end),
        });
      }
    } else {
      coverage.analyzedFiles += 1;
    }

    const declarations = getDeclarations(file.sourceFile);
    declarations.push(...getRouteDeclarations(file.sourceFile, declarations));
    const ordinals = new Map<string, number>();
    const declarationIds = new Map<Declaration, string>();
    for (const declaration of declarations) {
      const key = `${declaration.kind}:${declaration.name}`;
      const ordinal = ordinals.get(key) ?? 0;
      ordinals.set(key, ordinal + 1);
      const entityId = identityAllocator.symbolId(
        file,
        declaration,
        declarations,
        ordinal,
      );
      const evidenceId = stableUuid(
        `${options.repositoryId}:evidence:symbol:${file.relativePath}:${key}:${ordinal}`,
      );
      const locator = sourceLocator(
        options.repositoryId,
        file.relativePath,
        revision,
        file.sourceFile,
        declaration.start,
        declaration.end,
      );
      entities.push({
        id: entityId,
        kind: "symbol",
        name: declaration.name,
        state: "actual",
        evidenceIds: [evidenceId],
        source: locator,
      });
      declarationIds.set(declaration, entityId);
      evidence.push({
        id: evidenceId,
        origin: "source-analysis",
        description: `${declaration.kind} declaration discovered by syntax analysis. fingerprint:${declaration.fingerprint}`,
        source: locator,
      });
      const containingEntityId = declaration.parent
        ? declarationIds.get(declaration.parent)
        : fileId;
      if (!containingEntityId) {
        throw new Error(
          `Analyzer could not resolve the parent of declaration "${declaration.name}".`,
        );
      }
      relationships.push({
        id: stableUuid(
          `${options.repositoryId}:contains:${containingEntityId}:${entityId}`,
        ),
        sourceEntityId: containingEntityId,
        targetEntityId: entityId,
        type: "CONTAINS",
        state: "actual",
        evidenceIds: [evidenceId],
      });
    }

    addFrameworkRelationships(
      file,
      declarations,
      declarationIds,
      options.repositoryId,
      revision,
      evidence,
      relationships,
    );
    analyzedFileCount += 1;
    reportProgress({
      phase: "parsing",
      currentFile: file.relativePath,
      completedFiles: analyzedFileCount,
      totalFiles: files.length,
    });
    await yieldToEventLoop(options.signal);
  }

  const filePaths = new Set(fileEntityIds.keys());
  let resolvedFileCount = 0;
  reportProgress({
    phase: "resolving",
    currentFile: null,
    completedFiles: 0,
    totalFiles: files.length,
  });
  for (const file of files) {
    throwIfCancelled(options.signal);
    const sourceFileId = fileEntityIds.get(file.relativePath);
    if (!sourceFileId) {
      continue;
    }

    let importOrdinal = 0;
    const fileProjectConfig = getProjectConfigForFile(
      file,
      repositoryRoot,
      projectConfigs,
    );
    for (const statement of file.sourceFile.statements) {
      const moduleSpecifier = getModuleSpecifier(statement);
      if (!moduleSpecifier) {
        continue;
      }

      const targetPath = resolveProjectImport(
        file,
        moduleSpecifier,
        repositoryRoot,
        fileProjectConfig.compilerOptions,
        filePaths,
        workspacePackages,
      );
      if (!targetPath) {
        const unsupportedTargetPath = getUnsupportedLocalImportTarget(
          file,
          moduleSpecifier,
          repositoryRoot,
          inventoriedPaths,
        );
        if (unsupportedTargetPath) {
          reportDiagnostic({
            code: "unsupported_local_import",
            severity: "warning",
            message: `Local import "${moduleSpecifier}" targets inventoried file "${unsupportedTargetPath}", whose file type is not analyzed.`,
            path: file.relativePath,
            range: sourceRange(
              file.sourceFile,
              statement.getStart(file.sourceFile),
              statement.getEnd(),
            ),
          });
          continue;
        }
        if (
          !isRelativeSpecifier(moduleSpecifier) &&
          !matchesTsPathAlias(
            moduleSpecifier,
            fileProjectConfig.compilerOptions,
          ) &&
          !workspacePackages.has(
            getWorkspacePackageName(moduleSpecifier) ?? "",
          ) &&
          !ambiguousWorkspacePackageNames.has(
            getWorkspacePackageName(moduleSpecifier) ?? "",
          )
        ) {
          continue;
        }
        reportDiagnostic({
          code: "unresolved_local_import",
          severity: "warning",
          message: `Local import "${moduleSpecifier}" could not be resolved to an analyzed file.`,
          path: file.relativePath,
          range: sourceRange(
            file.sourceFile,
            statement.getStart(file.sourceFile),
            statement.getEnd(),
          ),
        });
        continue;
      }

      const targetEntityId = fileEntityIds.get(targetPath);
      if (!targetEntityId) {
        continue;
      }
      const evidenceId = stableUuid(
        `${options.repositoryId}:evidence:import:${sourceFileId}:${targetEntityId}:${statement.getStart(file.sourceFile)}:${importOrdinal}`,
      );
      const locator = sourceLocator(
        options.repositoryId,
        file.relativePath,
        revision,
        file.sourceFile,
        statement.getStart(file.sourceFile),
        statement.getEnd(),
      );
      evidence.push({
        id: evidenceId,
        origin: "source-analysis",
        description: ts.isExportDeclaration(statement)
          ? `Source re-exports from analyzed file "${targetPath}".`
          : `Source imports analyzed file "${targetPath}".`,
        source: locator,
      });
      relationships.push({
        id: stableUuid(
          `${options.repositoryId}:imports:${sourceFileId}:${targetEntityId}:${importOrdinal}`,
        ),
        sourceEntityId: sourceFileId,
        targetEntityId,
        type: "IMPORTS",
        state: "actual",
        evidenceIds: [evidenceId],
      });
      if (ts.isExportDeclaration(statement)) {
        relationships.push({
          id: stableUuid(
            `${options.repositoryId}:reexports:${sourceFileId}:${targetEntityId}:${importOrdinal}`,
          ),
          sourceEntityId: sourceFileId,
          targetEntityId,
          type: "REEXPORTS",
          state: "actual",
          evidenceIds: [evidenceId],
        });
      }
      importOrdinal += 1;
    }
    resolvedFileCount += 1;
    reportProgress({
      phase: "resolving",
      currentFile: file.relativePath,
      completedFiles: resolvedFileCount,
      totalFiles: files.length,
    });
    await yieldToEventLoop(options.signal);
  }

  throwIfCancelled(options.signal);
  const snapshot: GraphSnapshot = {
    schemaVersion: 1,
    repositoryId: options.repositoryId,
    revision,
    entities,
    evidence,
    relationships,
  };
  const preservedSnapshot = preserveIntendedGraphItems(
    snapshot,
    options.previousSnapshot,
  );
  const invariantIssues = validateGraphSnapshot(preservedSnapshot);
  if (invariantIssues.length > 0) {
    throw new Error(
      `Analyzer generated an invalid graph snapshot: ${invariantIssues.map((issue) => issue.code).join(", ")}.`,
    );
  }

  const reconciliation = reconcileFileChanges(
    files,
    options.previousSnapshot,
    inventoriedPaths,
    diagnostics
      .filter((diagnostic) =>
        diagnostic.code === "gitignored" || diagnostic.code === "user_excluded",
      )
      .flatMap((diagnostic) => diagnostic.path ? [diagnostic.path] : []),
  );

  const persistBlockers = summarizePersistBlockers(coverage, blockerExamples);
  return {
    snapshot: preservedSnapshot,
    coverage,
    diagnostics,
    diagnosticsTruncated,
    reconciliation,
    canPersist: persistBlockers.length === 0,
    persistBlockers,
  };
}

function summarizePersistBlockers(
  coverage: AnalysisCoverage,
  examples: Record<"skipped" | "failed", PersistBlockerExample[]>,
): PersistBlocker[] {
  const blockers: PersistBlocker[] = [];
  if (coverage.failedFiles > 0) {
    blockers.push({
      reason: "failed_files",
      count: coverage.failedFiles,
      message:
        coverage.failedFiles === 1
          ? "1 file or directory could not be analyzed."
          : `${coverage.failedFiles} files or directories could not be analyzed.`,
      examples: examples.failed,
    });
  }
  if (coverage.skippedFiles > 0) {
    blockers.push({
      reason: "skipped_files",
      count: coverage.skippedFiles,
      message: `${coverage.skippedFiles === 1 ? "1 file was" : `${coverage.skippedFiles} files were`} skipped because of size limits, read errors, or unsafe paths.`,
      examples: examples.skipped,
    });
  }
  // Only reported on its own: failed or skipped files already explain an
  // empty pass.
  if (coverage.analyzedFiles === 0 && blockers.length === 0) {
    blockers.push({
      reason: "no_analyzed_files",
      count: 0,
      message: "No supported source files were found to analyze.",
      examples: [],
    });
  }
  if (coverage.truncated) {
    blockers.push({
      reason: "truncated",
      count: coverage.filesDiscovered,
      message: "The repository inventory reached its file limit before every file was examined.",
      examples: [],
    });
  }
  return blockers;
}

function reconcileFileChanges(
  files: InventoryFile[],
  previousSnapshot: GraphSnapshot | null | undefined,
  inventoriedPaths: Set<string>,
  excludedPaths: string[],
): AnalysisReconciliation {
  if (!previousSnapshot) {
    return {
      mode: "initial",
      addedFiles: files.map((file) => file.relativePath).sort(),
      changedFiles: [],
      removedFiles: [],
      renamedFiles: [],
      reason: "No prior graph snapshot was supplied.",
    };
  }
  const currentByPath = new Map(files.map((file) => [file.relativePath, file]));
  const previousFiles = previousSnapshot.entities.filter(
    (entity) => entity.kind === "file" && entity.source,
  );
  const previousByPath = new Map(
    previousFiles.map((entity) => [entity.source!.repositoryRelativePath, entity]),
  );
  const evidenceById = new Map(previousSnapshot.evidence.map((item) => [item.id, item]));
  const previousHashes = new Map<string, string>();
  for (const [path, entity] of previousByPath) {
    const hash = entity.evidenceIds
      .map((id) => evidenceById.get(id)?.description ?? "")
      .map((description) => /sha256:([0-9a-f]{64})/.exec(description)?.[1])
      .find((value) => value !== undefined);
    if (hash) previousHashes.set(path, hash);
  }
  const added = files.filter((file) => !previousByPath.has(file.relativePath));
  const changedFiles = files
    .filter((file) => {
      const oldHash = previousHashes.get(file.relativePath);
      return oldHash !== undefined && oldHash !== file.contentHash;
    })
    .map((file) => file.relativePath);
  const removed = previousFiles
    .map((entity) => entity.source!.repositoryRelativePath)
    .filter(
      (path) =>
        !currentByPath.has(path) &&
        !inventoriedPaths.has(path) &&
        !excludedPaths.some(
          (excludedPath) =>
            path === excludedPath || path.startsWith(`${excludedPath}/`),
        ),
    );
  const removedByHash = new Map<string, string[]>();
  for (const path of removed) {
    const hash = previousHashes.get(path);
    if (hash) removedByHash.set(hash, [...(removedByHash.get(hash) ?? []), path]);
  }
  const addedByHash = new Map<string, InventoryFile[]>();
  for (const file of added) {
    addedByHash.set(file.contentHash, [...(addedByHash.get(file.contentHash) ?? []), file]);
  }
  const renamedFiles: Array<{ from: string; to: string }> = [];
  const renamedFrom = new Set<string>();
  const renamedTo = new Set<string>();
  for (const [hash, oldPaths] of removedByHash) {
    const newFiles = addedByHash.get(hash) ?? [];
    if (oldPaths.length === 1 && newFiles.length === 1) {
      renamedFiles.push({ from: oldPaths[0]!, to: newFiles[0]!.relativePath });
      renamedFrom.add(oldPaths[0]!);
      renamedTo.add(newFiles[0]!.relativePath);
    }
  }
  const addedFiles = added
    .map((file) => file.relativePath)
    .filter((path) => !renamedTo.has(path))
    .sort();
  const removedFiles = removed.filter((path) => !renamedFrom.has(path)).sort();
  const changed = addedFiles.length + removedFiles.length + changedFiles.length + renamedFiles.length > 0;
  return {
    mode: changed ? "full-fallback" : "unchanged",
    addedFiles,
    changedFiles: changedFiles.sort(),
    removedFiles,
    renamedFiles: renamedFiles.sort((left, right) => left.from.localeCompare(right.from)),
    reason: changed
      ? "Changed files trigger full analysis so dependent import and export relationships are rebuilt safely."
      : "Analyzed file paths and content match the previous graph.",
  };
}

export function preserveIntendedGraphItems(
  snapshot: GraphSnapshot,
  previousSnapshot: GraphSnapshot | null | undefined,
): GraphSnapshot {
  if (!previousSnapshot) {
    return snapshot;
  }
  if (previousSnapshot.repositoryId !== snapshot.repositoryId) {
    throw new Error("Cannot preserve intent across different repositories.");
  }

  const entities = [...snapshot.entities];
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]));
  for (const entity of previousSnapshot.entities) {
    if (entity.state !== "intended") {
      continue;
    }
    const existing = entitiesById.get(entity.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(entity)) {
        throw new Error(`Intended entity ID collision: ${entity.id}.`);
      }
      continue;
    }
    entities.push(entity);
    entitiesById.set(entity.id, entity);
  }

  const relationships = [...snapshot.relationships];
  const relationshipsById = new Map(
    relationships.map((relationship) => [relationship.id, relationship]),
  );
  for (const relationship of previousSnapshot.relationships) {
    if (
      relationship.state !== "intended" ||
      !entitiesById.has(relationship.sourceEntityId) ||
      !entitiesById.has(relationship.targetEntityId)
    ) {
      continue;
    }
    const existing = relationshipsById.get(relationship.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(relationship)) {
        throw new Error(
          `Intended relationship ID collision: ${relationship.id}.`,
        );
      }
      continue;
    }
    relationships.push(relationship);
    relationshipsById.set(relationship.id, relationship);
  }

  const evidence = [...snapshot.evidence];
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const referencedEvidenceIds = new Set([
    ...entities
      .filter((entity) => entity.state === "intended")
      .flatMap((entity) => entity.evidenceIds),
    ...relationships
      .filter((relationship) => relationship.state === "intended")
      .flatMap((relationship) => relationship.evidenceIds),
  ]);
  for (const item of previousSnapshot.evidence) {
    if (!referencedEvidenceIds.has(item.id)) {
      continue;
    }
    const existing = evidenceById.get(item.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(item)) {
        throw new Error(`Intended evidence ID collision: ${item.id}.`);
      }
      continue;
    }
    evidence.push(item);
    evidenceById.set(item.id, item);
  }

  return { ...snapshot, entities, evidence, relationships };
}

async function resolveRepositoryRoot(repositoryRoot: string): Promise<string> {
  if (repositoryRoot.trim().length === 0) {
    throw new RepositoryAnalysisError(
      "invalid_repository_root",
      "Repository root must be a non-empty directory path.",
    );
  }

  let resolvedRoot: string;
  try {
    resolvedRoot = await realpath(resolve(repositoryRoot));
    const rootStat = await stat(resolvedRoot);
    if (!rootStat.isDirectory()) {
      throw new RepositoryAnalysisError(
        "invalid_repository_root",
        "Repository root must be a directory.",
      );
    }
  } catch (cause) {
    if (cause instanceof RepositoryAnalysisError) {
      throw cause;
    }
    throw new RepositoryAnalysisError(
      "repository_unavailable",
      "Repository root does not exist or cannot be accessed.",
      { cause },
    );
  }
  return resolvedRoot;
}

async function inventoryRepository(
  repositoryRoot: string,
  coverage: AnalysisCoverage,
  reportDiagnostic: (diagnostic: AnalysisDiagnostic) => void,
  reportSkippedFile: (diagnostic: AnalysisDiagnostic) => void,
  reportFailedFile: (diagnostic: AnalysisDiagnostic) => void,
  reportTruncation: () => void,
  maxFiles: number,
  signal: AbortSignal | undefined,
  reportProgress: (progress: RepositoryAnalysisProgress) => void,
  excludePatterns: string[],
  respectGitignore: boolean,
): Promise<FileCandidate[]> {
  const gitignoreBudget: GitignoreReadBudget = { fileCount: 0, totalBytes: 0 };
  const files: FileCandidate[] = [];
  const directories: Array<{ path: string; inheritedRules: GitignoreRule[] }> =
    [{ path: repositoryRoot, inheritedRules: [] }];
  let entriesExamined = 0;
  while (directories.length > 0) {
    throwIfCancelled(signal);
    const directoryEntry = directories.pop()!;
    const directoryPath = directoryEntry.path;
    const localRules = respectGitignore
      ? await readGitignoreRules(
          directoryPath,
          relative(repositoryRoot, directoryPath).split(sep).join("/"),
          reportDiagnostic,
          gitignoreBudget,
          signal,
        )
      : [];
    const ignoreRules = [...directoryEntry.inheritedRules, ...localRules];
    let directory;
    try {
      directory = await opendir(directoryPath);
    } catch {
      throwIfCancelled(signal);
      reportFailedFile({
        code: "directory_read_failed",
        severity: "error",
        message: "A repository directory could not be read.",
        path: relative(repositoryRoot, directoryPath).split(sep).join("/"),
      });
      continue;
    }

    try {
      for await (const entry of directory) {
        throwIfCancelled(signal);
        entriesExamined += 1;
        if (entriesExamined % 128 === 0) {
          reportProgress({
            phase: "inventory",
            currentFile: null,
            completedFiles: coverage.filesDiscovered,
            totalFiles: null,
          });
          await yieldToEventLoop(signal);
        }
        if (entriesExamined > maxFiles * 10) {
          coverage.truncated = true;
          reportTruncation();
          return files;
        }
        const absolutePath = join(directoryPath, entry.name);
        const relativePath = relative(repositoryRoot, absolutePath)
          .split(sep)
          .join("/");

        // Policy exclusions are reported as diagnostics but are not skipped
        // files: they are outside the analysis scope and must not block
        // persistence of an otherwise complete pass.
        if (
          matchesExclusion(relativePath, excludePatterns, entry.isDirectory())
        ) {
          if (entry.isDirectory()) coverage.excludedDirectories += 1;
          reportDiagnostic({
            code: "user_excluded",
            severity: "warning",
            message: "Path excluded by user-configured analysis policy.",
            path: relativePath,
          });
          continue;
        }
        const isDirectory = entry.isDirectory();
        const ignoredByGit =
          ignoreRules.length > 0 &&
          isGitignored(relativePath, isDirectory, ignoreRules);
        if (ignoredByGit) {
          reportDiagnostic({
            code: "gitignored",
            severity: "warning",
            message: "Path excluded by a .gitignore rule.",
            path: relativePath,
          });
          // Git cannot re-include paths beneath an ignored directory, so its
          // contents are not walked; reconciliation matches this path as a
          // prefix.
          if (isDirectory) coverage.excludedDirectories += 1;
          continue;
        }

        // Symlinks are out of analysis scope (ADR 0013): an in-repository
        // target is analyzed at its real path, and out-of-root targets must
        // not be read, so the link itself does not block persistence.
        if (entry.isSymbolicLink()) {
          reportDiagnostic({
            code: "symlink_ignored",
            severity: "warning",
            message:
              "Symbolic links are not followed during repository analysis.",
            path: relativePath,
          });
          continue;
        }

        if (entry.isDirectory()) {
          if (excludedDirectoryNames.has(entry.name.toLowerCase())) {
            coverage.excludedDirectories += 1;
          } else {
            directories.push({
              path: absolutePath,
              inheritedRules: ignoreRules,
            });
          }
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        if (coverage.filesDiscovered >= maxFiles) {
          coverage.truncated = true;
          reportTruncation();
          return files;
        }
        coverage.filesDiscovered += 1;
        reportProgress({
          phase: "inventory",
          currentFile: relativePath,
          completedFiles: coverage.filesDiscovered,
          totalFiles: null,
        });

        try {
          const fileStat = await lstat(absolutePath);
          if (!fileStat.isFile()) {
            reportSkippedFile({
              code: "non_regular_file",
              severity: "warning",
              message: "Non-regular filesystem entries are not analyzed.",
              path: relativePath,
            });
            continue;
          }
          const canonicalFilePath = await realpath(absolutePath);
          if (!isWithinRoot(repositoryRoot, canonicalFilePath)) {
            reportSkippedFile({
              code: "path_outside_repository",
              severity: "warning",
              message:
                "File resolves outside the selected repository and was skipped.",
              path: relativePath,
            });
            continue;
          }
          files.push({
            absolutePath: canonicalFilePath,
            relativePath,
            byteLength: fileStat.size,
          });
        } catch {
          throwIfCancelled(signal);
          reportSkippedFile({
            code: "file_stat_failed",
            severity: "warning",
            message:
              "File metadata could not be read; check repository permissions.",
            path: relativePath,
          });
        }
      }
    } catch {
      throwIfCancelled(signal);
      reportFailedFile({
        code: "directory_read_failed",
        severity: "error",
        message: "A repository directory could not be fully enumerated.",
        path: relative(repositoryRoot, directoryPath).split(sep).join("/"),
      });
    }
  }

  files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  return files;
}

async function readGitignoreRules(
  directoryPath: string,
  basePath: string,
  reportDiagnostic: (diagnostic: AnalysisDiagnostic) => void,
  budget: GitignoreReadBudget,
  signal: AbortSignal | undefined,
): Promise<GitignoreRule[]> {
  const path = join(directoryPath, ".gitignore");
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    return [];
  }
  const remainingBytes = 4_194_304 - budget.totalBytes;
  if (
    !metadata.isFile() ||
    metadata.size > 1_048_576 ||
    budget.fileCount >= 128 ||
    metadata.size > remainingBytes
  ) {
    reportDiagnostic({
      code: "gitignore_unavailable",
      severity: "warning",
      message:
        "The .gitignore file is not regular or exceeds the per-file, file-count, or cumulative policy limit; its rules were not applied.",
      path: basePath ? `${basePath}/.gitignore` : ".gitignore",
    });
    return [];
  }
  let contents: string;
  try {
    const result = await readBoundedFile(
      path,
      Math.min(1_048_576, remainingBytes),
      signal,
    );
    contents = result.contents;
    budget.fileCount += 1;
    budget.totalBytes += result.byteLength;
  } catch (error) {
    if (error instanceof RepositoryAnalysisCancelledError) throw error;
    reportDiagnostic({
      code: "gitignore_unavailable",
      severity: "warning",
      message:
        "The .gitignore file could not be read; its rules were not applied.",
      path: basePath ? `${basePath}/.gitignore` : ".gitignore",
    });
    return [];
  }

  const rules: GitignoreRule[] = [];
  for (const [lineIndex, originalLine] of contents
    .split(/\r?\n/)
    .entries()) {
    const line = stripUnescapedTrailingSpaces(originalLine);
    if (!line || line.startsWith("#")) continue;
    let pattern = line;
    let negated = false;
    if (pattern.startsWith("!")) {
      negated = true;
      pattern = pattern.slice(1);
    } else if (pattern.startsWith("\\!") || pattern.startsWith("\\#")) {
      pattern = pattern.slice(1);
    }
    if (/[\\[\]]/.test(pattern)) {
      reportDiagnostic({
        code: "gitignore_pattern_unsupported",
        severity: "warning",
        message:
          "This .gitignore pattern uses escaped or character-class syntax that Codifier does not support; the rule was skipped.",
        path: basePath ? `${basePath}/.gitignore` : ".gitignore",
        range: {
          start: { line: lineIndex + 1, column: 0 },
          end: { line: lineIndex + 1, column: originalLine.length },
        },
      });
      continue;
    }
    const directoryOnly = pattern.endsWith("/") && !pattern.endsWith("\\/");
    if (directoryOnly) pattern = pattern.slice(0, -1);
    const anchored = pattern.startsWith("/");
    if (anchored) pattern = pattern.slice(1);
    if (!pattern) continue;
    rules.push({ basePath, pattern, negated, directoryOnly, anchored });
  }
  return rules;
}

function stripUnescapedTrailingSpaces(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === " ") {
    let backslashes = 0;
    for (let index = end - 2; index >= 0 && value[index] === "\\"; index -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 1) break;
    end -= 1;
  }
  return value.slice(0, end);
}

function matchesExclusion(
  path: string,
  patterns: string[],
  isDirectory: boolean,
): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/**")) {
      const directory = pattern.slice(0, -3).replace(/\/$/, "");
      return path === directory || path.startsWith(`${directory}/`);
    }
    if (pattern.endsWith("/")) {
      const directory = pattern.slice(0, -1);
      return (
        (isDirectory && path === directory) ||
        path.startsWith(`${directory}/`)
      );
    }
    if (globMatches(path, pattern)) return true;
    if (!pattern.includes("/")) {
      return path.split("/").some((segment) => globMatches(segment, pattern));
    }
    return false;
  });
}

function isGitignored(
  path: string,
  isDirectory: boolean,
  rules: GitignoreRule[],
): boolean {
  const parts = path.split("/");
  const directoryPrefixes = parts
    .slice(0, -1)
    .map((_, index) => parts.slice(0, index + 1).join("/"));
  for (const prefix of directoryPrefixes) {
    if (evaluateIgnoreRules(prefix, true, rules)) return true;
  }
  return evaluateIgnoreRules(path, isDirectory, rules);
}

function evaluateIgnoreRules(
  path: string,
  isDirectory: boolean,
  rules: GitignoreRule[],
): boolean {
  let ignored = false;
  for (const rule of rules) {
    const scopedPath = rule.basePath
      ? path.startsWith(`${rule.basePath}/`)
        ? path.slice(rule.basePath.length + 1)
        : null
      : path;
    if (!scopedPath) continue;
    const parts = scopedPath.split("/");
    const candidates = parts.map((_, index) =>
      parts.slice(0, index + 1).join("/"),
    );
    const matched = candidates.some((candidate, index) => {
      const candidateIsDirectory = index < candidates.length - 1 || isDirectory;
      if (rule.directoryOnly && !candidateIsDirectory) return false;
      if (!rule.anchored && !rule.pattern.includes("/")) {
        return (
          candidate.split("/").at(-1) !== undefined &&
          globMatches(candidate.split("/").at(-1)!, rule.pattern)
        );
      }
      return globMatches(candidate, rule.pattern);
    });
    if (matched) ignored = !rule.negated;
  }
  return ignored;
}

function globMatches(path: string, pattern: string): boolean {
  const normalized = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  let expression = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]!;
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        if (normalized[index + 1] === "/") {
          index += 1;
          expression += "(?:.*/)?";
        } else expression += ".*";
      } else expression += "[^/]*";
    } else if (character === "?") expression += "[^/]";
    else expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  expression += "$";
  const hasSlash = normalized.includes("/");
  const matcher = new RegExp(
    hasSlash ? expression : `(?:^|/)${expression.slice(1)}`,
  );
  return matcher.test(path);
}

function isWithinRoot(repositoryRoot: string, candidatePath: string): boolean {
  const relativePath = relative(repositoryRoot, candidatePath);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

async function readBoundedFile(
  filePath: string,
  maxBytes: number,
  signal: AbortSignal | undefined,
): Promise<{ contents: string; byteLength: number }> {
  const file = await open(filePath, "r");
  const chunks: Buffer[] = [];
  const buffer = Buffer.alloc(64 * 1024);
  let totalBytes = 0;
  try {
    while (totalBytes <= maxBytes) {
      throwIfCancelled(signal);
      const readSize = Math.min(buffer.length, maxBytes + 1 - totalBytes);
      const { bytesRead } = await file.read(buffer, 0, readSize, null);
      if (bytesRead === 0) {
        break;
      }
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) {
        throw new FileLimitError();
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
  } finally {
    await file.close();
  }
  return {
    contents: Buffer.concat(chunks).toString("utf8"),
    byteLength: totalBytes,
  };
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new RepositoryAnalysisCancelledError();
  }
}

async function yieldToEventLoop(
  signal: AbortSignal | undefined,
): Promise<void> {
  await new Promise<void>((resolveYield) => setImmediate(resolveYield));
  throwIfCancelled(signal);
}

class FileLimitError extends Error {}

function scriptKindForPath(filePath: string): ts.ScriptKind {
  switch (extname(filePath).toLowerCase()) {
    case ".tsx":
    case ".jsx":
      return ts.ScriptKind.TSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

async function getSyntacticDiagnostics(
  files: InventoryFile[],
  signal: AbortSignal | undefined,
): Promise<ts.Diagnostic[]> {
  throwIfCancelled(signal);
  const filesByPath = new Map(
    files.map((file) => [canonicalPath(file.absolutePath), file.sourceFile]),
  );
  const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.Preserve,
    noEmit: true,
    noLib: true,
    noResolve: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.Latest,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNew) =>
    filesByPath.get(canonicalPath(fileName)) ??
    originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNew);
  const program = ts.createProgram({
    rootNames: files.map((file) => file.absolutePath),
    options,
    host,
  });
  const diagnostics: ts.Diagnostic[] = [];
  for (const sourceFile of program.getSourceFiles()) {
    throwIfCancelled(signal);
    if (filesByPath.has(canonicalPath(sourceFile.fileName))) {
      diagnostics.push(...program.getSyntacticDiagnostics(sourceFile));
      await yieldToEventLoop(signal);
    }
  }
  return diagnostics;
}

function getDeclarations(sourceFile: ts.SourceFile): Declaration[] {
  const declarations: Declaration[] = [];
  const visit = (node: ts.Node, parent?: Declaration): void => {
    const details = declarationDetails(node);
    const current = details
      ? createDeclaration(
          sourceFile,
          node,
          details.kind,
          details.localName,
          parent,
        )
      : undefined;
    if (current) {
      declarations.push(current);
    }
    node.forEachChild((child) => visit(child, current ?? parent));
  };
  sourceFile.forEachChild((node) => visit(node));
  return declarations;
}

function declarationDetails(
  node: ts.Node,
): { kind: string; localName: string } | undefined {
  if (ts.isFunctionDeclaration(node)) {
    return { kind: "function", localName: node.name?.text ?? "default" };
  }
  if (ts.isClassDeclaration(node)) {
    return { kind: "class", localName: node.name?.text ?? "default" };
  }
  if (ts.isInterfaceDeclaration(node)) {
    return { kind: "interface", localName: node.name.text };
  }
  if (ts.isEnumDeclaration(node)) {
    return { kind: "enum", localName: node.name.text };
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return { kind: "type", localName: node.name.text };
  }
  if (ts.isModuleDeclaration(node)) {
    return { kind: "namespace", localName: node.name.text };
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return { kind: "variable", localName: node.name.text };
  }
  if (ts.isConstructorDeclaration(node)) {
    return { kind: "constructor", localName: "constructor" };
  }
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
    const localName = propertyNameText(node.name);
    return localName ? { kind: "method", localName } : undefined;
  }
  if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    const localName = propertyNameText(node.name);
    return localName ? { kind: "accessor", localName } : undefined;
  }
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
    const localName = propertyNameText(node.name);
    return localName ? { kind: "property", localName } : undefined;
  }
  return undefined;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return undefined;
}

function createDeclaration(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  kind: string,
  localName: string,
  parent?: Declaration,
): Declaration {
  const name = parent ? `${parent.name}.${localName}` : localName;
  return {
    kind,
    name,
    localName,
    start: node.getStart(sourceFile),
    end: node.getEnd(),
    fingerprint: getDeclarationFingerprint(sourceFile, node),
    ...(parent ? { parent } : {}),
  };
}

function getRouteDeclarations(
  sourceFile: ts.SourceFile,
  declarations: Declaration[],
): Declaration[] {
  const routeDeclarations: Declaration[] = [];
  const routeMethods = new Set([
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "options",
    "head",
    "all",
  ]);
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const { expression, name } = node.expression;
      const method = name.text.toLowerCase();
      const pathArgument = node.arguments[0];
      if (
        ts.isIdentifier(expression) &&
        /^(app|router)$/i.test(expression.text) &&
        routeMethods.has(method) &&
        pathArgument &&
        (ts.isStringLiteral(pathArgument) ||
          ts.isNoSubstitutionTemplateLiteral(pathArgument))
      ) {
        const parent = declarations
          .filter(
            (declaration) =>
              declaration.start <= node.getStart(sourceFile) &&
              declaration.end >= node.getEnd(),
          )
          .sort(
            (left, right) => left.end - left.start - (right.end - right.start),
          )[0];
        const localName = `${method.toUpperCase()} ${pathArgument.text}`;
        const route = createDeclaration(
          sourceFile,
          node,
          "route",
          localName,
          parent,
        );
        route.routeTargets = [];
        routeDeclarations.push(route);

        node.arguments.slice(1).forEach((argument, index) => {
          if (ts.isIdentifier(argument)) {
            const matches = declarations.filter(
              (declaration) =>
                declaration.localName === argument.text &&
                ["function", "method", "variable"].includes(declaration.kind) &&
                isVisibleDeclaration(declaration, route),
            );
            if (matches.length === 1) {
              route.routeTargets?.push(matches[0]!);
            }
            return;
          }

          if (
            ts.isArrowFunction(argument) ||
            ts.isFunctionExpression(argument)
          ) {
            const handler = createDeclaration(
              sourceFile,
              argument,
              "route-handler",
              `handler${index + 1}`,
              route,
            );
            route.routeTargets?.push(handler);
            routeDeclarations.push(handler);
          }
        });
      }
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return routeDeclarations;
}

function addFrameworkRelationships(
  file: InventoryFile,
  declarations: Declaration[],
  declarationIds: Map<Declaration, string>,
  repositoryId: string,
  revision: string | null,
  evidence: Evidence[],
  relationships: GraphRelationship[],
): void {
  const addRelationship = (
    type: string,
    source: Declaration,
    target: Declaration,
    start: number,
    end: number,
    description: string,
  ): void => {
    const sourceEntityId = declarationIds.get(source);
    const targetEntityId = declarationIds.get(target);
    if (
      !sourceEntityId ||
      !targetEntityId ||
      sourceEntityId === targetEntityId
    ) {
      return;
    }
    const evidenceId = stableUuid(
      `${repositoryId}:evidence:${type}:${file.relativePath}:${start}:${sourceEntityId}:${targetEntityId}`,
    );
    const locator = sourceLocator(
      repositoryId,
      file.relativePath,
      revision,
      file.sourceFile,
      start,
      end,
    );
    evidence.push({
      id: evidenceId,
      origin: "source-analysis",
      description,
      source: locator,
    });
    relationships.push({
      id: stableUuid(
        `${repositoryId}:${type}:${sourceEntityId}:${targetEntityId}:${start}`,
      ),
      sourceEntityId,
      targetEntityId,
      type,
      state: "actual",
      evidenceIds: [evidenceId],
    });
  };

  for (const route of declarations) {
    for (const target of route.routeTargets ?? []) {
      addRelationship(
        "ROUTES_TO",
        route,
        target,
        route.start,
        route.end,
        `HTTP route registration pattern "${route.localName}" references handler "${target.localName}".`,
      );
    }
  }

  const visitJsx = (node: ts.Node): void => {
    const tagName =
      ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)
        ? node.tagName
        : undefined;
    if (tagName && ts.isIdentifier(tagName) && /^[A-Z]/.test(tagName.text)) {
      const owners = declarations
        .filter(
          (declaration) =>
            !["route", "route-handler"].includes(declaration.kind) &&
            declaration.start <= node.getStart(file.sourceFile) &&
            declaration.end >= node.getEnd(),
        )
        .sort(
          (left, right) => left.end - left.start - (right.end - right.start),
        );
      const targets = declarations.filter(
        (declaration) =>
          declaration.localName === tagName.text &&
          ["class", "function", "variable"].includes(declaration.kind) &&
          owners[0] &&
          isVisibleDeclaration(declaration, owners[0]),
      );
      if (owners[0] && targets.length === 1) {
        addRelationship(
          "RENDERS",
          owners[0],
          targets[0]!,
          tagName.getStart(file.sourceFile),
          tagName.getEnd(),
          `JSX element references local component "${tagName.text}".`,
        );
      }
    }
    node.forEachChild(visitJsx);
  };
  visitJsx(file.sourceFile);
}

function isVisibleDeclaration(
  declaration: Declaration,
  scope: Declaration,
): boolean {
  if (!declaration.parent) {
    return true;
  }
  let current: Declaration | undefined = scope;
  while (current) {
    if (current === declaration.parent) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function getModuleSpecifier(statement: ts.Statement): string | undefined {
  if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
    return statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : undefined;
  }
  return undefined;
}

function resolveProjectImport(
  importer: InventoryFile,
  moduleSpecifier: string,
  repositoryRoot: string,
  compilerOptions: ts.CompilerOptions,
  availableFiles: Set<string>,
  workspacePackages: Map<string, WorkspacePackage>,
): string | null {
  const resolvedPath = resolveWithTypeScript(
    importer,
    moduleSpecifier,
    repositoryRoot,
    compilerOptions,
    availableFiles,
  );
  if (resolvedPath) {
    return resolvedPath;
  }

  const packageName = getWorkspacePackageName(moduleSpecifier);
  if (!packageName) {
    return null;
  }
  const workspacePackage = workspacePackages.get(packageName);
  if (!workspacePackage) {
    return null;
  }
  const subpath = moduleSpecifier.slice(packageName.length).replace(/^\//, "");
  const target = resolveWorkspacePackageTarget(
    workspacePackage,
    subpath,
    compilerOptions,
  );
  if (!target || !isWithinRoot(workspacePackage.rootPath, target)) {
    return null;
  }
  const relativeSpecifier = relative(dirname(importer.absolutePath), target)
    .split(sep)
    .join("/");
  return resolveWithTypeScript(
    importer,
    relativeSpecifier.startsWith(".")
      ? relativeSpecifier
      : `./${relativeSpecifier}`,
    repositoryRoot,
    compilerOptions,
    availableFiles,
  );
}

function getUnsupportedLocalImportTarget(
  importer: InventoryFile,
  moduleSpecifier: string,
  repositoryRoot: string,
  inventoriedPaths: Set<string>,
): string | null {
  if (!isRelativeSpecifier(moduleSpecifier)) {
    return null;
  }
  const absoluteTarget = resolve(
    dirname(importer.absolutePath),
    moduleSpecifier,
  );
  if (
    !isWithinRoot(repositoryRoot, absoluteTarget) ||
    supportedExtensions.has(extname(absoluteTarget).toLowerCase())
  ) {
    return null;
  }
  const relativeTarget = relative(repositoryRoot, absoluteTarget)
    .split(sep)
    .join("/");
  return inventoriedPaths.has(relativeTarget) ? relativeTarget : null;
}

function resolveWithTypeScript(
  importer: InventoryFile,
  moduleSpecifier: string,
  repositoryRoot: string,
  compilerOptions: ts.CompilerOptions,
  availableFiles: Set<string>,
): string | null {
  const resolvedModule = ts.resolveModuleName(
    moduleSpecifier,
    importer.absolutePath,
    compilerOptions,
    ts.sys,
  ).resolvedModule;
  if (!resolvedModule) {
    return null;
  }

  let absolutePath = resolve(resolvedModule.resolvedFileName);
  try {
    absolutePath = realpathSync(absolutePath);
  } catch {
    return null;
  }
  if (!isWithinRoot(repositoryRoot, absolutePath)) {
    return null;
  }
  const repositoryPath = relative(repositoryRoot, absolutePath)
    .split(sep)
    .join("/");
  return availableFiles.has(repositoryPath) ? repositoryPath : null;
}

function getWorkspacePackageName(specifier: string): string | null {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    /^[A-Za-z]:/.test(specifier)
  ) {
    return null;
  }
  const segments = specifier.split("/");
  if (segments.some((segment) => segment.length === 0)) {
    return null;
  }
  const packageName = specifier.startsWith("@")
    ? segments.length >= 2
      ? segments.slice(0, 2).join("/")
      : null
    : segments[0];
  return packageName && packageName !== "." ? packageName : null;
}

function parseWorkspacePackage(
  candidate: FileCandidate,
  repositoryRoot: string,
  contents: string,
  reportDiagnostic: (diagnostic: AnalysisDiagnostic) => void,
): WorkspacePackage | null {
  let manifest: unknown;
  try {
    manifest = JSON.parse(contents);
  } catch {
    reportDiagnostic({
      code: "workspace_package_manifest_invalid",
      severity: "warning",
      message:
        "Package manifest is not valid JSON and was not used for import resolution.",
      path: candidate.relativePath,
    });
    return null;
  }
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    Array.isArray(manifest)
  ) {
    reportDiagnostic({
      code: "workspace_package_manifest_invalid",
      severity: "warning",
      message:
        "Package manifest must contain an object and was not used for import resolution.",
      path: candidate.relativePath,
    });
    return null;
  }
  const manifestRecord = manifest as Record<string, unknown>;
  if (typeof manifestRecord.name !== "string" || !manifestRecord.name.trim()) {
    return null;
  }
  const name = manifestRecord.name.trim();
  if (!/^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i.test(name)) {
    reportDiagnostic({
      code: "workspace_package_name_invalid",
      severity: "warning",
      message:
        "Package manifest has an invalid package name and was not used for import resolution.",
      path: candidate.relativePath,
    });
    return null;
  }
  const packageRoot = dirname(candidate.absolutePath);
  if (!isWithinRoot(repositoryRoot, packageRoot)) {
    return null;
  }
  return {
    name,
    rootPath: packageRoot,
    manifest: manifestRecord,
  };
}

function resolveWorkspacePackageTarget(
  workspacePackage: WorkspacePackage,
  subpath: string,
  compilerOptions: ts.CompilerOptions,
): string | null {
  const subpathKey = subpath ? `./${subpath}` : ".";
  const manifestExports = workspacePackage.manifest.exports;
  let target: string | null = null;
  if (manifestExports !== undefined) {
    target = selectPackageExport(manifestExports, subpathKey, compilerOptions);
  } else if (subpath) {
    target = `./${subpath}`;
  } else {
    for (const field of ["types", "typings", "module", "main", "source"]) {
      const value = workspacePackage.manifest[field];
      if (typeof value === "string") {
        target = value.startsWith("./") ? value : `./${value}`;
        break;
      }
    }
    target ??= "./index";
  }
  if (!target || !target.startsWith("./")) {
    return null;
  }
  const absoluteTarget = resolve(workspacePackage.rootPath, target);
  return isWithinRoot(workspacePackage.rootPath, absoluteTarget)
    ? absoluteTarget
    : null;
}

function selectPackageExport(
  exports: unknown,
  subpath: string,
  compilerOptions: ts.CompilerOptions,
): string | null {
  let target = exports;
  if (
    typeof exports === "object" &&
    exports !== null &&
    !Array.isArray(exports)
  ) {
    const exportMap = exports as Record<string, unknown>;
    const hasSubpathKeys = Object.keys(exportMap).some((key) =>
      key.startsWith("."),
    );
    if (hasSubpathKeys) {
      target = exportMap[subpath];
      if (target === undefined) {
        for (const [pattern, candidate] of Object.entries(exportMap)) {
          const wildcardIndex = pattern.indexOf("*");
          if (wildcardIndex < 0) {
            continue;
          }
          const prefix = pattern.slice(0, wildcardIndex);
          const suffix = pattern.slice(wildcardIndex + 1);
          if (
            subpath.startsWith(prefix) &&
            subpath.endsWith(suffix) &&
            subpath.length >= prefix.length + suffix.length
          ) {
            const wildcard = subpath.slice(
              prefix.length,
              subpath.length - suffix.length || undefined,
            );
            target = replacePackageTargetWildcard(candidate, wildcard);
            break;
          }
        }
      }
    } else if (subpath !== ".") {
      return null;
    }
  } else if (subpath !== ".") {
    return null;
  }

  const conditions = new Set([
    "types",
    ...(compilerOptions.customConditions ?? []),
    "node",
    "import",
    "default",
  ]);
  return selectConditionalTarget(target, conditions);
}

function replacePackageTargetWildcard(
  value: unknown,
  wildcard: string,
): unknown {
  if (typeof value === "string") {
    return value.replaceAll("*", wildcard);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => replacePackageTargetWildcard(entry, wildcard));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        replacePackageTargetWildcard(entry, wildcard),
      ]),
    );
  }
  return value;
}

function selectConditionalTarget(
  value: unknown,
  conditions: Set<string>,
): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const target = selectConditionalTarget(entry, conditions);
      if (target) {
        return target;
      }
    }
    return null;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  for (const [condition, entry] of Object.entries(value)) {
    if (conditions.has(condition)) {
      const target = selectConditionalTarget(entry, conditions);
      if (target) {
        return target;
      }
    }
  }
  return null;
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function matchesTsPathAlias(
  specifier: string,
  compilerOptions: ts.CompilerOptions,
): boolean {
  const paths = compilerOptions.paths;
  if (!paths) {
    return false;
  }
  return Object.keys(paths).some((pattern) => {
    const wildcardIndex = pattern.indexOf("*");
    if (wildcardIndex < 0) {
      return specifier === pattern;
    }
    const prefix = pattern.slice(0, wildcardIndex);
    const suffix = pattern.slice(wildcardIndex + 1);
    return (
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix) &&
      specifier.length >= prefix.length + suffix.length
    );
  });
}

function getProjectConfigForFile(
  file: InventoryFile,
  repositoryRoot: string,
  projectConfigs: Map<string, AnalyzerProjectConfig>,
): AnalyzerProjectConfig {
  let directory = dirname(file.absolutePath);
  while (isWithinRoot(repositoryRoot, directory)) {
    const config = projectConfigs.get(directory);
    if (config) {
      return config;
    }
    if (directory === repositoryRoot) {
      break;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  return projectConfigs.get(repositoryRoot)!;
}

async function loadProjectConfig(
  repositoryRoot: string,
  signal: AbortSignal | undefined,
  configRelativePath: string,
  budget: ProjectConfigReadBudget,
): Promise<AnalyzerProjectConfig> {
  const diagnostics: AnalysisDiagnostic[] = [];
  const root = resolve(repositoryRoot);
  const configPath = resolve(root, configRelativePath);
  try {
    const configStat = await lstat(configPath);
    if (configStat.isSymbolicLink()) {
      diagnostics.push({
        code: "tsconfig_symlink_ignored",
        severity: "warning",
        message:
          "Symbolic-link TypeScript configurations are not followed; default module resolution is used.",
        path: configRelativePath,
      });
      return defaultProjectConfig(repositoryRoot, diagnostics);
    }
    if (!configStat.isFile()) {
      return defaultProjectConfig(repositoryRoot, diagnostics);
    }
  } catch (error) {
    throwIfCancelled(signal);
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return defaultProjectConfig(repositoryRoot, diagnostics);
    }
    diagnostics.push({
      code: "tsconfig_read_failed",
      severity: "warning",
      message: `${configRelativePath} could not be read within the configuration size limit; default module resolution is used.`,
      path: configRelativePath,
    });
    return defaultProjectConfig(repositoryRoot, diagnostics);
  }

  throwIfCancelled(signal);
  const maxConfigFiles = 32;
  const maxConfigBytes = 4_194_304;
  const configReadFailures = new Set<string>();
  const limitReachedBeforeParse = budget.limitReached;
  const safeConfigPath = (fileName: string): string | null => {
    const absolutePath = resolve(fileName);
    if (!isWithinRoot(root, absolutePath)) {
      return null;
    }
    try {
      const entryStat = lstatSync(absolutePath);
      if (!entryStat.isFile() || entryStat.size > 1_048_576) {
        return null;
      }
      const canonicalPath = realpathSync(absolutePath);
      return isWithinRoot(root, canonicalPath) ? canonicalPath : null;
    } catch {
      return null;
    }
  };
  const host = {
    ...ts.sys,
    getCurrentDirectory: () => root,
    readDirectory: () => [],
    fileExists: (fileName: string) => safeConfigPath(fileName) !== null,
    readFile: (fileName: string): string | undefined => {
      const canonicalPath = safeConfigPath(fileName);
      if (!canonicalPath) {
        configReadFailures.add(fileName);
        return undefined;
      }
      const cached = budget.contents.get(canonicalPath);
      if (cached !== undefined) {
        return cached;
      }
      try {
        const fileStat = statSync(canonicalPath);
        if (
          budget.contents.size >= maxConfigFiles ||
          budget.totalBytes + fileStat.size > maxConfigBytes
        ) {
          budget.limitReached = true;
          configReadFailures.add(fileName);
          return undefined;
        }
        const contents = readBoundedConfigFile(canonicalPath, 1_048_576);
        if (contents === null) {
          configReadFailures.add(fileName);
          return undefined;
        }
        budget.totalBytes += Buffer.byteLength(contents, "utf8");
        budget.contents.set(canonicalPath, contents);
        return contents;
      } catch {
        configReadFailures.add(fileName);
        return undefined;
      }
    },
    directoryExists: (directoryPath: string) => {
      const absolutePath = resolve(directoryPath);
      if (!isWithinRoot(root, absolutePath)) {
        return false;
      }
      try {
        const canonicalPath = realpathSync(absolutePath);
        return (
          isWithinRoot(root, canonicalPath) &&
          statSync(canonicalPath).isDirectory()
        );
      } catch {
        return false;
      }
    },
    onUnRecoverableConfigFileDiagnostic: (diagnostic: ts.Diagnostic) => {
      diagnostics.push(configDiagnostic(diagnostic, root));
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
  if (!limitReachedBeforeParse && budget.limitReached) {
    diagnostics.push({
      code: "tsconfig_read_limit",
      severity: "warning",
      message:
        "Repository TypeScript configurations exceeded the shared file or byte limit; some project options may be unavailable.",
      path: configRelativePath,
    });
  }
  if (configReadFailures.size > 0) {
    diagnostics.push({
      code: "tsconfig_inheritance_unavailable",
      severity: "warning",
      message:
        "A TypeScript configuration could not be read safely; only available in-repository configuration options were applied.",
      path: configRelativePath,
    });
  }
  if (!parsed) {
    return defaultProjectConfig(repositoryRoot, diagnostics);
  }
  for (const diagnostic of parsed.errors) {
    if (diagnostic.code !== 18003) {
      diagnostics.push(configDiagnostic(diagnostic, root));
    }
  }
  return {
    compilerOptions: {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.Latest,
      allowJs: true,
      ...parsed.options,
    },
    diagnostics,
  };
}

function readBoundedConfigFile(
  filePath: string,
  maxBytes: number,
): string | null {
  const fileDescriptor = openSync(filePath, "r");
  const chunks: Buffer[] = [];
  const buffer = Buffer.alloc(64 * 1024);
  let totalBytes = 0;
  try {
    while (totalBytes <= maxBytes) {
      const readSize = Math.min(buffer.length, maxBytes + 1 - totalBytes);
      const bytesRead = readSync(fileDescriptor, buffer, 0, readSize, null);
      if (bytesRead === 0) {
        break;
      }
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) {
        return null;
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
  } finally {
    closeSync(fileDescriptor);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function configDiagnostic(
  diagnostic: ts.Diagnostic,
  repositoryRoot: string,
): AnalysisDiagnostic {
  const diagnosticPath = diagnostic.file
    ? relative(repositoryRoot, diagnostic.file.fileName).split(sep).join("/")
    : undefined;
  return {
    code: `tsconfig_${diagnostic.code}`,
    severity: "warning",
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    ...(diagnosticPath &&
    !diagnosticPath.startsWith("../") &&
    !isAbsolute(diagnosticPath)
      ? { path: diagnosticPath }
      : {}),
  };
}
function defaultProjectConfig(
  repositoryRoot: string,
  diagnostics: AnalysisDiagnostic[],
): AnalyzerProjectConfig {
  return {
    compilerOptions: {
      allowJs: true,
      baseUrl: repositoryRoot,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.Latest,
    },
    diagnostics,
  };
}

function buildPreviousIdentityIndex(
  snapshot: GraphSnapshot | null | undefined,
): PreviousIdentityIndex {
  const evidenceById = new Map(
    snapshot?.evidence.map((item) => [item.id, item]) ?? [],
  );
  const files =
    snapshot?.entities.filter(
      (entity) => entity.kind === "file" && entity.source,
    ) ?? [];
  const symbolsByPath = new Map<string, GraphEntity[]>();
  for (const entity of snapshot?.entities ?? []) {
    if (entity.kind !== "symbol" || !entity.source) {
      continue;
    }
    const symbols =
      symbolsByPath.get(entity.source.repositoryRelativePath) ?? [];
    symbols.push(entity);
    symbolsByPath.set(entity.source.repositoryRelativePath, symbols);
  }
  return { files, symbolsByPath, evidenceById };
}

function reconcileFiles(
  files: InventoryFile[],
  previous: PreviousIdentityIndex,
  reportDiagnostic: (diagnostic: AnalysisDiagnostic) => void,
): Map<string, string> {
  const previousFileForCurrent = new Map<string, string>();
  const previousByPath = new Map(
    previous.files.map((entity) => [
      entity.source!.repositoryRelativePath,
      entity,
    ]),
  );
  const usedPreviousPaths = new Set<string>();

  for (const file of files) {
    if (previousByPath.has(file.relativePath)) {
      previousFileForCurrent.set(file.relativePath, file.relativePath);
      usedPreviousPaths.add(file.relativePath);
    }
  }

  const previousByHash = new Map<string, GraphEntity[]>();
  for (const oldFile of previous.files) {
    const oldPath = oldFile.source!.repositoryRelativePath;
    if (usedPreviousPaths.has(oldPath)) {
      continue;
    }
    const hash = oldFile.evidenceIds
      .map((id) => previous.evidenceById.get(id)?.description ?? "")
      .map((description) => /sha256:([0-9a-f]{64})/.exec(description)?.[1])
      .find((value) => value !== undefined);
    if (!hash) {
      continue;
    }
    const matches = previousByHash.get(hash) ?? [];
    matches.push(oldFile);
    previousByHash.set(hash, matches);
  }

  const currentByHash = new Map<string, InventoryFile[]>();
  for (const file of files) {
    if (previousFileForCurrent.has(file.relativePath)) {
      continue;
    }
    const matches = currentByHash.get(file.contentHash) ?? [];
    matches.push(file);
    currentByHash.set(file.contentHash, matches);
  }

  for (const [hash, currentFiles] of currentByHash) {
    const oldFiles = previousByHash.get(hash) ?? [];
    if (currentFiles.length === 1 && oldFiles.length === 1) {
      previousFileForCurrent.set(
        currentFiles[0]!.relativePath,
        oldFiles[0]!.source!.repositoryRelativePath,
      );
    } else if (oldFiles.length > 0) {
      reportDiagnostic({
        code: "ambiguous_file_identity",
        severity: "warning",
        message:
          "Matching file contents occur at multiple paths; prior file identities were not reassigned.",
        path: currentFiles[0]?.relativePath,
      });
    }
  }

  return previousFileForCurrent;
}

function createIdentityAllocator(
  repositoryId: string,
  files: InventoryFile[],
  previous: PreviousIdentityIndex,
  previousFileForCurrent: Map<string, string>,
  reportDiagnostic: (diagnostic: AnalysisDiagnostic) => void,
): IdentityAllocator {
  const fileByPath = new Map(
    previous.files.map((entity) => [
      entity.source!.repositoryRelativePath,
      entity,
    ]),
  );
  const fileIds = new Map<string, string>();
  for (const file of files) {
    const previousPath = previousFileForCurrent.get(file.relativePath);
    const previousFile = previousPath
      ? fileByPath.get(previousPath)
      : undefined;
    fileIds.set(
      file.relativePath,
      previousFile?.id ??
        stableUuid(`${repositoryId}:file:${file.relativePath}`),
    );
  }

  const reportedAmbiguities = new Set<string>();
  return {
    fileIds,
    symbolId(file, declaration, declarations, ordinal) {
      const previousPath = previousFileForCurrent.get(file.relativePath);
      const priorSymbols = previousPath
        ? (previous.symbolsByPath.get(previousPath) ?? [])
        : [];
      const sameNameAndKind = declarations.filter(
        (candidate) =>
          candidate.name === declaration.name &&
          candidate.kind === declaration.kind,
      );
      const sameFingerprint = sameNameAndKind.filter(
        (candidate) => candidate.fingerprint === declaration.fingerprint,
      );
      const fingerprintMatches = priorSymbols.filter((entity) => {
        if (entity.name !== declaration.name) {
          return false;
        }
        return entity.evidenceIds.some((id) => {
          const description = previous.evidenceById.get(id)?.description ?? "";
          return description.includes(
            `${declaration.kind} declaration discovered by syntax analysis. fingerprint:${declaration.fingerprint}`,
          );
        });
      });

      if (fingerprintMatches.length === 1 && sameFingerprint.length === 1) {
        return fingerprintMatches[0]!.id;
      }

      const isSamePath = previousPath === file.relativePath;
      const priorNameAndKind = priorSymbols.filter((entity) => {
        if (entity.name !== declaration.name) {
          return false;
        }
        return entity.evidenceIds.some((id) =>
          (previous.evidenceById.get(id)?.description ?? "").startsWith(
            `${declaration.kind} declaration`,
          ),
        );
      });
      if (
        isSamePath &&
        sameNameAndKind.length === 1 &&
        priorNameAndKind.length === 1
      ) {
        return priorNameAndKind[0]!.id;
      }

      const ambiguous =
        (sameNameAndKind.length > 1 || priorNameAndKind.length > 1) &&
        (fingerprintMatches.length !== 1 || sameFingerprint.length !== 1);
      if (ambiguous) {
        const ambiguityKey = `${file.relativePath}:${declaration.kind}:${declaration.name}`;
        if (!reportedAmbiguities.has(ambiguityKey)) {
          reportedAmbiguities.add(ambiguityKey);
          reportDiagnostic({
            code: "ambiguous_symbol_identity",
            severity: "warning",
            message:
              "Multiple declarations could match this prior symbol; a new identity was assigned.",
            path: file.relativePath,
            range: sourceRange(
              file.sourceFile,
              declaration.start,
              declaration.end,
            ),
          });
        }
      }

      return stableUuid(
        `${repositoryId}:${ambiguous ? "ambiguous-symbol" : "symbol"}:${file.relativePath}:${declaration.kind}:${declaration.name}:${declaration.fingerprint}:${ordinal}`,
      );
    },
  };
}

function getDeclarationFingerprint(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): string {
  const printer = ts.createPrinter({ removeComments: true });
  return sha256(printer.printNode(ts.EmitHint.Unspecified, node, sourceFile));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceLocator(
  repositoryId: string,
  repositoryRelativePath: string,
  revision: string | null,
  sourceFile: ts.SourceFile,
  start: number,
  end: number,
): SourceLocator {
  return {
    repositoryId,
    repositoryRelativePath,
    revision,
    range: sourceRange(sourceFile, start, end),
  };
}

function sourceRange(
  sourceFile: ts.SourceFile,
  start: number,
  end: number,
): SourceRange {
  const safeStart = Math.max(0, Math.min(start, sourceFile.end));
  const safeEnd = Math.max(safeStart, Math.min(end, sourceFile.end));
  const startPosition = sourceFile.getLineAndCharacterOfPosition(safeStart);
  const endPosition = sourceFile.getLineAndCharacterOfPosition(safeEnd);
  return {
    start: {
      line: startPosition.line + 1,
      column: startPosition.character,
    },
    end: {
      line: endPosition.line + 1,
      column: endPosition.character,
    },
  };
}

function stableUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertUuid(value: string, label: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new RepositoryAnalysisError(
      "invalid_repository_root",
      `${label} must be a UUID.`,
    );
  }
}

function canonicalPath(filePath: string): string {
  const normalized = resolve(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
