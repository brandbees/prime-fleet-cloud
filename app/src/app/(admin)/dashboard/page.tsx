import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { health, sessionStatus } from "@/lib/openwa";
import { openwaSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function shortDay(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

export default async function DashboardPage() {
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - 6);
  since.setHours(0, 0, 0, 0);

  const [licenses, active, logsTotal, recentLogs, weekLogs] = await Promise.all([
    prisma.license.count(),
    prisma.license.count({ where: { active: true } }),
    prisma.messageLog.count(),
    prisma.messageLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { license: { select: { label: true } } },
    }),
    prisma.messageLog.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, status: true },
    }),
  ]);

  const sentWeek = weekLogs.filter((l) => l.status === "sent").length;
  const failedWeek = weekLogs.filter((l) => l.status !== "sent").length;

  const series: { key: string; sent: number; failed: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(12, 0, 0, 0);
    series.push({ key: dayKey(d), sent: 0, failed: 0 });
  }
  const map = Object.fromEntries(series.map((s) => [s.key, s]));
  for (const row of weekLogs) {
    const k = dayKey(row.createdAt);
    if (!map[k]) continue;
    if (row.status === "sent") map[k].sent += 1;
    else map[k].failed += 1;
  }
  const maxBar = Math.max(1, ...series.map((s) => s.sent + s.failed));

  const cfg = await openwaSettings();
  let waLabel = "unknown";
  let waOk = false;
  try {
    const h = await health();
    waOk = h.ok;
    const linked = await prisma.license.count({
      where: { active: true, openwaSessionId: { not: "" } },
    });
    // Prefer license-bound sessions (product path). .env OPENWA_SESSION_ID is optional legacy.
    if (h.ok && linked > 0) {
      waLabel = `Online · ${linked} license session${linked === 1 ? "" : "s"}`;
    } else if (h.ok) {
      const s = await sessionStatus();
      waLabel =
        s.status && s.status !== "unconfigured"
          ? `Online · env session ${s.status}`
          : "Online · no phone linked yet (QR from WP Settings)";
    } else {
      waLabel = `Health HTTP ${h.http}`;
    }
  } catch {
    waOk = false;
    waLabel = "Unreachable";
  }

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Dashboard</h1>
        <p className="muted">License usage and WhatsApp send health at a glance.</p>
      </div>

      <div className="grid grid-4">
        <div className="card stat">
          <div className="stat__label">Active licenses</div>
          <div className="stat__value">{active}</div>
          <div className="stat__hint">{licenses} total issued</div>
        </div>
        <div className="card stat">
          <div className="stat__label">Sends (7 days)</div>
          <div className="stat__value">{sentWeek}</div>
          <div className="stat__hint">{failedWeek} failed</div>
        </div>
        <div className="card stat">
          <div className="stat__label">All-time sends</div>
          <div className="stat__value">{logsTotal}</div>
          <div className="stat__hint">Logged via cloud API</div>
        </div>
        <div className="card stat">
          <div className="stat__label">OpenWA</div>
          <div className="stat__value" style={{ fontSize: "1.35rem" }}>
            <span className={`badge ${waOk ? "ok" : "off"}`}>{waOk ? "Up" : "Down"}</span>
          </div>
          <div className="stat__hint">{waLabel}</div>
        </div>
      </div>

      <div className="panel-split">
        <div className="card">
          <div className="actions" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Sends · last 7 days</h2>
            <div className="actions">
              <span className="badge ok">sent</span>
              <span className="badge off">failed</span>
            </div>
          </div>
          <div className="chart" aria-label="Weekly send chart">
            {series.map((s) => (
              <div key={s.key} className="chart__col">
                <div className="chart__bars">
                  <div
                    className="chart__bar sent"
                    style={{ height: `${Math.max(4, (s.sent / maxBar) * 100)}%` }}
                    title={`${s.sent} sent`}
                  />
                  <div
                    className="chart__bar failed"
                    style={{ height: `${Math.max(s.failed ? 4 : 0, (s.failed / maxBar) * 100)}%` }}
                    title={`${s.failed} failed`}
                  />
                </div>
                <div className="chart__label">{shortDay(s.key)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card stack">
          <h2 style={{ margin: 0 }}>Gateway</h2>
          <div>
            <div className="muted">Base URL</div>
            <div className="mono">{cfg.baseUrl}</div>
          </div>
          <div>
            <div className="muted">Session</div>
            <div className="mono">{cfg.sessionId || "Per-license sessions (WP QR)"}</div>
          </div>
          <div className="actions">
            <Link className="btn btn-primary" href="/whatsapp">
              WhatsApp status
            </Link>
            <Link className="btn" href="/licenses">
              New license
            </Link>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="actions" style={{ justifyContent: "space-between", marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>Recent activity</h2>
          <Link className="btn" href="/logs">
            View all
          </Link>
        </div>
        {!recentLogs.length ? <p className="muted">No sends yet — create a license and hit the cloud API.</p> : null}
        {recentLogs.map((l) => (
          <div key={l.id} className="list-row">
            <div>
              <strong>{l.license?.label || "Unknown license"}</strong>
              <div className="muted">
                {l.to} · {l.preview.slice(0, 80)}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <span className={`badge ${l.status === "sent" ? "ok" : "off"}`}>{l.status}</span>
              <div className="muted">{new Date(l.createdAt).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
