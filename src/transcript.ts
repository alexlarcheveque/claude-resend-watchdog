import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Claude Code stores each session as a JSONL transcript under
 *   ~/.claude/projects/<cwd-with-slashes-as-dashes>/<session-id>.jsonl
 * This module finds that file and flattens it into plain text we can hand to
 * another agent (Codex) so it can pick up where Claude left off.
 */

function projectDir(cwd: string): string {
  const enc = cwd.replace(/\//g, "-");
  return join(homedir(), ".claude", "projects", enc);
}

/** Newest transcript file for `cwd` = the session you're most likely in. */
export function findLatestTranscript(cwd: string): string | null {
  const dir = projectDir(cwd);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}

/** Pull the readable text out of one message's `content` (string or block array). */
function textFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text.trim());
    } else if (block.type === "tool_use" && typeof block.name === "string") {
      parts.push(`[ran tool: ${block.name}]`);
    } else if (block.type === "tool_result") {
      const t = textFromContent(block.content);
      parts.push(`[tool result: ${t.slice(0, 300)}${t.length > 300 ? "…" : ""}]`);
    }
    // thinking blocks are intentionally dropped.
  }
  return parts.filter(Boolean).join("\n").trim();
}

/** Text a human actually typed: string content, or `text` blocks only. */
function userText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text.trim());
    }
    // tool_result / tool_use / thinking are NOT user input — skip them.
  }
  return parts.filter(Boolean).join("\n").trim();
}

/**
 * The last GENUINE user message in a transcript — the request Claude was
 * answering when it went down. Tool-result and empty turns are skipped; we
 * only want something a human typed, so it's safe to resend via `claude -p`.
 */
export function lastUserMessage(path: string): string | null {
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(lines[i]!);
    } catch {
      continue;
    }
    if (row.type !== "user") continue;
    const msg = row.message as Record<string, unknown> | undefined;
    if (!msg) continue;
    const text = userText(msg.content);
    if (text) return text;
  }
  return null;
}

/**
 * Flatten a transcript JSONL into a "User:/Claude:" dialogue string.
 * Thinking is stripped; tool calls/results are summarized so the narrative
 * survives without the noise.
 */
export function flattenTranscript(path: string): string {
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const turns: string[] = [];

  for (const line of lines) {
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.type !== "user" && row.type !== "assistant") continue;
    const msg = row.message as Record<string, unknown> | undefined;
    if (!msg) continue;

    const text = textFromContent(msg.content);
    if (!text) continue;
    turns.push(`${row.type === "user" ? "User" : "Claude"}: ${text}`);
  }

  return turns.join("\n\n");
}
