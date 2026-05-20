import { createHash } from "node:crypto";

export const REPLAY_SCHEMA_VERSION = "v1";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ReplayMetadata = JsonObject & {
  schema_version: typeof REPLAY_SCHEMA_VERSION;
  run_id?: string;
  source?: string;
  source_file?: string;
  source_line?: number;
};

export type ReplayEvent<
  TPayload extends JsonObject = JsonObject,
  TMetadata extends ReplayMetadata = ReplayMetadata,
> = {
  id: string;
  timestamp: string;
  kind: string;
  seed: number;
  payload: TPayload;
  metadata: TMetadata;
  sequence?: number;
  checksum?: string;
};

export type ReplayEventInput<TPayload extends JsonObject = JsonObject> = {
  id?: string;
  timestamp?: string | Date;
  kind: string;
  seed?: number;
  payload?: TPayload;
  metadata?: Partial<ReplayMetadata>;
  sourceFile?: string;
  sourceLine?: number;
};

export type RecordOptions = {
  id?: string;
  timestamp?: string | Date;
  seed?: number;
  metadata?: Partial<ReplayMetadata>;
  sourceFile?: string;
  sourceLine?: number;
};

export type ReplaySink = {
  write(event: ReplayEvent): Promise<void>;
};

export type RecorderOptions = {
  runId: string;
  source?: string;
  sink: ReplaySink;
  scrub?: ScrubOptions;
  startSequence?: number;
};

export type ScrubOptions = {
  allowRawPII?: boolean;
  deniedFields?: string[];
};

export type ScenarioClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

export type ScenarioCreateOptions = {
  contentType?: "application/x-yaml" | "application/json";
  idempotencyKey?: string;
  signal?: AbortSignal;
};

export type ScenarioCreateResponse = {
  scenario_id: string;
  seed: number;
  created_at: string;
};

export class SynthaSDKError extends Error {
  readonly code: string;
  readonly status: number | undefined;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "SynthaSDKError";
    this.code = code;
    this.status = status;
  }
}

export class ConsoleReplaySink implements ReplaySink {
  async write(event: ReplayEvent): Promise<void> {
    console.log(JSON.stringify(event));
  }
}

export class HttpReplaySink implements ReplaySink {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: HeadersInit;

  constructor(endpoint: string, init: { fetchImpl?: typeof fetch; headers?: HeadersInit } = {}) {
    this.endpoint = endpoint;
    this.fetchImpl = init.fetchImpl ?? fetch;
    this.headers = init.headers ?? {};
  }

  async write(event: ReplayEvent): Promise<void> {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.headers,
      },
      body: JSON.stringify(event),
    });
    if (!response.ok) {
      throw new SynthaSDKError("event_write_failed", `event sink returned ${response.status}`, response.status);
    }
  }
}

export class BufferedReplaySink implements ReplaySink {
  readonly events: ReplayEvent[] = [];

  async write(event: ReplayEvent): Promise<void> {
    this.events.push(event);
  }
}

export class SynthaRecorder {
  private readonly runId: string;
  private readonly source: string;
  private readonly sink: ReplaySink;
  private readonly scrub: ScrubOptions;
  private sequence: number;

  constructor(options: RecorderOptions) {
    this.runId = options.runId;
    this.source = options.source ?? "external-agent-runtime";
    this.sink = options.sink;
    this.scrub = options.scrub ?? {};
    this.sequence = options.startSequence ?? 0;
  }

  async record<TPayload extends JsonObject>(
    kind: string,
    payload: TPayload,
    options: RecordOptions = {},
  ): Promise<ReplayEvent> {
    this.sequence += 1;
    const input: ReplayEventInput<TPayload> = {
      kind,
      payload: scrubJsonObject(payload, this.scrub),
      metadata: {
        run_id: this.runId,
        source: this.source,
        ...options.metadata,
      },
    };
    if (options.id !== undefined) input.id = options.id;
    if (options.timestamp !== undefined) input.timestamp = options.timestamp;
    if (options.seed !== undefined) input.seed = options.seed;
    if (options.sourceFile !== undefined) input.sourceFile = options.sourceFile;
    if (options.sourceLine !== undefined) input.sourceLine = options.sourceLine;

    const event = withIntegrity(normalizeEvent(input), this.sequence);

    await this.sink.write(event);
    return event;
  }

  async recordPrompt(payload: {
    prompt: string;
    model?: string;
    input_tokens?: number;
    metadata?: JsonObject;
  }, options: RecordOptions = {}): Promise<ReplayEvent> {
    return this.record("agent_prompt", toJsonObject(payload), options);
  }

  async recordToolCall(payload: {
    tool: string;
    arguments: JsonObject;
    result?: JsonValue;
    duration_ms?: number;
    metadata?: JsonObject;
  }, options: RecordOptions = {}): Promise<ReplayEvent> {
    return this.record("tool_call", toJsonObject(payload), options);
  }

  async recordObservation(payload: {
    channel: string;
    content: JsonValue;
    metadata?: JsonObject;
  }, options: RecordOptions = {}): Promise<ReplayEvent> {
    return this.record("agent_observation", toJsonObject(payload), options);
  }
}

