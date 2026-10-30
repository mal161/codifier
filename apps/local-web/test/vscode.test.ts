import type { SourceLocator } from "@codifier/domain";
import { describe, expect, it } from "vitest";
import { createVscodeUri } from "../src/navigation/vscode.js";

const locator: SourceLocator = {
  repositoryId: "7b9442d6-faaa-49f9-a39e-7de8a276a978",
  repositoryRelativePath: "src/components/a file#one.tsx",
  revision: "fixture-revision",
  range: {
    start: { line: 8, column: 3 },
    end: { line: 10, column: 4 },
  },
};

describe("createVscodeUri", () => {
  it("creates a Windows VS Code URI with an encoded path and exact start position", () => {
    expect(createVscodeUri("C:\\work\\my #repo", locator)).toBe(
      "vscode://file/C:/work/my%20%23repo/src/components/a%20file%23one.tsx:8:4",
    );
  });

  it("creates a POSIX VS Code URI", () => {
    expect(createVscodeUri("/home/dev/project", locator)).toBe(
      "vscode://file/home/dev/project/src/components/a%20file%23one.tsx:8:4",
    );
  });

  it("supports UNC repository paths", () => {
    expect(createVscodeUri("\\\\server\\share\\project", locator)).toBe(
      "vscode://file//server/share/project/src/components/a%20file%23one.tsx:8:4",
    );
  });

  it("rejects relative roots and source paths that escape the repository", () => {
    expect(() => createVscodeUri("project", locator)).toThrow(
      "absolute repository path",
    );
    expect(() =>
      createVscodeUri("C:\\work\\project", {
        ...locator,
        repositoryRelativePath: "../outside.ts",
      }),
    ).toThrow("not repository-relative");
  });

  it("rejects invalid source coordinates", () => {
    expect(() =>
      createVscodeUri("/home/dev/project", {
        ...locator,
        range: {
          ...locator.range,
          start: { line: 0, column: 0 },
        },
      }),
    ).toThrow("invalid coordinates");
  });
});
