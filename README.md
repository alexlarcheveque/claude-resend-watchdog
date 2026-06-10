# claude-resend-watchdog

Survive a Claude Code outage. When Claude 529s mid-task, you've got two moves:
**wait for Claude and resume your exact session** (`resend`), or **hand the whole
session to Codex and keep moving** (`handoff`). Both read your live session
transcript off disk — no pre-arming, no saved state, no setup.

## The chicken-and-egg insight

A Claude Code *skill* is executed **by** Claude. So if Claude is down, Claude
can't run a skill to resend your message — which makes a skill the wrong place
for this entirely. The recovery logic has to live **outside** the session, in a
process that survives the outage. That's what these two scripts are: plain CLIs
you run from your shell the moment you 529 out, not skills.

## `resend` — wait for Claude, then resume your session

Polls Claude with exponential backoff until it's reachable again, then drops you
back into your **exact** session with your last message resent — you keep working
where the outage cut you off.

```bash
npx tsx src/resend.ts          # newest session for this cwd → wait for Claude, then resume it
npx tsx src/resend.ts --print  # preview the message it would resend, then stop
npx tsx src/resend.ts <file.jsonl>   # resume the session for a specific transcript
```

Two phases:

1. **Health gate** — polls `claude -p` with exponential backoff (5s → 60s cap)
   until Claude is reachable again. This is the part that survives the outage.
2. **Resume** — once Claude is back, launches the **interactive** TUI on your
   exact session and resends your last message:
   `claude -r <session-id> "<last user message>"`. You land back in your real
   conversation, not a throwaway one-shot.

## `handoff` — bail to Codex instead of waiting

Don't want to wait it out? Hand the whole session to a different engine and keep
moving:

```bash
npx tsx src/handoff.ts          # newest session for this cwd → opens the interactive Codex TUI
npx tsx src/handoff.ts --print  # preview the exact prompt Codex will receive
```

It reads the current session's transcript from
`~/.claude/projects/<cwd>/<session>.jsonl`, flattens it to a `User:/Claude:`
dialogue (thinking dropped, tool calls summarized), stashes it to
`.claude-resend/handoff.txt`, and launches the **interactive** Codex TUI seeded
with a takeover prompt that points Codex at that file — so Codex reads the
context and you keep working in it.

Run either one straight from your shell the moment the session goes down — since
Claude can't run a skill mid-outage. `resend` waits for Claude and resumes;
`handoff` bails to Codex.

## How it works

| File | Role |
|------|------|
| `src/resend.ts`   | Reads the **live session transcript**, waits out the outage (backoff), then **resumes your actual session interactively** (`claude -r <id>`) with your last message resent. No saved state needed. |
| `src/handoff.ts`  | Stashes the **full session transcript** to disk and opens the interactive Codex TUI so Codex takes over when Claude is down. |
| `src/transcript.ts` | Finds the current session's JSONL transcript; flattens it to text and extracts the **last user message**. |
| `src/claude.ts`   | Runs `claude -p "<msg>"`; classifies the result as success / **outage** / error. |
| `src/watchdog.ts` | `resendUntilUp()` — polls Claude on outage with exponential backoff (5s → 60s cap). Non-outage errors stop immediately. |
| `src/types.ts`    | Shared `RunOutcome` / `ClaudeRunner` types. |

### What counts as "down"

529 overloaded, any 5xx, gateway timeouts, and network/spawn failures
(`ECONNREFUSED`, `ETIMEDOUT`, `socket hang up`, …). A normal error (bad usage,
auth) is **not** an outage — the watchdog stops rather than spinning forever.

## Config

`resendUntilUp(run, message, opts)` options: `maxAttempts` (0 = forever),
`baseDelayMs`, `maxDelayMs`, `onAttempt`, `sleep`.

## Build

```bash
npm install
npm run build   # tsc → dist/
```

After building, the two scripts are also exposed as bins (`claude-resend`,
`claude-handoff`).
