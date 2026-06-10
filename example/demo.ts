/**
 * Working example — no real outage required.
 *
 * We hand the watchdog a FAKE Claude that pretends to be down for the first
 * 3 attempts (529 overloaded), then recovers. The watchdog resends the SAME
 * message on each outage and only stops once Claude is back up.
 *
 * Run it:  npm run demo
 */
import { resendUntilUp } from "../src/watchdog.js";
import type { ClaudeRunner } from "../src/types.js";

/** Tiny ANSI color helpers — no deps, disabled when output isn't a TTY. */
const useColor = process.stdout.isTTY;
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = {
  dim: paint("2"),
  bold: paint("1"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  cyan: paint("36"),
  magenta: paint("35"),
};

/** Draw a single-line value inside a rounded box, padded to a fixed width. */
function box(lines: string[]): string {
  const width = 60;
  const top = c.dim("╭" + "─".repeat(width) + "╮");
  const bottom = c.dim("╰" + "─".repeat(width) + "╯");
  const body = lines.map((l) => c.dim("│ ") + l).join("\n");
  return `${top}\n${body}\n${bottom}`;
}

/** A pretend Claude that is "down" for the first `downFor` calls, then works. */
function makeFlakyClaude(downFor: number): ClaudeRunner {
  let calls = 0;
  return async (message: string) => {
    calls++;
    if (calls <= downFor) {
      return { status: "outage", error: "API Error: 529 overloaded_error" };
    }
    return { status: "success", output: `Claude's reply to: "${message}"` };
  };
}

async function main(): Promise<void> {
  const message = "Summarize my last git commit in one sentence.";

  console.log();
  console.log(
    box([
      c.bold(c.magenta("🐶 claude-resend-watchdog")),
      c.dim("auto-resends your last message when Claude goes down"),
    ]),
  );
  console.log();
  console.log(`${c.cyan("📨 You sent")}  ${c.bold(`"${message}"`)}`);
  console.log(c.dim("🔻 Simulating Claude DOWN for 3 attempts, then recovering…"));
  console.log();

  const outcome = await resendUntilUp(makeFlakyClaude(3), message, {
    baseDelayMs: 200, // fast backoff so the demo runs in ~2s instead of minutes
    maxDelayMs: 1_000,
    onAttempt: ({ attempt, outcome, nextDelayMs }) => {
      const tag = c.dim(`attempt ${attempt}`);
      if (outcome.status === "outage") {
        const next = nextDelayMs
          ? c.dim(`↻ resending in ${nextDelayMs}ms…`)
          : c.dim("giving up.");
        console.log(`  ${c.red("●")} ${tag} ${c.red("Claude is down")} ${c.dim(`(${outcome.error})`)}  ${next}`);
      } else if (outcome.status === "success") {
        console.log(`  ${c.green("●")} ${tag} ${c.green("Claude is back up!")} ✅`);
      }
    },
  });

  console.log();
  if (outcome.status === "success") {
    console.log(
      box([
        c.green(c.bold("🎉 Auto-resend succeeded")),
        c.dim(outcome.output),
      ]),
    );
  } else {
    console.log(box([c.red(c.bold("💥 Failed")), c.dim(outcome.error)]));
    process.exit(1);
  }
  console.log();
}

main();
