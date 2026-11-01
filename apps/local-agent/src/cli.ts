#!/usr/bin/env node
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Command } from "commander";
import { graphSnapshotSchema } from "@codifier/contracts";
import { openGraphStore } from "@codifier/storage";
import { normalizeArgv } from "./argv.js";
import { createAgentServer } from "./server.js";

const defaultDatabasePath =
  process.env.LOCALAPPDATA !== undefined
    ? join(process.env.LOCALAPPDATA, "Codifier", "codifier.sqlite")
    : join(homedir(), ".local", "share", "codifier", "codifier.sqlite");
const defaultAgentUrl =
  process.env.CODIFIER_AGENT_URL ?? "http://127.0.0.1:4141";

const program = new Command()
  .name("codifier")
  .description("Local-first codebase architecture agent")
  .showHelpAfterError();

program
  .command("serve")
  .description("Start the authenticated local companion agent")
  .option("--database <path>", "SQLite database path", defaultDatabasePath)
  .option("--host <host>", "Bind address (loopback only)", "127.0.0.1")
  .option("--port <port>", "HTTP port", "4141")
  .action(async (options: { database: string; host: string; port: string }) => {
    const token = requireToken();
    const databasePath = resolve(options.database);
    const port = Number(options.port);

    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new Error("--port must be an integer between 0 and 65535.");
    }

    const allowedOrigins = parseAllowedOrigins();
    await mkdir(dirname(databasePath), { recursive: true });
    const store = openGraphStore(databasePath);
    let server: ReturnType<typeof createAgentServer>;
    try {
      server = createAgentServer({
        token,
        store,
        host: options.host,
        port,
        allowedOrigins,
      });
      const address = await server.listen({ host: options.host, port });
      server.log.info({ address }, "Codifier local agent listening");
    } catch (error) {
      store.close();
      throw error;
    }

    const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
      server.log.info({ signal }, "Stopping Codifier local agent");
      try {
        await server.close();
      } finally {
        store.close();
      }
    };

    process.once("SIGINT", () => {
      void shutdown("SIGINT").catch(reportError);
    });
    process.once("SIGTERM", () => {
      void shutdown("SIGTERM").catch(reportError);
    });
  });

program
  .command("health")
  .description("Check the running local agent")
  .action(async () => {
    const response = await agentFetch("/v1/health");
    await printResponse(response);
  });

const graph = program
  .command("graph")
  .description("Read and replace local graph snapshots");

graph
  .command("get <repositoryId>")
  .description("Print a repository graph snapshot as JSON")
  .action(async (repositoryId: string) => {
    const response = await agentFetch(
      `/v1/repositories/${encodeURIComponent(repositoryId)}/graph`,
    );
    await printResponse(response);
  });

graph
  .command("put <snapshotFile>")
  .description("Validate and replace the graph snapshot from a JSON file")
  .action(async (snapshotFile: string) => {
    const contents = await readFile(resolve(snapshotFile), "utf8");
    const snapshot = graphSnapshotSchema.parse(JSON.parse(contents));
    const response = await agentFetch(
      `/v1/repositories/${encodeURIComponent(snapshot.repositoryId)}/graph`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(snapshot),
      },
    );
    await printResponse(response);
  });

program
  .command("analyze <repositoryRoot> [repositoryId]")
  .description("Analyze a local TypeScript/JavaScript repository")
  .option(
    "--revision <revision>",
    "Source revision associated with this analysis",
  )
  .action(
    async (
      repositoryRoot: string,
      repositoryId: string | undefined,
      options: { revision?: string },
    ) => {
      const path = resolve(repositoryRoot);
      const endpoint = repositoryId
        ? `/v1/repositories/${encodeURIComponent(repositoryId)}/analyze`
        : "/v1/analyze";
      const response = await agentFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rootPath: path,
          ...(options.revision ? { revision: options.revision } : {}),
        }),
      });
      await printResponse(response);
    },
  );

program.parseAsync(normalizeArgv(process.argv)).catch(reportError);

async function agentFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = requireToken();
  return fetch(new URL(path, defaultAgentUrl), {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${token}`,
    },
  });
}

async function printResponse(response: Response): Promise<void> {
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Local agent returned ${response.status}: ${body || response.statusText}`,
    );
  }
  if (body.length > 0) {
    process.stdout.write(`${JSON.stringify(JSON.parse(body), null, 2)}\n`);
  } else {
    process.stdout.write("ok\n");
  }
}

function requireToken(): string {
  const token = process.env.CODIFIER_AGENT_TOKEN;
  if (!token || Buffer.byteLength(token, "utf8") < 32) {
    throw new Error(
      "Set CODIFIER_AGENT_TOKEN to a secret of at least 32 bytes. Keep it out of command-line arguments and logs.",
    );
  }
  return token;
}

function parseAllowedOrigins(): string[] {
  return (process.env.CODIFIER_AGENT_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`codifier: ${message}\n`);
  process.exitCode = 1;
}
