#!/usr/bin/env node
/* global require, process, console, fetch, Buffer */
/* eslint-disable @typescript-eslint/no-require-imports */
// Downloads an official VS Code build for the current platform and prints the
// path of its executable, for running the Extension Host suite in CI.
//
//   node test/host/download-vscode.cjs <version | stable> <destination dir>
//
// Builds come from Microsoft's update service (update.code.visualstudio.com);
// nothing is added to the repository's dependencies.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const [version = "stable", destination] = process.argv.slice(2);
if (!destination) {
  console.error("usage: download-vscode.cjs <version|stable> <destination>");
  process.exit(2);
}

const targets = {
  linux: { platform: "linux-x64", archive: "vscode.tar.gz" },
  darwin: { platform: "darwin-universal", archive: "vscode.zip" },
  win32: { platform: "win32-x64-archive", archive: "vscode.zip" },
};
const target = targets[process.platform];
if (!target) {
  console.error(`Unsupported platform ${process.platform}`);
  process.exit(2);
}

function executable(root) {
  const candidates = {
    linux: [path.join(root, "VSCode-linux-x64", "code")],
    darwin: ["Code", "Electron"].map((name) =>
      path.join(root, "Visual Studio Code.app", "Contents", "MacOS", name),
    ),
    win32: [path.join(root, "Code.exe")],
  }[process.platform];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function main() {
  const root = path.resolve(destination, version);
  const existing = executable(root);
  if (existing) {
    console.log(existing);
    return;
  }
  fs.mkdirSync(root, { recursive: true });
  const channel = version === "stable" ? "latest" : version;
  const url = `https://update.code.visualstudio.com/${channel}/${target.platform}/stable`;
  console.error(`Downloading ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const archive = path.join(root, target.archive);
  fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));

  // tar (GNU on Linux, bsdtar on macOS and Windows) extracts .tar.gz and .zip.
  // On Windows use System32's bsdtar: Git Bash's GNU tar may come first on
  // PATH, cannot read zip files, and treats "D:" as a remote host.
  const tar =
    process.platform === "win32"
      ? path.join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32",
          "tar.exe",
        )
      : "tar";
  const extracted = spawnSync(tar, ["-xf", archive, "-C", root], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (extracted.status !== 0) throw new Error("Extracting VS Code failed.");
  fs.rmSync(archive);

  const found = executable(root);
  if (!found) throw new Error(`No VS Code executable found under ${root}`);
  console.log(found);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
