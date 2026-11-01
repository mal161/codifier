import { describe, expect, it } from "vitest";
import { normalizeArgv } from "../src/argv.js";

describe("normalizeArgv", () => {
  it("drops a forwarded separator before the subcommand", () => {
    expect(
      normalizeArgv(["node", "cli.ts", "--", "serve", "--port", "4199"]),
    ).toEqual(["node", "cli.ts", "serve", "--port", "4199"]);
  });

  it("keeps separators that appear after the subcommand", () => {
    const argv = ["node", "cli.ts", "graph", "put", "--", "--file.json"];
    expect(normalizeArgv(argv)).toEqual(argv);
  });

  it("leaves ordinary invocations unchanged", () => {
    const argv = ["node", "cli.ts", "serve", "--port", "4199"];
    expect(normalizeArgv(argv)).toEqual(argv);
  });
});
