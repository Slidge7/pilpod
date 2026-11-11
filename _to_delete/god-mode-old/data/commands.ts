import { invoke } from "@tauri-apps/api/core";

/** Ask every connected browser to resend its tabs. */
export function syncBrowsers(): Promise<void> {
  return invoke<void>("request_browser_sync");
}

/** A thrown value as text a person can read. */
export function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
