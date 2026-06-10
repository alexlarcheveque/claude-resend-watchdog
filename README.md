# claude-resend-watchdog

Auto-resend your **last message** to the Claude Code CLI when Claude goes down.

Claude has outages (529 overloaded, 5xx, network blips). This is an external
watchdog: it sends your message through `claude -p`, detects when Claude is
down, and **resends the exact same message** with exponential backoff until it
gets through.

## The chicken-and-egg insight

A Claude Code *skill* is executed **by** Claude. So if Claude is down, Claude
can't run a skill to resend your message — which makes a skill the wrong place
for this entirely. The retry logic has to live **outside** the session in a
process that survives the outage. That's what this watchdog is: a plain CLI you
run from your shell (see [`src/resend.ts`](#resend-the-live-session-no-pre-arming--srcresendts)),
not a skill.

## Quick start

```bash
npm install
npm run demo      # runnable example — simulates Claude down for 3 attempts, then up
```

### Demo output (no real outage needed)

```
📨 You sent: "Summarize my last git commit in one sentence."
🔻 Simulating Claude being DOWN for 3 attempts, then recovering…

  attempt 1 → Claude is down (API Error: 529 overloaded_error). Resending the same message in 200ms…
  attempt 2 → Claude is down (API Error: 529 overloaded_error). Resending the same message in 400ms…
  attempt 3 → Claude is down (API Error: 529 overloaded_error). Resending the same message in 800ms…
  attempt 4 → Claude is back up! ✅

🎉 Auto-resend succeeded:
   Claude's reply to: "Summarize my last git commit in one sentence."
```

## Real usage (drives the actual `claude` CLI)

```bash
# Send + auto-resend if Claude is down. Also saves the message.
npx tsx src/cli.ts send "Summarize my last git commit in one sentence."

# Claude went down before? Resend whatever you last saved:
npx tsx src/cli.ts resend

# Print the last saved message:
npx tsx src/cli.ts last
```

Run it detached so it survives an outage even if your terminal closes:

```bash
nohup npx tsx src/cli.ts resend > .claude-resend/watchdog.log 2>&1 &
```

## Resend the live session (no pre-arming) — `src/resend.ts`

`send`/`resend` above only work if you routed your message *through the CLI*
(they read a saved state file). But in a real Claude Code session you're in the
TUI, and when Claude 529s mid-task there's nothing saved — and a skill can't run
to save it, because Claude is down. This script solves that the same way
`handoff.ts` does: it reads the **live session transcript** off disk, with no
state file and no pre-armed skill required. It runs in two phases:

1. **Health gate** — polls `claude -p` with exponential backoff until Claude is
   reachable again. This is the part that survives the outage.
2. **Resume** — once Claude is back, it launches the **interactive** TUI on your
   exact session and resends your last message:
   `claude -r <session-id> "<last user message>"`. You land back in your real
   conversation and keep working — it does **not** open a throwaway one-shot.

```bash
npx tsx src/resend.ts          # newest session for this cwd → wait for Claude, then resume it
npx tsx src/resend.ts --print  # preview the message it would resend, then stop
npx tsx src/resend.ts <file.jsonl>   # resume the session for a specific transcript
```

Run it straight from your shell the moment the session goes down — since Claude
can't run a skill mid-outage. It's the Claude-side twin of `handoff.ts`:
`handoff.ts` bails to Codex, `resend.ts` waits for Claude and resumes your session.

## Bail to Codex instead of waiting (manual)

`src/resend.ts` waits for Claude to recover. Sometimes you'd rather not - hand
the whole session to a different engine and keep moving:

```bash
npx tsx src/handoff.ts          # newest session for this cwd → opens the interactive Codex TUI
npx tsx src/handoff.ts --print  # preview the exact prompt Codex will receive
```

It reads the current session's transcript from
`~/.claude/projects/<cwd>/<session>.jsonl`, flattens it to a `User:/Claude:`
dialogue (thinking dropped, tool calls summarized), stashes it to
`.claude-resend/handoff.txt`, and launches the **interactive** Codex TUI seeded
with a takeover prompt that points Codex at that file — so Codex reads the
context and you keep working in it. Run it straight from your shell — since
Claude can't run a skill mid-outage.

## How it works

| File | Role |
|------|------|
| `src/claude.ts`   | Runs `claude -p "<msg>"`; classifies result as success / **outage** / error. |
| `src/watchdog.ts` | `resendUntilUp()` — resends the same message on outage with exponential backoff (5s → 60s cap). Non-outage errors stop immediately. |
| `src/state.ts`    | Persists the last message to `.claude-resend/last-message.json`. |
| `src/cli.ts`      | `send` / `resend` / `last` commands. |
| `src/transcript.ts` | Finds the current session's JSONL transcript; flattens it to text and extracts the **last user message**. |
| `src/resend.ts`   | Reads the **live session transcript**, waits out the outage (backoff), then **resumes your actual session interactively** (`claude -r <id>`) with your last message resent. No saved state needed. |
| `src/handoff.ts`  | Stashes the **full session transcript** to disk and opens the interactive Codex TUI so Codex takes over when Claude is down. |
| `example/demo.ts` | The runnable working example above (uses an injected fake Claude). |
| `example/interactive.ts` | Interactive demo — flip Claude up/down from the keyboard and watch the real watchdog react. |

### What counts as "down"

529 overloaded, any 5xx, gateway timeouts, and network/spawn failures
(`ECONNREFUSED`, `ETIMEDOUT`, `socket hang up`, …). A normal error (bad usage,
auth) is **not** an outage — the watchdog stops rather than spinning forever.

## Config

- `CLAUDE_RESEND_STATE` — override the state file path.
- `resendUntilUp(run, message, opts)` options: `maxAttempts` (0 = forever),
  `baseDelayMs`, `maxDelayMs`, `onAttempt`, `sleep`.

## Build

```bash
npm run build && node dist/cli.js send "hello"
```
