"use client";

import { useEffect, useMemo, useState } from "react";
import { Database, HardDrive, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";

type StorageFile = {
  name: string;
  path: string;
  size_bytes: number;
  modified_at: string;
  sha256?: string;
};

type StorageCollection = {
  name: string;
  directory: string;
  files: StorageFile[];
  file_count: number;
  total_bytes: number;
};

type StorageOverview = {
  root: string;
  generated_at: string;
  collections: Record<string, StorageCollection>;
  total_bytes: number;
};

type StorageHealth = {
  status: string;
  root: string;
  writable: boolean;
  checked_at: string;
  collections: Record<string, string>;
  errors?: string[];
};

type RetentionResult = {
  deleted_files: string[];
  deleted_bytes: number;
  kept_files: number;
  cutoff: string;
  dry_run: boolean;
  preserve_jsonl: boolean;
  collection_name?: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

export function StorageWorkbench() {
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [health, setHealth] = useState<StorageHealth | null>(null);
  const [selectedCollection, setSelectedCollection] = useState("replays");
  const [maxAgeDays, setMaxAgeDays] = useState(30);
  const [dryRun, setDryRun] = useState(true);
  const [retention, setRetention] = useState<RetentionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const collections = useMemo(() => {
    if (!overview) return [];
    return Object.values(overview.collections).sort((a, b) => a.name.localeCompare(b.name));
  }, [overview]);

  const activeCollection = overview?.collections[selectedCollection] ?? collections[0] ?? null;
  const activeFiles = activeCollection?.files ?? [];
  const deletedFiles = retention?.deleted_files ?? [];

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [overviewResponse, healthResponse] = await Promise.all([
        fetch("/api/storage", { cache: "no-store" }),
        fetch("/api/storage/health", { cache: "no-store" }),
      ]);
      if (!overviewResponse.ok) throw new Error(`storage overview failed (${overviewResponse.status})`);
      const nextOverview = (await overviewResponse.json()) as StorageOverview;
      const nextHealth = (await healthResponse.json()) as StorageHealth;
      setOverview(nextOverview);
      setHealth(nextHealth);
      if (!nextOverview.collections[selectedCollection]) {
        setSelectedCollection(Object.keys(nextOverview.collections).sort()[0] ?? "replays");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "storage request failed");
    } finally {
      setLoading(false);
    }
  }

  async function applyRetention() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/storage/retention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collection: selectedCollection,
          max_age_days: maxAgeDays,
          dry_run: dryRun,
          preserve_jsonl: true,
        }),
      });
      const payload = (await response.json()) as RetentionResult | { error?: { message?: string } };
      if (!response.ok) {
        const message = "error" in payload ? payload.error?.message : undefined;
        throw new Error(message ?? `retention failed (${response.status})`);
      }
      setRetention(payload as RetentionResult);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "retention request failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <>
      <section className="timeline" aria-label="Storage collections">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Storage Manager</p>
            <h2>Collections</h2>
          </div>
          <Database size={20} />
        </div>
        <div className="toolbar">
          <label className="control">
            <span>Collection</span>
            <select value={selectedCollection} onChange={(event) => setSelectedCollection(event.target.value)}>
              {collections.map((collection) => (
                <option key={collection.name} value={collection.name}>
                  {collection.name}
                </option>
              ))}
            </select>
          </label>
          <button className="action-button" type="button" onClick={() => void refresh()} disabled={loading}>
            <RotateCcw size={15} /> Refresh
          </button>
        </div>

        <div className="storage-cards">
          {collections.map((collection) => (
            <button
              className={`storage-card ${collection.name === selectedCollection ? "active" : ""}`}
              key={collection.name}
              type="button"
              onClick={() => setSelectedCollection(collection.name)}
            >
              <span>{collection.name}</span>
              <strong>{collection.file_count}</strong>
              <small>{formatBytes(collection.total_bytes)}</small>
            </button>
          ))}
        </div>

        {error ? <div className="empty danger">{error}</div> : null}
        {health ? (
          <div className="storage-health">
            <ShieldCheck size={16} className={health.status === "ok" ? "ok" : "danger"} />
            <span>{health.status}</span>
            <strong>{health.writable ? "writable" : "read-only"}</strong>
          </div>
        ) : null}
      </section>

      <section className="detail-panel wide-detail" aria-label="Storage files">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Browse</p>
            <h2>{activeCollection?.name ?? "No Collection"}</h2>
          </div>
          <HardDrive size={20} />
        </div>
        {activeCollection ? (
          <>
            <div className="detail-meta">
              <div><span>directory</span><strong>{activeCollection.directory}</strong></div>
              <div><span>total bytes</span><strong>{formatBytes(activeCollection.total_bytes)}</strong></div>
            </div>
            <div className="file-list">
              {activeFiles.length === 0 ? (
                <div className="empty">No files in this collection.</div>
              ) : (
                activeFiles.map((file) => (
                  <div className="file-row" key={file.path}>
                    <div>
                      <strong>{file.name}</strong>
                      <span>{file.sha256 ? file.sha256.slice(0, 16) : file.path}</span>
                    </div>
                    <small>{formatTime(file.modified_at)}</small>
                    <b>{formatBytes(file.size_bytes)}</b>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <p className="empty">Storage overview is loading.</p>
        )}
      </section>

      <section className="scenario-panel" aria-label="Retention controls">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Retention</p>
            <h2>Policy Runner</h2>
          </div>
          <Trash2 size={20} />
        </div>
        <div className="retention-form">
          <label className="control">
            <span>Max Age Days</span>
            <input
              min={1}
              type="number"
              value={maxAgeDays}
              onChange={(event) => setMaxAgeDays(Number(event.target.value))}
            />
          </label>
          <label className="switch">
            <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
            <span>dry run</span>
          </label>
          <button className="action-button primary-action" type="button" onClick={() => void applyRetention()} disabled={loading}>
            <Trash2 size={15} /> Run retention
          </button>
        </div>
        {retention ? (
          <div className="artifact-viewer">
            <div className="artifact-header">
              <span>{retention.dry_run ? "Would delete" : "Deleted"}</span>
              <strong>{deletedFiles.length}</strong>
            </div>
            <div className="artifact-meta">
              <div><span>bytes</span><strong>{formatBytes(retention.deleted_bytes)}</strong></div>
              <div><span>kept</span><strong>{retention.kept_files}</strong></div>
              <div><span>jsonl</span><strong>{retention.preserve_jsonl ? "preserved" : "eligible"}</strong></div>
              <div><span>cutoff</span><strong>{formatTime(retention.cutoff)}</strong></div>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
