/**
 * Interactive demo — YOU control whether Claude is up or down.
 *
 * This drives the REAL watchdog (`resendUntilUp` from src/), but instead of a
 * prebuilt script that fails N times, the "is Claude down?" flag is a live
 * switch you flip from your keyboard. Watch the watchdog resend on outage and
 * succeed the instant you bring Claude back up.
 *
 *   d  → take Claude DOWN  (next attempts return 529 overloaded)
 *   u  → bring Claude UP   (next attempt succeeds)
 *   q  → quit
 *
 * Run it:  npx tsx example/interactive.ts
 */
import readline from "node:readline";
import { resendUntilUp } from "../src/watchdog.js";
import type { ClaudeRunner } from "../src/types.js";

let claudeUp = false; // start DOWN so you immediately see the resend loop
let wake: (() => void) | null = null; // lets a keypress cut a backoff sleep short

/** A fake Claude whose health is the live `claudeUp` flag. */
const liveClaude: ClaudeRunner = async (message) =>
  claudeUp
    ? { status: "success", output: `Claude's reply to: "${message}"` }
    : { status: "outage", error: "API Error: 529 overloaded_error" };

/** Sleep that can be interrupted early when you flip the switch. */
const interruptibleSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      wake = null;
      resolve();
    }, ms);
    wake = () => {
      clearTimeout(timer);
      wake = null;
      resolve();
    };
  });

function setupKeys(): void {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on("keypress", (_str, key) => {
    if (!key) return;
    if (key.name === "d") {
      claudeUp = false;
      console.log("   🔻 [you] Claude is now DOWN");
    } else if (key.name === "u") {
      claudeUp = true;
      console.log("   🔺 [you] Claude is now UP — retrying now…");
      wake?.(); // don't wait out the backoff; retry immediately
    } else if (key.name === "q" || (key.ctrl && key.name === "c")) {
      console.log("\n👋 bye");
      process.exit(0);
    }
  });
}

async function main(): Promise<void> {
  setupKeys();
  const message = "Summarize my last git commit in one sentence.";

  console.log(`📨 Sending: "${message}"`);
  console.log("🎮 Controls:  [d] take Claude down   [u] bring Claude up   [q] quit");
  console.log("   (starts DOWN — press 'u' whenever you want it to recover)\n");

  const outcome = await resendUntilUp(liveClaude, message, {
    baseDelayMs: 1_000, // watchable backoff: 1s → 2s → 4s … capped at maxDelayMs
    maxDelayMs: 8_000,
    sleep: interruptibleSleep, // pressing 'u' cuts the wait short
    onAttempt: ({ attempt, outcome, nextDelayMs }) => {
      if (outcome.status === "outage") {
        console.log(
          `  attempt ${attempt} → down (${outcome.error}). ` +
            (nextDelayMs ? `resending in ${nextDelayMs}ms…` : "giving up."),
        );
      } else if (outcome.status === "success") {
        console.log(`  attempt ${attempt} → back up! ✅`);
      }
    },
  });

  console.log();
  if (outcome.status === "success") console.log(`🎉 Got through:\n   ${outcome.output}`);
  else console.log(`💥 ${outcome.error}`);
  process.exit(outcome.status === "success" ? 0 : 1);
}

main();
