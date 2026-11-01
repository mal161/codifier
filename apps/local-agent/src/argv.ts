/**
 * Package-manager scripts (`pnpm start -- serve --port 4199`) can forward the
 * `--` separator literally. Commander would then treat every following option
 * as a positional argument, so drop a separator that precedes the subcommand.
 */
export function normalizeArgv(argv: readonly string[]): string[] {
  const [runtime = "", script = "", first, ...rest] = argv;
  return first === "--" ? [runtime, script, ...rest] : [...argv];
}
