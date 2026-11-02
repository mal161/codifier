// NVDA screen-reader flow for driver.mjs (--flow screenreader). Starts NVDA
// with a throwaway configuration and speech logging, drives the explorer in a
// visible Edge window by keyboard, and checks what NVDA announced during each
// step against expected phrases. Windows only.
//
// Playwright key presses go to the browser directly, not through NVDA, so this
// exercises what NVDA announces on focus changes, activation, and live-region
// updates (focus mode). NVDA's own browse-mode commands (H, K, arrow reading)
// are not exercised.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const nvdaExe = process.env.NVDA_EXE ?? "C:\\Program Files\\NVDA\\nvda.exe";

/** Local time of day in ms, matching NVDA's HH:MM:SS.mmm log stamps. */
const timeOfDay = (date = new Date()) =>
  ((date.getHours() * 60 + date.getMinutes()) * 60 + date.getSeconds()) * 1000 +
  date.getMilliseconds();

function parseSpeech(logPath) {
  if (!existsSync(logPath)) return [];
  const lines = readFileSync(logPath, "utf8").split(/\r?\n/);
  const spoken = [];
  let stamp = null;
  for (const line of lines) {
    const header = /\((\d{2}):(\d{2}):(\d{2})\.(\d{3})\)/.exec(line);
    if (header && /^IO - /.test(line)) {
      const [, h, m, s, ms] = header.map(Number);
      stamp = ((h * 60 + m) * 60 + s) * 1000 + ms;
    }
    const speaking = /^Speaking \[(.*)\]$/.exec(line.trim());
    if (speaking && stamp !== null) {
      const text = [
        ...speaking[1].matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g),
      ]
        .map((match) => match[1] ?? match[2])
        .join(" ");
      if (text.trim()) spoken.push({ at: stamp, text });
    }
  }
  return spoken;
}

