import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type ReplayEvent = {
  id: string;
  timestamp: string;
  kind: string;
  seed: number;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  sequence?: number;
  checksum?: string;
  isValid?: boolean;
};

export type ReplaySummary = {
  runId: string;
  replayFile: string;
  events: ReplayEvent[];
  eventKinds: Array<{ kind: string; count: number }>;
  validChecksums: number;
  invalidChecksums: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
};

export type ReplayArtifactKind = "screenshot" | "dom";

export type ReplayArtifact = {
  path: string;
  fileName: string;
  contentType: string;
};

const dataDir = process.env.SYNTHA_DATA_DIR || resolveDataDir();
const replayDir = path.join(dataDir, "replays");

function resolveDataDir(): string {
  const candidates = [
    path.join(process.cwd(), "data"),
    path.resolve(process.cwd(), "../..", "data"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[1];
}

function stableSortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSortValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = stableSortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableSortValue(value));
}

function checksumFor(event: ReplayEvent): string {
  const base = {
    id: event.id,
    timestamp: event.timestamp,
    kind: event.kind,
    seed: event.seed,
    payload: event.payload,
    metadata: event.metadata,
    sequence: event.sequence,
  };
  return createHash("sha256").update(stableStringify(base)).digest("hex");
}

function parseJSONL(filePath: string): ReplayEvent[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf8")
    .split("\n")
    .flatMap((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return [];

      try {
        const event = JSON.parse(trimmed) as Partial<ReplayEvent>;
        const lineNumber = index + 1;
        return [{
          ...event,
          id: event.id || `${path.basename(filePath)}:${lineNumber}`,
          sequence: event.sequence ?? lineNumber,
          timestamp: event.timestamp ?? new Date(0).toISOString(),
          kind: event.kind ?? "unknown_event",
          seed: event.seed ?? 0,
          payload: event.payload ?? {},
          metadata: event.metadata ?? {},
        } satisfies ReplayEvent];
      } catch {
        return [];
      }
    });
}

function contentTypeForArtifact(kind: ReplayArtifactKind, fileName: string): string | null {
  if (kind === "screenshot") {
    if (fileName.endsWith(".png")) return "image/png";
    if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) return "image/jpeg";
    if (fileName.endsWith(".webp")) return "image/webp";
    return null;
  }

  return fileName.endsWith(".html") ? "text/plain; charset=utf-8" : null;
}

export function resolveReplayArtifact(kind: ReplayArtifactKind, fileName: string): ReplayArtifact | null {
  const safeName = path.basename(fileName);
  if (safeName !== fileName) return null;

  const contentType = contentTypeForArtifact(kind, safeName);
  if (!contentType) return null;

  const artifactDir = path.join(dataDir, kind === "screenshot" ? "artifacts" : "dom-snapshots");
  const artifactPath = path.resolve(artifactDir, safeName);
  const artifactRoot = `${path.resolve(artifactDir)}${path.sep}`;
  if (!artifactPath.startsWith(artifactRoot) || !existsSync(artifactPath)) return null;

  return {
    path: artifactPath,
    fileName: safeName,
    contentType,
  };
}

export function listReplayFiles(): string[] {
  if (!existsSync(replayDir)) return [];
  return readdirSync(replayDir)
    .filter((file) => file.endsWith(".jsonl"))
    .sort();
}

export function readReplaySummary(fileName?: string): ReplaySummary {
  const files = listReplayFiles();
  const replayFile = fileName && files.includes(fileName) ? fileName : files.at(-1) ?? "test-replay.jsonl";
  const events = parseJSONL(path.join(replayDir, replayFile));
  const runId = String(events[0]?.metadata?.run_id ?? "unpacked");
  const kindCounts = new Map<string, number>();
  let validChecksums = 0;
  let invalidChecksums = 0;

  for (const event of events) {
    kindCounts.set(event.kind, (kindCounts.get(event.kind) ?? 0) + 1);
    if (!event.checksum) {
      invalidChecksums += 1;
      event.isValid = false;
      continue;
    }
    if (checksumFor(event) === event.checksum) {
      validChecksums += 1;
      event.isValid = true;
    } else {
      invalidChecksums += 1;
      event.isValid = false;
    }
  }

  return {
    runId,
    replayFile,
    events,
    eventKinds: Array.from(kindCounts.entries()).map(([kind, count]) => ({ kind, count })),
    validChecksums,
    invalidChecksums,
    firstTimestamp: events[0]?.timestamp ?? null,
    lastTimestamp: events.at(-1)?.timestamp ?? null,
  };
}
