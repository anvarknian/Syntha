import { Activity, CheckCircle2, Database, GitCompare, ShieldCheck, TerminalSquare } from "lucide-react";
import { ScenarioComposer } from "@/components/ScenarioComposer";
import { readReplaySummary } from "@/lib/replay";

export const dynamic = "force-dynamic";

function formatTime(timestamp: string | null) {
  if (!timestamp) return "none";
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    month: "short",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export default function DashboardPage() {
  const summary = readReplaySummary();
  const totalEvents = summary.events.length;
  const integrityRate = totalEvents === 0 ? 0 : Math.round((summary.validChecksums / totalEvents) * 100);
  const latestEvents = summary.events.slice(-8).reverse();

  return (
    <main className="dashboard-shell">
      <aside className="rail">
        <div className="mark">S</div>
        <button className="rail-button active" title="Replay timeline"><Activity size={18} /></button>
        <button className="rail-button" title="Integrity checks"><ShieldCheck size={18} /></button>
        <button className="rail-button" title="Storage"><Database size={18} /></button>
        <button className="rail-button" title="Diffs"><GitCompare size={18} /></button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Syntha - Synthetic Internet</p>
            <h1>Replay Control</h1>
          </div>
          <div className="status-pill"><CheckCircle2 size={16} /> phase 4 active</div>
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
        </section>

        <section className="main-grid">
          <section className="timeline" aria-label="Replay timeline">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">{summary.replayFile}</p>
                <h2>Timeline</h2>
              </div>
              <TerminalSquare size={20} />
            </div>
            <div className="event-stream">
              {latestEvents.map((event) => (
                <article className="event-row" key={`${event.id}-${event.sequence}`}>
                  <div className="event-sequence">{event.sequence ?? "-"}</div>
                  <div>
                    <h3>{event.kind}</h3>
                    <p>{event.id}</p>
                  </div>
                  <div className={event.checksum ? "checksum ok" : "checksum bad"}>
                    {event.checksum ? "verified" : "missing"}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <ScenarioComposer />
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
          </section>
        </section>
      </section>
    </main>
  );
}
