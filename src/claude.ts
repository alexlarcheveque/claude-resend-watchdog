import { spawn } from "node:child_process";
import type { ClaudeRunner, RunOutcome } from "./types.js";

/**
 * Signatures that mean "Claude is down" rather than "you did something wrong".
 * These are the cases worth resending on.
 */
const OUTAGE_PATTERNS: RegExp[] = [
  /overloaded/i, // 529 overloaded_error
  /\b5\d\d\b/, // any 500-599 HTTP status in the output
  /internal server error/i,
  /service unavailable/i,
  /bad gateway/i,
  /gateway timeout/i,
  /api error/i,
  /fetch failed/i,
  /econnrefused/i,
  /etimedout/i,
  /enotfound/i,
  /econnreset/i,
  /socket hang up/i,
  /network/i,
];

export function looksLikeOutage(text: string): boolean {
  return OUTAGE_PATTERNS.some((re) => re.test(text));
}

/**
 * Build a runner that drives the real `claude` CLI in headless print mode
 * (`claude -p "<message>"`). Classifies the result so the watchdog knows
 * whether to resend.
 */
export function makeClaudeRunner(opts: { timeoutMs?: number } = {}): ClaudeRunner {
  const timeoutMs = opts.timeoutMs ?? 120_000;

  return (message: string) =>
    new Promise<RunOutcome>((resolve) => {
      const child = spawn("claude", ["-p", message], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve({ status: "outage", error: `timed out after ${timeoutMs}ms` });
      }, timeoutMs);

      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));

      child.on("error", (err) => {
        clearTimeout(timer);
        // Can't even spawn claude (e.g. it crashed / isn't reachable) — treat as outage.
        resolve({ status: "outage", error: `failed to launch claude: ${err.message}` });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const blob = `${stdout}\n${stderr}`.trim();
        if (looksLikeOutage(blob)) {
          resolve({ status: "outage", error: blob || `exit ${code}` });
        } else if (code === 0) {
          resolve({ status: "success", output: stdout.trim() });
        } else {
          resolve({ status: "error", error: blob || `exit ${code}` });
        }
      });
    });
}
