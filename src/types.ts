/**
 * The result of a single attempt to talk to Claude.
 *
 * - success: Claude answered. Stop.
 * - outage:  Claude is down (529 / 5xx / network). This is the case we resend on.
 * - error:   A different, non-recoverable error (bad usage, auth, etc.). Don't spin on it.
 */
export type RunOutcome =
  | { status: "success"; output: string }
  | { status: "outage"; error: string }
  | { status: "error"; error: string };

/** Anything that can take a message and try to get a reply from Claude. */
export type ClaudeRunner = (message: string) => Promise<RunOutcome>;
