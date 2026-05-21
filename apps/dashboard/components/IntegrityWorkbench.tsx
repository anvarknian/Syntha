"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, ShieldAlert, Search, Filter } from "lucide-react";
import type { ReplaySummary, ReplayEvent } from "@/lib/replay";

type IntegrityWorkbenchProps = {
  summary: ReplaySummary;
  replayFiles: string[];
};

type BackendIntegrityReport = {
  status: string;
  issues: string[];
  summary: {
    event_count: number;
    valid_checksums: number;
    invalid_checksums: number;
    run_id: string;
  };
};

function formatTime(timestamp: string | null): string {
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

function normalizedJSON(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function IntegrityWorkbench({ summary, replayFiles }: IntegrityWorkbenchProps) {
  const [kindFilter, setKindFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(summary.events.at(-1)?.id ?? null);
  const [backendReport, setBackendReport] = useState<BackendIntegrityReport | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);

  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return summary.events.at(-1) ?? null;
    return summary.events.find((event) => event.id === selectedEventId) ?? null;
  }, [selectedEventId, summary.events]);

  const filteredEvents = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return summary.events
      .filter((event) => {
        if (kindFilter !== "all" && event.kind !== kindFilter) return false;
        
        if (statusFilter === "valid" && !event.isValid) return false;
        if (statusFilter === "invalid" && event.isValid !== false) return false;
        if (statusFilter === "missing" && event.checksum) return false;

        if (!lower) return true;
        return (
          event.kind.toLowerCase().includes(lower) ||
          event.id.toLowerCase().includes(lower) ||
          String(event.sequence ?? "").includes(lower)
        );
      })
      .slice()
      .reverse();
  }, [kindFilter, query, summary.events, statusFilter]);
  const backendIssues = backendReport?.issues ?? [];

  useEffect(() => {
    let cancelled = false;
    async function loadBackendIntegrity() {
      setBackendError(null);
      try {
        const params = new URLSearchParams({ file: summary.replayFile });
        const response = await fetch(`/api/integrity?${params.toString()}`, { cache: "no-store" });
        const payload = (await response.json()) as BackendIntegrityReport | { error?: { message?: string } };
        if (!response.ok) {
          const message = "error" in payload ? payload.error?.message : undefined;
          throw new Error(message ?? `backend validation failed (${response.status})`);
        }
        if (!cancelled) setBackendReport(payload as BackendIntegrityReport);
      } catch (err) {
        if (!cancelled) setBackendError(err instanceof Error ? err.message : "backend validation unavailable");
      }
    }
    void loadBackendIntegrity();
    return () => {
      cancelled = true;
    };
  }, [summary.replayFile]);

  return (
    <>
      <section className="timeline" aria-label="Replay timeline">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Integrity Inspector</p>
            <h2>Event Log</h2>
          </div>
          <ShieldCheck size={20} />
        </div>
        <div className="toolbar">
          <label className="control">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">all events</option>
              <option value="valid">valid checksums</option>
              <option value="invalid">invalid checksums</option>
              <option value="missing">missing checksums</option>
            </select>
          </label>
          <label className="control">
            <span><Filter size={14} /> Kind</span>
            <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
              <option value="all">all kinds</option>
              {summary.eventKinds.map((kind) => (
                <option value={kind.kind} key={kind.kind}>
                  {kind.kind}
                </option>
              ))}
            </select>
          </label>
          <label className="control search-control">
            <span><Search size={14} /> Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="id, kind, or sequence"
            />
          </label>
        </div>

        <div className="storage-health">
          <ShieldCheck size={16} className={backendReport?.status === "ok" ? "ok" : "danger"} />
          <span>Go validator</span>
          <strong>
            {backendError ? backendError : backendReport ? `${backendReport.status} - ${backendReport.summary.event_count} events` : "checking"}
          </strong>
        </div>

        <div className="event-stream">
          {filteredEvents.length === 0 ? (
            <div className="empty">No events match current filters.</div>
          ) : (
            filteredEvents.map((event) => {
              const hasChecksum = Boolean(event.checksum);
              const isOk = event.isValid;

              return (
                <button
                  className={`event-row selectable ${selectedEvent?.id === event.id ? "selected" : ""}`}
                  key={`${event.id}-${event.sequence}`}
                  type="button"
                  onClick={() => setSelectedEventId(event.id)}
                >
                  <div className="event-sequence">{event.sequence ?? "-"}</div>
                  <div>
                    <h3>{event.kind}</h3>
                    <p>{event.id}</p>
                  </div>
                  <div className={`checksum ${hasChecksum ? (isOk ? "ok" : "danger") : "bad"}`}>
                    {!hasChecksum ? "missing" : isOk ? "valid" : "invalid"}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      <section className="detail-panel" aria-label="Selected event detail">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Integrity Detail</p>
            <h2>{selectedEvent?.kind ?? "No Event Selected"}</h2>
          </div>
          {selectedEvent ? (
            selectedEvent.isValid ? <ShieldCheck size={20} className="ok" /> : <ShieldAlert size={20} className="danger" />
          ) : null}
        </div>
        {selectedEvent ? (
          <>
            <div className="detail-meta">
              <div><span>id</span><strong>{selectedEvent.id}</strong></div>
              <div><span>sequence</span><strong>{selectedEvent.sequence ?? "-"}</strong></div>
              <div><span>timestamp</span><strong>{formatTime(selectedEvent.timestamp)}</strong></div>
            </div>

            <p className="eyebrow">Checksum Verification</p>
            <div className={`artifact-viewer ${selectedEvent.isValid ? "" : "danger-border"}`}>
              <div className="artifact-meta">
                <div>
                  <span>Status</span>
                  <strong className={selectedEvent.isValid ? "ok" : "danger"}>
                    {!selectedEvent.checksum ? "Missing" : selectedEvent.isValid ? "Valid" : "Invalid"}
                  </strong>
                </div>
              </div>
              <pre>
                <strong>Recorded Checksum:</strong>
                <br />
                {selectedEvent.checksum || "none"}
              </pre>
            </div>

            {backendIssues.length ? (
              <>
                <p className="eyebrow">Backend Issues</p>
                <pre>{backendIssues.slice(0, 12).join("\n")}</pre>
              </>
            ) : null}

            <p className="eyebrow">Payload Data</p>
            <pre>{normalizedJSON(selectedEvent.payload)}</pre>
            <p className="eyebrow">Metadata Data</p>
            <pre>{normalizedJSON(selectedEvent.metadata)}</pre>
          </>
        ) : (
          <p className="empty">Choose an event from the timeline.</p>
        )}
      </section>
    </>
  );
}
