import { Activity, CheckCircle2, Database, GitCompare, ShieldCheck } from "lucide-react";
import { ScenarioComposer } from "@/components/ScenarioComposer";
import { ReplayWorkbench } from "@/components/ReplayWorkbench";
import { IntegrityWorkbench } from "@/components/IntegrityWorkbench";
import { StorageWorkbench } from "@/components/StorageWorkbench";
import { DiffWorkbench } from "@/components/DiffWorkbench";
import { listReplayFiles, readReplaySummary } from "@/lib/replay";
import Link from "next/link";

export const dynamic = "force-dynamic";

function formatTime(timestamp: string | null) {
  if (!timestamp) return "none";
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

type DashboardPageProps = {
  searchParams?: Promise<{
    replay?: string;
    view?: string;
  }>;
};

function eventRatePerMinute(firstTimestamp: string | null, lastTimestamp: string | null, total: number): string {
  if (!firstTimestamp || !lastTimestamp || total < 2) return "n/a";
  const first = new Date(firstTimestamp).getTime();
  const last = new Date(lastTimestamp).getTime();
  const minutes = Math.max((last - first) / 60000, 1 / 60);
  return `${(total / minutes).toFixed(1)}/min`;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const replayFiles = listReplayFiles();
  const selectedReplay = resolvedSearchParams?.replay;
  const view = resolvedSearchParams?.view || "timeline";
  const summary = readReplaySummary(selectedReplay);
  const totalEvents = summary.events.length;
  const integrityRate = totalEvents === 0 ? 0 : Math.round((summary.validChecksums / totalEvents) * 100);
  const navItems = [
    { key: "timeline", title: "Replay timeline", icon: Activity, enabled: true, active: view === "timeline" },
    { key: "integrity", title: "Integrity checks", icon: ShieldCheck, enabled: true, active: view === "integrity" },
    { key: "storage", title: "Storage manager", icon: Database, enabled: true, active: view === "storage" },
    { key: "diffs", title: "Replay diffs", icon: GitCompare, enabled: true, active: view === "diffs" },
  ];

  return (
    <main className="dashboard-shell">
      <aside className="rail">
        <div className="mark">S</div>
        {navItems.map((item) => {
          const Icon = item.icon;
          if (!item.enabled) {
            return (
              <button
                key={item.key}
                className="rail-button disabled"
                title={item.title}
                disabled
                aria-disabled
              >
                <Icon size={18} />
              </button>
            );
          }

          return (
            <Link
              key={item.key}
              href={`?view=${item.key}${selectedReplay ? `&replay=${selectedReplay}` : ""}`}
              className={`rail-button ${item.active ? "active" : ""}`}
              title={item.title}
            >
              <Icon size={18} />
            </Link>
          );
        })}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Syntha - Synthetic Internet</p>
            <h1>Replay Control</h1>
          </div>
          <div className="status-pill"><CheckCircle2 size={16} /> replay mode</div>
        </header>

        <section className="metric-grid" aria-label="Replay metrics">
          <div className="metric">
            <span>events</span>
            <strong>{totalEvents}</strong>
          </div>
          <div className="metric">
            <span>integrity</span>
            <strong>{integrityRate}%</strong>
          </div>
          <div className="metric">
            <span>run</span>
            <strong>{summary.runId}</strong>
          </div>
          <div className="metric">
            <span>latest</span>
            <strong>{formatTime(summary.lastTimestamp)}</strong>
          </div>
          <div className="metric">
            <span>velocity</span>
            <strong>{eventRatePerMinute(summary.firstTimestamp, summary.lastTimestamp, totalEvents)}</strong>
          </div>
        </section>

        <section className="main-grid">
          {view === "integrity" ? (
            <IntegrityWorkbench summary={summary} replayFiles={replayFiles} />
          ) : view === "storage" ? (
            <StorageWorkbench />
          ) : view === "diffs" ? (
            <DiffWorkbench replayFiles={replayFiles} />
          ) : (
            <>
              <ReplayWorkbench summary={summary} replayFiles={replayFiles} />
              <ScenarioComposer />
            </>
          )}
        </section>

        <section className="lower-grid">
          <section className="kind-band" aria-label="Event kind distribution">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Distribution</p>
                <h2>Event Kinds</h2>
              </div>
            </div>
            <div className="kind-list">
              {summary.eventKinds.map((item) => (
                <div className="kind-row" key={item.kind}>
                  <span>{item.kind}</span>
                  <meter min="0" max={totalEvents || 1} value={item.count} />
                  <strong>{item.count}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="integrity-panel" aria-label="Integrity checks">
            <p className="eyebrow">Checksums</p>
            <h2>{summary.invalidChecksums === 0 ? "Clean Chain" : "Attention Needed"}</h2>
            <p>{summary.validChecksums} valid, {summary.invalidChecksums} invalid across {totalEvents} events.</p>
            <div className="time-window">
              <span>{formatTime(summary.firstTimestamp)}</span>
              <span>{formatTime(summary.lastTimestamp)}</span>
            </div>
            <p className="integrity-note">
              Active replay: <strong>{summary.replayFile}</strong>
            </p>
          </section>
        </section>
      </section>
    </main>
  );
}
