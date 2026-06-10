#!/usr/bin/env node
/**
 * Wait out a Claude outage, then drop you back into YOUR session with your
 * last message resent.
 *
 * This is the Claude-side twin of handoff.ts. handoff.ts bails to Codex; this
 * one waits for Claude and resumes your actual conversation. It works in two
 * phases:
 *
 *   1. Health gate — polls `claude -p` with exponential backoff until Claude is
 *      reachable again. This is the part that has to live outside the session,
 *      because a Claude Code skill is run *by* Claude and can't fire while
 *      Claude is down. Run this straight from your shell the moment you 529 out.
 *   2. Resume — once Claude is back, launches the INTERACTIVE TUI on your exact
 *      session (`claude -r <session-id> "<last message>"`) so you continue
 *      where the outage cut you off, with your last message resent.
 *
 *   npx tsx src/resend.ts            # latest session for this cwd → wait, then resume it
 *   npx tsx src/resend.ts --print    # print the message it would resend, then stop
 *   npx tsx src/resend.ts <file.jsonl>   # resume the session for a specific transcript
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { makeClaudeRunner } from "./claude.js";
import { resendUntilUp } from "./watchdog.js";
import { findLatestTranscript, lastUserMessage } from "./transcript.js";

const firstLine = (s: string) => s.split("\n")[0]!.slice(0, 200);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const printOnly = args.includes("--print");
  const fileArg = args.find((a) => !a.startsWith("--"));

  const transcriptPath = fileArg ?? findLatestTranscript(process.cwd());
  if (!transcriptPath) {
    console.error(
      "No session transcript found for this directory.\n" +
        "Looked under ~/.claude/projects/<cwd>. Pass one explicitly: resend <file.jsonl>",
    );
    process.exit(1);
  }
  if (!existsSync(transcriptPath)) {
    console.error(`Transcript file does not exist: ${transcriptPath}`);
    process.exit(1);
  }

  const message = lastUserMessage(transcriptPath);
  if (!message) {
    console.error(`No user message found in transcript: ${transcriptPath}`);
    process.exit(1);
  }

  // The session ID is the transcript filename: <session-id>.jsonl
  const sessionId = basename(transcriptPath, ".jsonl");

  if (printOnly) {
    console.log(`# Would resume session ${sessionId} and resend (transcript: ${transcriptPath})\n`);
    console.log(message);
    return;
  }

  // Phase 1 — wait until Claude is reachable again, retrying on outage only.
  // A tiny probe is enough to detect health; we resend the REAL message in the
  // interactive session below, so it lands in your actual conversation.
  console.error(`⏳ Waiting for Claude to come back up before resuming session ${sessionId}…`);
  const runner = makeClaudeRunner();
  const health = await resendUntilUp(runner, "Reply with: ok", {
    onAttempt: ({ attempt, outcome, nextDelayMs }) => {
      if (outcome.status === "outage") {
        const next = nextDelayMs ? ` retrying in ${Math.round(nextDelayMs / 1000)}s…` : " giving up.";
        console.error(`⚠️  attempt ${attempt}: Claude still down — ${firstLine(outcome.error)}.${next}`);
      } else if (outcome.status === "success") {
        console.error(`✓ Claude is back up.`);
      } else {
        console.error(`✗ Claude CLI error: ${firstLine(outcome.error)}`);
      }
    },
  });
  if (health.status === "outage") {
    console.error(`\nGave up waiting: ${firstLine(health.error)}`);
    process.exit(1);
  }
  if (health.status === "error") {
    console.error(`\nCannot resume session until this is fixed: ${firstLine(health.error)}`);
    process.exit(1);
  }

  // Phase 2 — drop into the real session interactively, resending the message.
  console.error(`↪︎ Resuming your session and resending your last message:`);
  console.error(`   "${firstLine(message)}"\n`);
  const child = spawn("claude", ["-r", sessionId, message], { stdio: "inherit" });
  child.on("error", (err) => {
    console.error(`Failed to launch claude: ${err.message}`);
    console.error("Is the Claude CLI on PATH? (`which claude`)");
    process.exit(1);
  });
  child.on("close", (code) => process.exit(code ?? 0));
}

main();
