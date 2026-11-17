export function Loader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loader" role="status" aria-live="polite">
      <span className="loader__spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function PanelLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="panel-loading" role="status" aria-live="polite">
      <span className="loader__spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
