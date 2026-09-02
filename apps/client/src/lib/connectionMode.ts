/**
 * Which transport the current room session should use.
 * Selected on the home screen ("Choose connection") and persisted for the
 * browser session so the room page knows how to connect.
 */
export type ConnectionMode = "internet" | "lan";

const STORAGE_KEY = "pearplay-connection-mode";

export function setConnectionMode(mode: ConnectionMode): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Storage may be unavailable (private browsing); fall back to internet mode.
  }
}

export function getConnectionMode(): ConnectionMode {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "lan" ? "lan" : "internet";
  } catch {
    return "internet";
  }
}
