"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PanelLoader } from "@/components/Loader";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: "grid" },
  { href: "/licenses", label: "Licenses", icon: "key" },
  { href: "/whatsapp", label: "WhatsApp", icon: "wa" },
  { href: "/billing", label: "Billing", icon: "card" },
  { href: "/logs", label: "Send logs", icon: "list" },
];

function Icon({ name }: { name: string }) {
  const common = {
    className: "sidebar__icon",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "grid") {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    );
  }
  if (name === "key") {
    return (
      <svg {...common}>
        <circle cx="8" cy="12" r="3.5" />
        <path d="M11 12h10v3M17 12v3" />
      </svg>
    );
  }
  if (name === "wa") {
    /* Filled mark (not stroke) — keep SSR/client markup identical to avoid hydration mismatch */
    return (
      <svg
        className="sidebar__icon sidebar__icon--wa"
        viewBox="0 0 24 24"
        aria-hidden={true}
        fill="currentColor"
        focusable={false}
      >
        <path d="M12.04 2.82c-4.98 0-9.02 4.04-9.02 9.02 0 1.59.42 3.14 1.21 4.5L3.2 20.9l4.72-1.24a9 9 0 004.12.99h.01c4.98 0 9.02-4.04 9.02-9.02 0-2.41-.94-4.67-2.64-6.37a9 9 0 00-6.39-2.44zm0 16.42h0a7.48 7.48 0 01-3.81-1.04l-.27-.16-2.84.74.76-2.77-.18-.29a7.46 7.46 0 01-1.14-3.98c0-4.12 3.36-7.48 7.49-7.48 2 0 3.88.78 5.3 2.19a7.45 7.45 0 012.19 5.29c0 4.13-3.36 7.5-7.5 7.5zm4.1-5.6c-.22-.11-1.33-.66-1.54-.73-.21-.08-.36-.11-.5.11-.15.22-.57.73-.7.88-.13.15-.26.16-.49.05-.22-.11-.96-.35-1.82-1.12-.67-.6-1.13-1.34-1.26-1.57-.13-.22-.01-.35.1-.46.1-.1.22-.26.34-.39.11-.13.15-.22.22-.37.08-.15.04-.28-.02-.39-.06-.11-.5-1.21-.69-1.66-.18-.44-.37-.38-.5-.38h-.43c-.15 0-.39.05-.59.28-.2.22-.78.76-.78 1.87s.8 2.17.91 2.32c.11.15 1.58 2.41 3.82 3.38.53.23.95.37 1.28.47.54.17 1.02.15 1.41.09.43-.06 1.33-.54 1.52-1.07.19-.53.19-.98.13-1.07-.05-.09-.2-.15-.43-.26z" />
      </svg>
    );
  }
  if (name === "card") {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M3 10h18" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M5 6h14M5 12h14M5 18h10" />
    </svg>
  );
}

function titleFor(path: string) {
  const hit = links.find((l) => path === l.href || path.startsWith(l.href + "/"));
  return hit?.label || "Console";
}

export function Shell({
  children,
  email = "admin",
}: {
  children: React.ReactNode;
  email?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const initial = (email || "A").trim().charAt(0).toUpperCase();
  const activePath = pendingHref || pathname;
  const navigating = Boolean(pendingHref && pendingHref !== pathname);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="sidebar__brand-mark" title="Prime Fleet Cloud">
            Prime Fleet Cloud
          </div>
          <div className="sidebar__brand-sub">Ops console</div>
        </div>
        <nav className="sidebar__nav" aria-label="Main">
          {links.map((l) => {
            const active = activePath === l.href || activePath.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                prefetch
                className={`sidebar__link${active ? " is-active" : ""}`}
                onClick={() => {
                  if (l.href !== pathname) setPendingHref(l.href);
                }}
              >
                <Icon name={l.icon} />
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar__foot">Local / VPS gateway control</div>
      </aside>

      <div className="main-col">
        <header className="top-header">
          <div>
            <div className="top-header__title">{titleFor(activePath)}</div>
            <div className="top-header__meta">Manage licenses, WhatsApp gateway, and send health</div>
          </div>
          <div className="top-header__right">
            <div className="user-chip" title={email}>
              <span className="user-chip__avatar">{initial}</span>
              <span>{email}</span>
            </div>
            <button type="button" className="btn" onClick={logout}>
              Log out
            </button>
          </div>
        </header>
        <main className="main-body">
          {navigating ? (
            <div className="card route-loading" aria-busy="true">
              <PanelLoader label="Loading panel…" />
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
