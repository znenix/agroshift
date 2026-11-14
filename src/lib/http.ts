/**
 * Fetch helpers for upstream APIs: timeout, retry with exponential backoff, zod validation, and a
 * concurrency limiter. Used by scripts and Route Handlers only — the browser never calls upstream
 * APIs (CLAUDE.md §1.8).
 */
import type { z } from "zod";

/** Identifies the project to upstream APIs; deliberately carries no personal details. */
export const USER_AGENT = "AgroShift-UZ/0.1 (NASA Space Apps 2026 project)";

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export interface FetchJsonOptions<T> {
  schema: z.ZodType<T>;
  timeoutMs: number;
  /** Extra attempts after the first one (default 3). */
  retries?: number;
  /** First backoff delay; doubles on each retry, plus jitter (default 2 s). */
  backoffMs?: number;
  fetchImpl?: typeof fetch;
  onRetry?: (attempt: number, reason: string) => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/** GET a JSON document and validate it. Retries timeouts, network errors, 408, 429 and 5xx. */
export async function fetchJson<T>(url: string, options: FetchJsonOptions<T>): Promise<T> {
  const { schema, timeoutMs, retries = 3, backoffMs = 2000, fetchImpl = fetch, onRetry } = options;
  let lastReason = "unknown error";
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      onRetry?.(attempt, lastReason);
      await sleep(backoffMs * 2 ** (attempt - 1) + Math.random() * backoffMs);
    }
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastReason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      continue;
    }
    if (!response.ok) {
      lastReason = `HTTP ${response.status}`;
      if (isRetryableStatus(response.status)) continue;
      const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
      throw new UpstreamError(`HTTP ${response.status} from ${url}${detail ? ` — ${detail}` : ""}`, url, response.status);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      lastReason = `invalid JSON (${error instanceof Error ? error.message : String(error)})`;
      continue;
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new UpstreamError(`unexpected response shape: ${describeIssues(parsed.error)}`, url, response.status);
    }
    return parsed.data;
  }
  throw new UpstreamError(`gave up after ${retries + 1} attempts: ${lastReason}`, url);
}

/**
 * Runs at most `maxConcurrent` tasks at once and starts them at least `minIntervalMs` apart.
 * Tasks queued with `priority` run before the others (e.g. a step that other work is waiting on).
 */
export function createLimiter(maxConcurrent: number, minIntervalMs = 0) {
  let active = 0;
  let lastStart = 0;
  const queue: Array<() => void> = [];

  const pump = () => {
    if (active >= maxConcurrent) return;
    const next = queue.shift();
    if (next === undefined) return;
    active++;
    const wait = Math.max(0, lastStart + minIntervalMs - Date.now());
    lastStart = Date.now() + wait;
    setTimeout(next, wait);
  };

  return function limit<T>(task: () => Promise<T>, priority = false): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          });
      };
      if (priority) queue.unshift(run);
      else queue.push(run);
      pump();
    });
  };
}
