"use client";

import { Camera, Code2, ExternalLink, Filter, FileJson2, ImageOff, Search, ShieldCheck, ShieldX } from "lucide-react";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReplayEvent, ReplaySummary } from "@/lib/replay";

type ReplayWorkbenchProps = {
  summary: ReplaySummary;
  replayFiles: string[];
};

type BrowserArtifact = {
  key: string;
  label: string;
  screenshot?: string;
  domSnapshot?: string;
  requestedURL?: string;
  finalURL?: string;
  title?: string;
  status?: string;
  captchaDetected?: boolean;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function readStatus(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizedJSON(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function artifactURL(kind: "screenshot" | "dom", fileName: string): string {
  return `/api/artifacts/${kind}/${encodeURIComponent(fileName)}`;
}

function browserArtifactsForEvent(event: ReplayEvent): BrowserArtifact[] {
  const payload = asRecord(event.payload);
  if (!payload) return [];

  const artifacts: BrowserArtifact[] = [];
  const tabs = payload.tabs;
  if (Array.isArray(tabs)) {
    for (const [index, tab] of tabs.entries()) {
      const tabRecord = asRecord(tab);
      if (!tabRecord) continue;

      const screenshot = readString(tabRecord, "screenshot");
      const domSnapshot = readString(tabRecord, "dom_snapshot");
      if (!screenshot && !domSnapshot) continue;

      const tabIndex = readStatus(tabRecord, "tab_index") ?? String(index + 1);
      artifacts.push({
        key: `${event.id}-tab-${tabIndex}`,
        label: `tab ${tabIndex}`,
        screenshot,
        domSnapshot,
        requestedURL: readString(tabRecord, "requested_url"),
        finalURL: readString(tabRecord, "final_url"),
        title: readString(tabRecord, "title"),
        status: readStatus(tabRecord, "status"),
        captchaDetected: readBoolean(tabRecord, "captcha_detected"),
      });
    }
  }

  const screenshot = readString(payload, "screenshot");
  const domSnapshot = readString(payload, "dom_snapshot");
  if (artifacts.length === 0 && (screenshot || domSnapshot)) {
    artifacts.push({
      key: `${event.id}-primary`,
      label: "primary",
      screenshot,
      domSnapshot,
      requestedURL: readString(payload, "url"),
    });
  }

  return artifacts;
}

export function ReplayWorkbench({ summary, replayFiles }: ReplayWorkbenchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [kindFilter, setKindFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(summary.events.at(-1)?.id ?? null);
  const [selectedArtifactKey, setSelectedArtifactKey] = useState<string | null>(null);

  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return summary.events.at(-1) ?? null;
    return summary.events.find((event) => event.id === selectedEventId) ?? null;
  }, [selectedEventId, summary.events]);

  const filteredEvents = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return summary.events
      .filter((event) => {
        if (kindFilter !== "all" && event.kind !== kindFilter) return false;
        if (verifiedOnly && !event.checksum) return false;
        if (!lower) return true;
        return (
          event.kind.toLowerCase().includes(lower) ||
          event.id.toLowerCase().includes(lower) ||
          String(event.sequence ?? "").includes(lower)
        );
      })
      .slice()
      .reverse();
  }, [kindFilter, query, summary.events, verifiedOnly]);

  const filteredKinds = summary.eventKinds.filter((item) => kindFilter === "all" || item.kind === kindFilter);
  const currentReplayFile = searchParams.get("replay") || summary.replayFile;
  const browserArtifacts = useMemo(
    () => (selectedEvent ? browserArtifactsForEvent(selectedEvent) : []),
    [selectedEvent],
  );
  const selectedArtifact =
    (selectedArtifactKey ? browserArtifacts.find((artifact) => artifact.key === selectedArtifactKey) : null) ??
    browserArtifacts[0] ??
    null;

  function updateReplayFile(file: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("replay", file);
    router.replace(`${pathname}?${params.toString()}` as any);
  }

  function isVerified(event: ReplayEvent): boolean {
    return Boolean(event.checksum);
  }

  return (
    <>
      <section className="timeline" aria-label="Replay timeline">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Replay Inspector</p>
            <h2>Timeline</h2>
          </div>
          <FileJson2 size={20} />
        </div>
        <div className="toolbar">
          <label className="control">
            <span>Replay File</span>
            <select value={currentReplayFile} onChange={(event) => updateReplayFile(event.target.value)}>
              {replayFiles.map((file) => (
                <option value={file} key={file}>
                  {file}
                </option>
              ))}
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
          <label className="switch">
            <input
              type="checkbox"
              checked={verifiedOnly}
              onChange={(event) => setVerifiedOnly(event.target.checked)}
            />
            <span>verified only</span>
          </label>
        </div>

        <div className="event-stream">
          {filteredEvents.length === 0 ? (
            <div className="empty">No events match current filters.</div>
          ) : (
            filteredEvents.map((event) => (
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
                <div className={`checksum ${isVerified(event) ? "ok" : "bad"}`}>
                  {isVerified(event) ? "verified" : "missing"}
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="detail-panel" aria-label="Selected event detail">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Event Detail</p>
            <h2>{selectedEvent?.kind ?? "No Event Selected"}</h2>
          </div>
          {selectedEvent ? (
            isVerified(selectedEvent) ? <ShieldCheck size={20} className="ok" /> : <ShieldX size={20} className="danger" />
          ) : null}
        </div>
        {selectedEvent ? (
          <>
            <div className="detail-meta">
              <div><span>id</span><strong>{selectedEvent.id}</strong></div>
              <div><span>sequence</span><strong>{selectedEvent.sequence ?? "-"}</strong></div>
              <div><span>timestamp</span><strong>{formatTime(selectedEvent.timestamp)}</strong></div>
            </div>
            <p className="eyebrow">Payload</p>
            {browserArtifacts.length > 0 ? (
              <div className="artifact-viewer">
                <div className="artifact-header">
                  <span><Camera size={14} /> Browser artifacts</span>
                  <strong>{browserArtifacts.length}</strong>
                </div>
                <div className="artifact-tabs" role="tablist" aria-label="Browser artifacts">
                  {browserArtifacts.map((artifact) => (
                    <button
                      aria-selected={selectedArtifact?.key === artifact.key}
                      className={selectedArtifact?.key === artifact.key ? "active" : ""}
                      key={artifact.key}
                      onClick={() => setSelectedArtifactKey(artifact.key)}
                      role="tab"
                      type="button"
                    >
                      {artifact.label}
                    </button>
                  ))}
                </div>

                {selectedArtifact?.screenshot ? (
                  <a
                    className="screenshot-preview"
                    href={artifactURL("screenshot", selectedArtifact.screenshot)}
                    rel="noreferrer"
                    target="_blank"
                    title="Open screenshot artifact"
                  >
                    <img alt={`${selectedArtifact.label} screenshot`} src={artifactURL("screenshot", selectedArtifact.screenshot)} />
                  </a>
                ) : (
                  <div className="artifact-empty"><ImageOff size={16} /> No screenshot recorded for this artifact.</div>
                )}

                {selectedArtifact ? (
                  <div className="artifact-meta">
                    <div><span>title</span><strong>{selectedArtifact.title ?? "untitled"}</strong></div>
                    <div><span>status</span><strong>{selectedArtifact.status ?? "n/a"}</strong></div>
                    <div><span>captcha</span><strong>{selectedArtifact.captchaDetected ? "detected" : "not detected"}</strong></div>
                    <div><span>final url</span><strong>{selectedArtifact.finalURL ?? selectedArtifact.requestedURL ?? "n/a"}</strong></div>
                  </div>
                ) : null}

                {selectedArtifact?.domSnapshot ? (
                  <a
                    className="artifact-link"
                    href={artifactURL("dom", selectedArtifact.domSnapshot)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <Code2 size={15} /> Open DOM snapshot <ExternalLink size={13} />
                  </a>
                ) : null}
              </div>
            ) : null}
            <pre>{normalizedJSON(selectedEvent.payload)}</pre>
            <p className="eyebrow">Metadata</p>
            <pre>{normalizedJSON(selectedEvent.metadata)}</pre>
          </>
        ) : (
          <p className="empty">Choose an event from the timeline.</p>
        )}
        <div className="kind-list compact">
          {filteredKinds.map((item) => (
            <div className="kind-row" key={item.kind}>
              <span>{item.kind}</span>
              <meter min="0" max={summary.events.length || 1} value={item.count} />
              <strong>{item.count}</strong>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
