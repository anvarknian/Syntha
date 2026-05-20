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
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as ReplayEvent];
      } catch {
        return [];
      }
    });
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
      continue;
    }
    if (checksumFor(event) === event.checksum) validChecksums += 1;
    else invalidChecksums += 1;
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
