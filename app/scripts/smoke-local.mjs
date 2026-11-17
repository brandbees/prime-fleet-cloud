const base = process.env.PANEL_URL || "http://127.0.0.1:3000";

async function main() {
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@primefleet.local",
      password: "admin12345",
    }),
  });
  const cookie = loginRes.headers.getSetCookie?.()?.join("; ") || loginRes.headers.get("set-cookie") || "";
  if (!loginRes.ok) {
    throw new Error(`login failed ${loginRes.status} ${await loginRes.text()}`);
  }

  const createRes = await fetch(`${base}/api/licenses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      label: "Local Sletci test",
      siteUrl: "http://sletci.test",
      plan: "trial",
      notes: "local smoke",
    }),
  });
  const created = await createRes.json();
  if (!createRes.ok) throw new Error(`create failed ${JSON.stringify(created)}`);
  const key = created.license.key;
  console.log("LICENSE_KEY=" + key);

  const valRes = await fetch(`${base}/api/v1/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ license_key: key, site_url: "http://sletci.test" }),
  });
  const val = await valRes.json();
  console.log("VALIDATE=" + JSON.stringify(val));

  const healthRes = await fetch(`${base}/api/auth/login`, { method: "GET" }).catch(() => null);
  void healthRes;

  const waRes = await fetch("http://127.0.0.1:2785/api/health").catch((e) => ({ ok: false, error: e.message }));
  if (waRes && typeof waRes.json === "function") {
    console.log("OPENWA_HEALTH_HTTP=" + waRes.status);
    console.log("OPENWA_HEALTH=" + JSON.stringify(await waRes.json().catch(() => ({}))));
  } else {
    console.log("OPENWA_HEALTH=unreachable");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
