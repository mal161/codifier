import type { SourceLocator } from "@codifier/domain";

export function createVscodeUri(
  repositoryRoot: string,
  locator: SourceLocator,
): string {
  const root = normalizeRepositoryRoot(repositoryRoot);
  const sourcePath = locator.repositoryRelativePath.trim();
  const sourceSegments = sourcePath.split(/[\\/]/).filter(Boolean);
  if (
    !sourcePath ||
    sourcePath.startsWith("/") ||
    sourcePath.startsWith("\\") ||
    /^[a-z]:/i.test(sourcePath) ||
    sourceSegments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("The recorded source path is not repository-relative.");
  }

  const { line, column } = locator.range.start;
  if (
    !Number.isSafeInteger(line) ||
    line < 1 ||
    !Number.isSafeInteger(column) ||
    column < 0
  ) {
    throw new Error("The recorded source location has invalid coordinates.");
  }

  const pathSegments = [...root.segments, ...sourceSegments];
  const encodedPath = pathSegments
    .map((segment) =>
      segment === root.drive ? segment : encodeURIComponent(segment),
    )
    .join("/");
  const uriPath = root.isUnc ? `//${encodedPath}` : encodedPath;
  const uriPrefix = root.isUnc ? "vscode://file" : "vscode://file/";
  return `${uriPrefix}${uriPath}:${line}:${column + 1}`;
}

interface NormalizedRoot {
  segments: string[];
  drive: string | null;
  isUnc: boolean;
}

function normalizeRepositoryRoot(value: string): NormalizedRoot {
  const slashNormalized = value.trim().replaceAll("\\", "/");
  const normalized =
    slashNormalized.length > 1
      ? slashNormalized.replace(/\/+$/, "")
      : slashNormalized;
  const driveMatch = /^([a-z]:)(?:\/(.*))?$/i.exec(normalized);
  if (driveMatch) {
    const segments = normalizeSegments(driveMatch[2] ?? "");
    return {
      segments: [driveMatch[1]!, ...segments],
      drive: driveMatch[1]!,
      isUnc: false,
    };
  }

  if (normalized.startsWith("//")) {
    const segments = normalizeSegments(normalized.slice(2));
    if (segments.length < 2) {
      throw new Error(
        "The UNC repository path must include a server and share.",
      );
    }
    return {
      segments,
      drive: null,
      isUnc: true,
    };
  }

  if (normalized.startsWith("/")) {
    return {
      segments: normalizeSegments(normalized.slice(1)),
      drive: null,
      isUnc: false,
    };
  }

  throw new Error(
    "Enter an absolute repository path before opening source in VS Code.",
  );
}

function normalizeSegments(value: string): string[] {
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        throw new Error("The repository path cannot navigate above its root.");
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments;
}
