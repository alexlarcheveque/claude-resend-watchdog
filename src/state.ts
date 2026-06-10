import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface SavedMessage {
  message: string;
  savedAt: string;
}

/** Persist the last message so the watchdog can resend it even if the session dies. */
export function saveMessage(path: string, message: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const payload: SavedMessage = { message, savedAt: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
}

export function loadMessage(path: string): SavedMessage | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as SavedMessage;
}
