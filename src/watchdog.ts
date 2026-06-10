import type { ClaudeRunner, RunOutcome } from "./types.js";

export interface WatchdogOptions {
  /** Max attempts before giving up. 0 = retry forever (default). */
  maxAttempts?: number;
  /** First backoff delay in ms (default 5s). Doubles each outage. */
  baseDelayMs?: number;
  /** Cap on the backoff delay in ms (default 60s). */
  maxDelayMs?: number;
  /** Called after every attempt — wire this to your logging / UI. */
  onAttempt?: (info: { attempt: number; outcome: RunOutcome; nextDelayMs?: number }) => void;
  /** Injectable sleep so tests/demos don't wait in real time. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Send `message` to Claude and, if Claude is down, keep resending the SAME
 * message with exponential backoff until it gets through (or we hit maxAttempts).
 *
 * Non-outage errors stop immediately — we never spin on a real mistake.
 */
export async function resendUntilUp(
  run: ClaudeRunner,
  message: string,
  opts: WatchdogOptions = {},
): Promise<RunOutcome> {
  const maxAttempts = opts.maxAttempts ?? 0;
  const baseDelayMs = opts.baseDelayMs ?? 5_000;
  const maxDelayMs = opts.maxDelayMs ?? 60_000;
  const sleep = opts.sleep ?? defaultSleep;

  let attempt = 0;
  while (true) {
    attempt++;
    const outcome = await run(message);

    if (outcome.status !== "outage") {
      opts.onAttempt?.({ attempt, outcome });
      return outcome; // success or non-recoverable error
    }

    const reachedCap = maxAttempts > 0 && attempt >= maxAttempts;
    const nextDelayMs = reachedCap
      ? undefined
      : Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);

    opts.onAttempt?.({ attempt, outcome, nextDelayMs });

    if (reachedCap) return outcome;
    await sleep(nextDelayMs!);
  }
}
