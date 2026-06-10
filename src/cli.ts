#!/usr/bin/env node
import { makeClaudeRunner } from "./claude.js";
import { resendUntilUp } from "./watchdog.js";
import { saveMessage, loadMessage } from "./state.js";
import type { ClaudeRunner } from "./types.js";

const STATE_PATH = process.env.CLAUDE_RESEND_STATE ?? ".claude-resend/last-message.json";

const firstLine = (s: string) => s.split("\n")[0]!.slice(0, 200);
const fmt = (iso: string) => new Date(iso).toLocaleString();

async function runWithWatchdog(runner: ClaudeRunner, message: string): Promise<void> {
  const outcome = await resendUntilUp(runner, message, {
    onAttempt: ({ attempt, outcome, nextDelayMs }) => {
      if (outcome.status === "outage") {
        const next = nextDelayMs ? ` retrying in ${Math.round(nextDelayMs / 1000)}s…` : " giving up.";
        console.error(`⚠️  attempt ${attempt}: Claude looks down — ${firstLine(outcome.error)}.${next}`);
      } else if (outcome.status === "error") {
        console.error(`✗ attempt ${attempt}: ${firstLine(outcome.error)}`);
      } else {
        console.error(`✓ attempt ${attempt}: Claude responded.`);
      }
    },
  });

  if (outcome.status === "success") {
    console.log(outcome.output);
  } else {
    console.error(`\nGave up: ${firstLine(outcome.error)}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const runner = makeClaudeRunner();

  switch (cmd) {
    case "send": {
      const message = rest.join(" ").trim();
      if (!message) {
        console.error('usage: claude-resend send "<message>"');
        process.exit(1);
      }
      saveMessage(STATE_PATH, message);
      await runWithWatchdog(runner, message);
      break;
    }
    case "resend": {
      const saved = loadMessage(STATE_PATH);
      if (!saved) {
        console.error("No saved message yet. Run `claude-resend send \"<message>\"` first.");
        process.exit(1);
      }
      console.error(`↻ Resending message saved at ${fmt(saved.savedAt)}`);
      await runWithWatchdog(runner, saved.message);
      break;
    }
    case "last": {
      const saved = loadMessage(STATE_PATH);
      console.log(saved ? saved.message : "(no saved message)");
      break;
    }
    default:
      console.error('Commands:\n  send "<message>"   send and auto-resend if Claude is down\n  resend             resend the last saved message\n  last               print the last saved message');
      process.exit(1);
  }
}

main();
