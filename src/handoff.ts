#!/usr/bin/env node
/**
 * Hand the current Claude session over to Codex.
 *
 * When Claude is down (or you just want a second engine to take over), this
 * grabs the FULL transcript of the current session, writes it to disk, and opens
 * the INTERACTIVE Codex TUI seeded with a takeover prompt — so Codex reads the
 * context, continues the task, and you can keep working in it.
 *
 *   npx tsx src/handoff.ts            # latest session for this cwd → opens codex
 *   npx tsx src/handoff.ts --print    # print the handoff prompt instead of launching codex
 *   npx tsx src/handoff.ts <file.jsonl>   # hand off a specific transcript
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { findLatestTranscript, flattenTranscript } from "./transcript.js";

/** Where we stash the flattened transcript for Codex to read (gitignored). */
const TRANSCRIPT_FILE = ".claude-resend/handoff.txt";

const INSTRUCTION = [
  "You are taking over a coding session that was being run by Claude Code, because",
  "Claude went down. The full prior conversation between the user and Claude is saved",
  `in the file ${TRANSCRIPT_FILE} as a User/Claude dialogue — read it first. Then pick`,
  "up exactly where it left off: read the relevant files yourself and continue the task",
  "to completion — make the edits, run what you need, and finish what Claude was in the",
  "middle of. Treat the LAST user message as the active request unless it was already",
  "fully handled.",
].join(" ");

function main(): void {
  const args = process.argv.slice(2);
  const printOnly = args.includes("--print");
  const fileArg = args.find((a) => !a.startsWith("--"));

  const transcriptPath = fileArg ?? findLatestTranscript(process.cwd());
  if (!transcriptPath) {
    console.error(
      "No session transcript found for this directory.\n" +
        "Looked under ~/.claude/projects/<cwd>. Pass one explicitly: handoff <file.jsonl>",
    );
    process.exit(1);
  }

  const dialogue = flattenTranscript(transcriptPath);
  if (!dialogue) {
    console.error(`Transcript had no readable turns: ${transcriptPath}`);
    process.exit(1);
  }

  if (printOnly) {
    console.log(`# Handoff prompt (transcript: ${transcriptPath})\n`);
    console.log(INSTRUCTION + "\n\n--- SESSION TRANSCRIPT ---\n\n" + dialogue);
    return;
  }

  // Stash the transcript on disk so Codex can read it. An interactive TUI needs
  // stdin for the keyboard, so we can't pipe the transcript in like exec did.
  mkdirSync(dirname(TRANSCRIPT_FILE), { recursive: true });
  writeFileSync(TRANSCRIPT_FILE, dialogue, "utf8");

  console.error(`↪︎ Handing ${dialogue.length} chars of session context to Codex…`);
  console.error(`   (source: ${transcriptPath})\n`);

  // Launch the INTERACTIVE Codex TUI seeded with the takeover prompt. stdio is
  // inherited so Codex owns the terminal and you can keep working in it.
  const child = spawn("codex", [INSTRUCTION], { stdio: "inherit" });
  child.on("error", (err) => {
    console.error(`Failed to launch codex: ${err.message}`);
    console.error("Is the Codex CLI installed and on PATH? (`which codex`)");
    process.exit(1);
  });
  child.on("close", (code) => process.exit(code ?? 0));
}

main();
