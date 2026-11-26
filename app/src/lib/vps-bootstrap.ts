/**
 * Shared-VPS OpenWA bootstrap (SSH).
 * Runs scripts/vps/bootstrap-openwa.sh remotely — idempotent when healthy.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "./env";
import { setSetting } from "./settings";

const execFileAsync = promisify(execFile);

export type SharedOpenWaReady = {
  ip: string;
  baseUrl: string;
  apiKey: string;
  alreadyRunning: boolean;
};

function vpsHost() {
  return (process.env.WA_VPS_HOST || "").trim();
}

function vpsUser() {
  return (process.env.WA_VPS_USER || "admin").trim();
}

function publicBaseUrl(ip: string) {
  const fromEnv = (process.env.WA_OPENWA_PUBLIC_URL || "").trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const port = (process.env.OPENWA_PORT || "2785").trim();
  return `http://${ip}:${port}`;
}

function remoteBootstrapPath() {
  return (
    process.env.WA_BOOTSTRAP_REMOTE || "/home/admin/scripts/vps/bootstrap-openwa.sh"
  ).trim();
}

function parseBootstrapOut(stdout: string) {
  const apiKey = (stdout.match(/^OPENWA_API_KEY=(.+)$/m)?.[1] || "").trim();
  const localBase = (stdout.match(/^OPENWA_BASE_URL=(.+)$/m)?.[1] || "").trim();
  const alreadyRunning = /already running/i.test(stdout);
  return { apiKey, localBase, alreadyRunning };
}

async function ssh(remoteCmd: string, timeoutMs = 180_000) {
  const host = vpsHost();
  const user = vpsUser();
  if (!host) throw new Error("WA_VPS_HOST is not set");

  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=25",
    "-o",
    "StrictHostKeyChecking=accept-new",
    `${user}@${host}`,
    remoteCmd,
  ];
  const key = (process.env.WA_VPS_SSH_KEY || "").trim();
  if (key) args.unshift("-i", key);

  const { stdout, stderr } = await execFileAsync("ssh", args, {
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  return { stdout: String(stdout || ""), stderr: String(stderr || "") };
}

/** Ensure OpenWA is up on the shared VPS; persist panel gateway settings. */
export async function ensureSharedOpenWa(): Promise<SharedOpenWaReady> {
  const host = vpsHost();
  if (!host) throw new Error("WA_VPS_HOST is not set — cannot bootstrap shared OpenWA");

  const remote = remoteBootstrapPath();
  const { stdout, stderr } = await ssh(`bash ${JSON.stringify(remote)}`, 180_000);
  const combined = `${stdout}\n${stderr}`;
  const parsed = parseBootstrapOut(combined);
  if (!parsed.apiKey) {
    throw new Error(
      `Bootstrap did not return OPENWA_API_KEY. Output: ${combined.slice(-800)}`
    );
  }

  const baseUrl = publicBaseUrl(host);
  await setSetting("openwa_base_url", baseUrl);
  await setSetting("openwa_api_key", parsed.apiKey);

  return {
    ip: host,
    baseUrl,
    apiKey: parsed.apiKey,
    alreadyRunning: parsed.alreadyRunning,
  };
}

export function sharedVpsConfigured() {
  return Boolean(vpsHost());
}

/** Health probe against the public OpenWA URL (no SSH). */
export async function probeSharedOpenWa(baseUrl?: string, apiKey?: string) {
  const url = (baseUrl || publicBaseUrl(vpsHost() || "127.0.0.1")).replace(/\/$/, "");
  const res = await fetch(`${url}/api/health`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const text = await res.text();
  return { ok: res.ok, http: res.status, body: text.slice(0, 200), apiKeyHint: Boolean(apiKey) };
}

export function sharedEnvSummary() {
  return {
    host: vpsHost() || null,
    user: vpsUser(),
    publicUrl: vpsHost() ? publicBaseUrl(vpsHost()) : null,
    remoteScript: remoteBootstrapPath(),
    provider: env("WA_PROVIDER", "mock"),
  };
}