export function normalizeEvent<TPayload extends JsonObject>(
  input: ReplayEventInput<TPayload>,
): ReplayEvent<TPayload> {
  const timestamp = normalizeTimestamp(input.timestamp);
  const metadata = normalizeMetadata(input.metadata, input.sourceFile, input.sourceLine);
  const payload = input.payload ?? ({} as TPayload);
  const eventWithoutID = {
    timestamp,
    kind: input.kind.trim(),
    payload,
    metadata,
  };

  if (!eventWithoutID.kind) {
    throw new SynthaSDKError("invalid_event", "event kind is required");
  }

  return {
    id: input.id?.trim() || deriveDeterministicID(eventWithoutID, input.sourceFile, input.sourceLine),
    timestamp,
    kind: eventWithoutID.kind,
    seed: input.seed !== undefined && Number.isInteger(input.seed) ? input.seed : deriveSeed(eventWithoutID),
    payload,
    metadata,
  };
}

export function withIntegrity<TPayload extends JsonObject>(
  event: ReplayEvent<TPayload>,
  sequence: number,
): ReplayEvent<TPayload> {
  const sequenced = { ...event, sequence };
  return {
    ...sequenced,
    checksum: computeEventChecksum(sequenced),
  };
}

export function computeEventChecksum(event: ReplayEvent): string {
  return sha256Hex(stableStringify({
    id: event.id,
    timestamp: event.timestamp,
    kind: event.kind,
    seed: event.seed,
    payload: event.payload,
    metadata: event.metadata,
    sequence: event.sequence,
  }));
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableSortValue(value));
}

export function scrubJsonObject<T extends JsonObject>(value: T, options: ScrubOptions = {}): T {
  if (options.allowRawPII) return value;
  return scrubValue(value, options) as T;
}

export function scrubValue(value: JsonValue, options: ScrubOptions = {}): JsonValue {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, options));
  if (value !== null && typeof value === "object") {
    const denied = new Set((options.deniedFields ?? []).map((field) => field.toLowerCase()));
    const out: JsonObject = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = denied.has(key.toLowerCase()) ? "[REDACTED]" : scrubValue(child, options);
    }
    return out;
  }
  return value;
}

export function createScenarioClient(options: ScenarioClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async createScenario(body: string, createOptions: ScenarioCreateOptions = {}): Promise<ScenarioCreateResponse> {
      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          "Content-Type": createOptions.contentType ?? "application/x-yaml",
          ...(createOptions.idempotencyKey ? { "Idempotency-Key": createOptions.idempotencyKey } : {}),
        },
        body,
      };
      if (createOptions.signal !== undefined) requestInit.signal = createOptions.signal;
      const response = await fetchImpl(`${baseUrl}/scenario`, requestInit);
      const payload = await response.json() as unknown;
      if (!response.ok) {
        const error = extractStructuredError(payload);
        throw new SynthaSDKError(error.code, error.message, response.status);
      }
      return payload as ScenarioCreateResponse;
    },
  };
}

function normalizeTimestamp(timestamp: string | Date | undefined): string {
  if (timestamp instanceof Date) return timestamp.toISOString();
  if (typeof timestamp === "string" && timestamp.trim() !== "") {
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      throw new SynthaSDKError("invalid_timestamp", "event timestamp must be ISO-parseable");
    }
    return parsed.toISOString();
  }
  return new Date().toISOString();
}

function normalizeMetadata(
  metadata: Partial<ReplayMetadata> | undefined,
  sourceFile: string | undefined,
  sourceLine: number | undefined,
): ReplayMetadata {
  const out: ReplayMetadata = {
    schema_version: REPLAY_SCHEMA_VERSION,
    ...(metadata ?? {}),
  };
  if (sourceFile && typeof out.source_file !== "string") out.source_file = sourceFile;
  if (sourceLine && typeof out.source_line !== "number") out.source_line = sourceLine;
  out.schema_version = REPLAY_SCHEMA_VERSION;
  return out;
}

function deriveSeed(value: unknown): number {
  const digest = createHash("sha256").update(stableStringify(value)).digest();
  return digest.readInt32BE(0);
}

function deriveDeterministicID(value: unknown, sourceFile?: string, sourceLine?: number): string {
  const suffix = sha256Hex(stableStringify({
    source_file: sourceFile ?? "external",
    source_line: sourceLine ?? 0,
    value,
  })).slice(0, 12);
  return `evt_${suffix}`;
}

function stableSortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSortValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = stableSortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function scrubString(input: string): string {
  return input
    .replace(/\b(?:\d[ -]*?){13,16}\b/g, "[REDACTED_CCN]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, (email) => {
      const [local, domain] = email.split("@");
      if (!local || !domain) return "[REDACTED_EMAIL]";
      if (local.length <= 2) return `[REDACTED]@${domain}`;
      return `${"X".repeat(local.length - 2)}${local.slice(-2)}@${domain}`;
    })
    .replace(/\b((?:api[_-]?key|token|secret|password)=)([^\s]+)/gi, "$1[REDACTED_SECRET]");
}

function extractStructuredError(payload: unknown): { code: string; message: string } {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const code = (error as { code?: unknown }).code;
      const message = (error as { message?: unknown }).message;
      return {
        code: typeof code === "string" ? code : "request_failed",
        message: typeof message === "string" ? message : "request failed",
      };
    }
  }
  return { code: "request_failed", message: "request failed" };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