export async function runScreenReaderFlow({
  chromium,
  webUrl,
  agentUrl,
  token,
  repositoryId,
  out,
  log,
}) {
  if (process.platform !== "win32")
    throw new Error("The screenreader flow needs Windows and NVDA.");
  if (!existsSync(nvdaExe))
    throw new Error(`NVDA not found at ${nvdaExe}; set NVDA_EXE.`);

  const configDir = join(out, "nvda-config");
  mkdirSync(configDir, { recursive: true });
  // Skip first-run dialogs that would take focus from the browser.
  writeFileSync(
    join(configDir, "nvda.ini"),
    [
      "schemaVersion = 11",
      "[general]",
      "showWelcomeDialogAtStartup = False",
      "[update]",
      "autoCheck = False",
      "askedAllowUsageStats = True",
      "allowUsageStats = False",
      // Reading the page aloud on load moves focus and makes steps flaky.
      "[virtualBuffers]",
      "autoSayAllOnPageLoad = False",
      "",
    ].join("\r\n"),
  );
  const nvdaLog = join(out, "nvda.log");
  // nvda.exe requests uiAccess, which Windows grants only to processes started
  // through ShellExecute; CreateProcess (Node's spawn) fails with EACCES.
  const startNvda = (args) =>
    spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Start-Process -FilePath '${nvdaExe}' -ArgumentList ${args.map((arg) => `'${arg.replace(/'/g, "''")}'`).join(",")}`,
      ],
      { stdio: "ignore" },
    );
  const quitNvda = () => startNvda(["-q"]);
  quitNvda(); // stop any running copy
  await new Promise((done) => setTimeout(done, 1500));
  startNvda([
    "-m",
    "--disable-addons",
    "-c",
    configDir,
    "-f",
    nvdaLog,
    "-l",
    "12",
  ]);
  process.once("exit", quitNvda);

  const deadline = Date.now() + 30_000;
  while (
    Date.now() < deadline &&
    !(existsSync(nvdaLog) && /Speaking/.test(readFileSync(nvdaLog, "utf8")))
  ) {
    await new Promise((done) => setTimeout(done, 500));
  }
  log(`NVDA running (log ${nvdaLog})`);

  const steps = [];
  const browser = await chromium.launch({ channel: "msedge", headless: false });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await page.goto(webUrl);
    await page.bringToFront();
    await page.waitForTimeout(2500); // let NVDA attach and finish reading the page

    async function step(name, expected, action, settleMs = 1800) {
      const start = timeOfDay();
      await action();
      await page.waitForTimeout(settleMs);
      steps.push({ name, expected, start, end: timeOfDay() });
    }
    const press = (key) => page.keyboard.press(key);

    await page.fill("#agent-url", agentUrl);
    await step("Agent address field", ["Agent address", "edit"], () =>
      page.focus("#agent-url"),
    );
    await step("Tab to token field", ["Agent token", "protected"], () =>
      press("Tab"),
    );
    await page.fill("#agent-token", token);
    await step("Tab to connect button", ["Connect to agent", "button"], () =>
      press("Tab"),
    );
    await step(
      "Connect announces success",
      ["Connected to the local agent"],
      () => press("Enter"),
      2500,
    );

    await page.fill("#repository-id", repositoryId);
    await step("Load saved button", ["Load saved", "button"], () =>
      page.getByRole("button", { name: "Load saved" }).focus(),
    );
    await step(
      "Loading announces success",
      ["Saved graph loaded"],
      () => press("Enter"),
      2500,
    );

    await step(
      "History disclosure button",
      ["Show revision history", "button"],
      () => page.getByRole("button", { name: "Show revision history" }).focus(),
    );
    await step(
      "Opening history moves focus to the revision list",
      ["Graph revisions, newest first"],
      () => press("Enter"),
      2000,
    );
    const revisionOne = page
      .locator("li")
      .filter({ has: page.getByText("Revision 1", { exact: true }) });
    await step(
      "Restore button names its action",
      ["Restore this revision", "button"],
      () =>
        revisionOne
          .getByRole("button", { name: "Restore this revision" })
          .focus(),
    );
    await step(
      "Activating restore moves focus to the confirmation",
      ["Confirm restore of revision 1", "button"],
      () => press("Enter"),
    );
    await step("Tab reaches Cancel", ["Cancel", "button"], () => press("Tab"));
    await step(
      "Cancel returns focus to the restore button",
      ["Restore this revision", "button", "collapsed"],
      () => press("Enter"),
    );

    await step("Rules navigation", ["Rules", "button"], () =>
      page.getByRole("button", { name: "Rules" }).focus(),
    );
    await step(
      "Opening Rules moves focus to its heading",
      ["Architecture rules"],
      () => press("Enter"),
      2500,
    );
    const finding = page
      .locator("li")
      .filter({ hasText: "Intended component has no mapped code" });
    await step("Record exception button", ["Record exception", "button"], () =>
      finding.getByRole("button", { name: "Record exception" }).focus(),
    );
    await step(
      "Opening the form moves focus to its first field",
      ["Your name", "edit"],
      () => press("Enter"),
    );
    await page.keyboard.type("Screen reader test");
    await step(
      "Rationale field is labelled",
      ["Why is this finding acceptable", "edit"],
      () => press("Tab"),
    );
    await page.keyboard.type("Planned for the next milestone.");
    await step(
      "Save announces the result",
      ["Exception recorded"],
      async () => {
        await finding.getByRole("button", { name: "Save exception" }).focus();
        await press("Enter");
      },
      2500,
    );
  } finally {
    await browser.close().catch(() => {});
    await new Promise((done) => setTimeout(done, 1500)); // let NVDA flush its log
    quitNvda();
  }

  const spoken = parseSpeech(nvdaLog);
  const results = steps.map((item) => {
    const heard = spoken
      .filter(
        (entry) => entry.at >= item.start - 50 && entry.at <= item.end + 50,
      )
      .map((entry) => entry.text);
    const joined = heard.join(" | ").toLowerCase();
    const missing = item.expected.filter(
      (phrase) => !joined.includes(phrase.toLowerCase()),
    );
    return {
      name: item.name,
      expected: item.expected,
      heard,
      pass: missing.length === 0,
      missing,
    };
  });
  const nvdaVersion =
    /NVDA version ([^\s,]+)/.exec(
      existsSync(nvdaLog) ? readFileSync(nvdaLog, "utf8") : "",
    )?.[1] ?? "unknown";
  writeFileSync(
    join(out, "screenreader-report.json"),
    `${JSON.stringify({ nvdaVersion, results }, null, 2)}\n`,
  );
  for (const result of results) {
    log(
      `${result.pass ? "✓" : "✗"} ${result.name}: heard ${JSON.stringify(result.heard.join(" | ").slice(0, 160))}`,
    );
  }
  return results;
}
