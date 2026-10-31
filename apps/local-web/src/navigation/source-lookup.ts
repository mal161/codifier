import type { GraphEntity, GraphSnapshot } from "@codifier/domain";

interface SourceLocationQuery {
  repositoryRelativePath: string;
  line: number;
  column: number | null;
}

export function lookupEntitiesAtSourceLocation(
  snapshot: GraphSnapshot,
  input: string,
): GraphEntity[] {
  const query = parseSourceLocation(input);
  return snapshot.entities
    .filter(
      (
        entity,
      ): entity is GraphEntity & {
        source: NonNullable<GraphEntity["source"]>;
      } =>
        (entity.kind === "file" || entity.kind === "symbol") &&
        entity.source !== undefined &&
        entity.source.repositoryRelativePath === query.repositoryRelativePath &&
        containsLocation(entity.source.range, query),
    )
    .sort(compareSourceRanges);
}

function parseSourceLocation(input: string): SourceLocationQuery {
  const match = /^(.+?):([1-9]\d*)(?::([1-9]\d*))?$/.exec(input.trim());
  if (!match) {
    throw new Error(
      "Enter a repository-relative location such as src/file.ts:24 or src/file.ts:24:8.",
    );
  }

  const repositoryRelativePath = match[1]!.replaceAll("\\", "/");
  const pathParts = repositoryRelativePath.split("/");
  if (
    repositoryRelativePath.startsWith("/") ||
    /^[a-zA-Z]:/.test(repositoryRelativePath) ||
    repositoryRelativePath.includes(":") ||
    pathParts.some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new Error(
      "Use a normalized repository-relative path; absolute paths and traversal segments are not supported.",
    );
  }

  const line = Number(match[2]);
  const column = match[3] === undefined ? null : Number(match[3]);
  if (
    !Number.isSafeInteger(line) ||
    (column !== null && !Number.isSafeInteger(column))
  ) {
    throw new Error(
      "The source line and column must be safe positive integers.",
    );
  }
  return { repositoryRelativePath, line, column };
}

function containsLocation(
  range: NonNullable<GraphEntity["source"]>["range"],
  query: SourceLocationQuery,
): boolean {
  if (query.column === null) {
    return query.line >= range.start.line && query.line <= range.end.line;
  }

  const point = { line: query.line, column: query.column - 1 };
  const afterStart =
    point.line > range.start.line ||
    (point.line === range.start.line && point.column >= range.start.column);
  const beforeEnd =
    point.line < range.end.line ||
    (point.line === range.end.line && point.column < range.end.column);
  return afterStart && beforeEnd;
}

function compareSourceRanges(left: GraphEntity, right: GraphEntity): number {
  const leftRange = left.source!.range;
  const rightRange = right.source!.range;
  const lineSpan =
    leftRange.end.line -
    leftRange.start.line -
    (rightRange.end.line - rightRange.start.line);
  if (lineSpan !== 0) {
    return lineSpan;
  }
  const leftColumnSpan =
    leftRange.end.line === leftRange.start.line
      ? leftRange.end.column - leftRange.start.column
      : Number.POSITIVE_INFINITY;
  const rightColumnSpan =
    rightRange.end.line === rightRange.start.line
      ? rightRange.end.column - rightRange.start.column
      : Number.POSITIVE_INFINITY;
  return (
    leftColumnSpan - rightColumnSpan ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  );
}
