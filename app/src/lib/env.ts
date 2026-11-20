export function env(name: string, fallback = "") {
  const v = process.env[name];
  return v === undefined || v === null || v === "" ? fallback : v;
}

/** Sync .env-only fallback. Prefer `openwaSettings()` from `@/lib/settings` (panel DB). */
export function openwaConfig() {
  return {
    baseUrl: env("OPENWA_BASE_URL", "http://127.0.0.1:2785").replace(/\/$/, "").replace(/\/api$/i, ""),
    apiKey: env("OPENWA_API_KEY"),
    sessionId: env("OPENWA_SESSION_ID"),
  };
}
