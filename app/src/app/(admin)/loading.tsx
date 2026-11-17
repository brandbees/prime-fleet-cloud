import { PanelLoader } from "@/components/Loader";

export default function AdminLoading() {
  return (
    <div className="card">
      <PanelLoader label="Loading panel…" />
    </div>
  );
}
