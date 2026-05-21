"use client";

import { useEffect, useMemo, useState } from "react";
import { GitCompare, Play, PlusCircle, MinusCircle, Split } from "lucide-react";

type DiffMode = "execution" | "trace" | "branch";

type DiffSummary = {
  base_file: string;
  target_file: string;
  mode: DiffMode;
  same: number;
  changed: number;
  added: number;
  removed: number;
  base_run_id: string;
  target_run_id: string;
  base_event_kinds: Record<string, number>;
  target_event_kinds: Record<string, number>;
  generated_at: string;
};

type DiffChange = {
  type: "same" | "changed" | "added" | "removed";
  key: string;
  base_sequence?: string;
  target_sequence?: string;
  base_kind?: string;
  target_kind?: string;
  base_id?: string;
  target_id?: string;
  reason?: string;
};

type DiffReport = {
  summary: DiffSummary;
  changes: DiffChange[];
};

type DiffWorkbenchProps = {
  replayFiles: string[];
};

function changeIcon(type: DiffChange["type"]) {
  if (type === "added") return <PlusCircle size={16} className="ok" />;
  if (type === "removed") return <MinusCircle size={16} className="danger" />;
  return <Split size={16} className="danger" />;
}

export function DiffWorkbench({ replayFiles }: DiffWorkbenchProps) {
  const defaultBase = replayFiles[0] ?? "";
  const defaultTarget = replayFiles.find((file) => file !== defaultBase) ?? "";
  const [base, setBase] = useState(defaultBase);
  const [target, setTarget] = useState(defaultTarget);
  const [mode, setMode] = useState<DiffMode>("execution");
  const [report, setReport] = useState<DiffReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const totalChanged = useMemo(() => {
    if (!report) return 0;
    return report.summary.changed + report.summary.added + report.summary.removed;
  }, [report]);
  const changes = report?.changes ?? [];

  async function runDiff() {
    if (!base || !target || base === target) {
      setError("Choose two different replay files.");
      setReport(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ base, target, mode, limit: "250" });
      const response = await fetch(`/api/diffs?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as DiffReport | { error?: { message?: string } };
      if (!response.ok) {
        const message = "error" in payload ? payload.error?.message : undefined;
        throw new Error(message ?? `diff failed (${response.status})`);
      }
      setReport(payload as DiffReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : "diff request failed");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (defaultBase && defaultTarget) {
      void runDiff();
    }
  }, []);

  return (
    <>
      <section className="timeline" aria-label="Replay diff controls">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Replay Diff</p>
            <h2>Compare Runs</h2>
          </div>
          <GitCompare size={20} />
        </div>
        <div className="toolbar">
          <label className="control">
            <span>Base</span>
            <select value={base} onChange={(event) => setBase(event.target.value)}>
              {replayFiles.map((file) => (
                <option value={file} key={file}>
                  {file}
                </option>
              ))}
            </select>
          </label>
          <label className="control">
            <span>Target</span>
            <select value={target} onChange={(event) => setTarget(event.target.value)}>
              {replayFiles.map((file) => (
                <option value={file} key={file}>
                  {file}
                </option>
              ))}
            </select>
          </label>
          <label className="control">
            <span>Mode</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as DiffMode)}>
              <option value="execution">execution</option>
              <option value="trace">trace</option>
              <option value="branch">branch</option>
            </select>
          </label>
          <button className="action-button" type="button" onClick={() => void runDiff()} disabled={loading}>
            <Play size={15} /> Compare
          </button>
        </div>
        {error ? <div className="empty danger">{error}</div> : null}
        {report ? (
          <div className="diff-summary-grid">
            <div><span>same</span><strong>{report.summary.same}</strong></div>
            <div><span>changed</span><strong>{report.summary.changed}</strong></div>
            <div><span>added</span><strong>{report.summary.added}</strong></div>
            <div><span>removed</span><strong>{report.summary.removed}</strong></div>
          </div>
        ) : (
          <div className="empty">Select two replay files to compare.</div>
        )}
      </section>

      <section className="detail-panel wide-detail" aria-label="Replay diff results">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Execution Changes</p>
            <h2>{report ? `${totalChanged} differences` : "No Diff Loaded"}</h2>
          </div>
          <GitCompare size={20} />
        </div>
        {report ? (
          <>
            <div className="detail-meta">
              <div><span>base run</span><strong>{report.summary.base_run_id}</strong></div>
              <div><span>target run</span><strong>{report.summary.target_run_id}</strong></div>
              <div><span>mode</span><strong>{report.summary.mode}</strong></div>
            </div>
            <div className="event-stream diff-stream">
              {changes.length === 0 ? (
                <div className="empty">No changes detected for this comparison.</div>
              ) : (
                changes.map((change) => (
                  <div className={`event-row diff-row ${change.type}`} key={`${change.type}-${change.key}`}>
                    <div className="event-sequence">{change.target_sequence ?? change.base_sequence ?? "-"}</div>
                    <div>
                      <h3>{change.target_kind ?? change.base_kind ?? change.key}</h3>
                      <p>{change.reason ?? change.type}</p>
                    </div>
                    <div className="checksum">{changeIcon(change.type)} {change.type}</div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <p className="empty">Run a comparison to see branch, trace, and execution differences.</p>
        )}
      </section>

      <section className="scenario-panel" aria-label="Replay kind comparison">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Kind Drift</p>
            <h2>Distribution</h2>
          </div>
          <Split size={20} />
        </div>
        {report ? (
          <div className="kind-list">
            {Object.entries({ ...report.summary.base_event_kinds, ...report.summary.target_event_kinds })
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([kind]) => {
                const baseCount = report.summary.base_event_kinds[kind] ?? 0;
                const targetCount = report.summary.target_event_kinds[kind] ?? 0;
                return (
                  <div className="kind-row diff-kind-row" key={kind}>
                    <span>{kind}</span>
                    <meter min="0" max={Math.max(baseCount, targetCount, 1)} value={targetCount} />
                    <strong>{baseCount} / {targetCount}</strong>
                  </div>
                );
              })}
          </div>
        ) : (
          <p className="empty">Kind counts appear after a diff run.</p>
        )}
      </section>
    </>
  );
}
