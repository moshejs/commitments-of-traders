/**
 * commitments-of-traders — typed, zero-dependency client for the CFTC's
 * Commitments of Traders (COT) reports via the official Socrata API at
 * publicreporting.cftc.gov.
 *
 * Covers all three report families (Legacy, Disaggregated, Traders in
 * Financial Futures) in both futures-only and combined (futures + options)
 * forms, with SoQL filtering, sorting, and pagination. No API key required.
 */

/** COT report family. */
export type CotReport = "legacy" | "disaggregated" | "tff";
/** Whether to include options: futures only, or futures + options combined. */
export type CotInclude = "futures-only" | "combined";

/** Socrata dataset resource IDs, confirmed against publicreporting.cftc.gov. */
export const DATASETS: Record<CotReport, Record<CotInclude, string>> = {
  legacy: { "futures-only": "6dca-aqww", combined: "jun7-fc8e" },
  disaggregated: { "futures-only": "72hh-3qpy", combined: "kh3c-gbw2" },
  tff: { "futures-only": "gpe5-46if", combined: "yw9f-hn96" },
};

export interface CotOptions {
  /** Custom fetch implementation (testing, proxies). Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Base URL. Defaults to "https://publicreporting.cftc.gov". */
  baseUrl?: string;
  /** Optional Socrata app token (raises rate limits; not required). */
  appToken?: string;
  /** Abort the request after this many milliseconds (no timeout by default). */
  timeoutMs?: number;
  /** AbortSignal to cancel the request. */
  signal?: AbortSignal;
}

/**
 * A COT report row. All values are strings, as Socrata returns them; the
 * columns differ by report family (Legacy ~120, Disaggregated ~190, TFF ~90),
 * so only the always-present identity columns are typed — everything else is
 * reachable through the index signature. Use {@link num} for numeric columns.
 */
export interface CotRow {
  market_and_exchange_names: string;
  report_date_as_yyyy_mm_dd: string; // ISO datetime
  yyyy_report_week_ww: string;
  contract_market_name: string;
  cftc_contract_market_code: string;
  cftc_commodity_code: string;
  open_interest_all: string;
  [column: string]: string | undefined;
}

export interface QueryParams {
  /**
   * Case-insensitive contains-match on `market_and_exchange_names` (SoQL
   * `like '%…%'`, so `%` and `_` act as wildcards). Note "GOLD" also matches
   * "MICRO GOLD", and the CFTC renamed many markets in Feb 2022 — prefer
   * `contractMarketCode` for one market's history.
   */
  market?: string;
  /** Exact CFTC contract market code, e.g. "13874A" (E-mini S&P 500). Stable across renames. */
  contractMarketCode?: string;
  /** Report date lower bound (inclusive), YYYY-MM-DD. */
  since?: string;
  /** Report date upper bound (inclusive), YYYY-MM-DD. */
  until?: string;
  /** Raw SoQL `$where` clause; ANDed with the structured filters above. */
  where?: string;
  /** Columns to select (SoQL `$select`). Default all. */
  select?: string[];
  /**
   * SoQL `$order`. Default: report date descending, then market name and row
   * id, so ties are deterministic and `offset` paging is stable.
   */
  order?: string;
  /** Row cap (Socrata `$limit`). Default 1000. */
  limit?: number;
  /** Row offset (Socrata `$offset`). */
  offset?: number;
}

/**
 * Thrown for non-2xx responses (with Socrata's own error message appended
 * when it sends one, e.g. "No such column") and for non-JSON bodies.
 */
export class CotError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string, message?: string) {
    super(message ?? `CFTC COT request failed with HTTP ${status}: ${url}`);
    this.name = "CotError";
    this.status = status;
    this.url = url;
  }
}

const DEFAULT_BASE = "https://publicreporting.cftc.gov";
const DEFAULT_ORDER = "report_date_as_yyyy_mm_dd DESC, market_and_exchange_names ASC, id ASC";
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Escape a single-quoted SoQL string literal. */
function soqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function checkDate(d: string, label: string): void {
  const ok =
    typeof d === "string" &&
    ISO_DATE_RE.test(d) &&
    new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
  if (!ok) throw new RangeError(`Invalid ${label}: "${d}" (expected a real YYYY-MM-DD date)`);
}

function buildWhere(params: QueryParams): string | undefined {
  const clauses: string[] = [];
  if (params.market !== undefined) {
    clauses.push(`upper(market_and_exchange_names) like upper(${soqlString(`%${params.market}%`)})`);
  }
  if (params.contractMarketCode !== undefined) {
    clauses.push(`cftc_contract_market_code = ${soqlString(params.contractMarketCode)}`);
  }
  if (params.since !== undefined) {
    checkDate(params.since, "since");
    clauses.push(`report_date_as_yyyy_mm_dd >= '${params.since}T00:00:00.000'`);
  }
  if (params.until !== undefined) {
    checkDate(params.until, "until");
    if (params.since !== undefined && params.since > params.until) {
      throw new RangeError(`since ${params.since} is after until ${params.until}`);
    }
    clauses.push(`report_date_as_yyyy_mm_dd <= '${params.until}T23:59:59.999'`);
  }
  if (params.where !== undefined) clauses.push(`(${params.where})`);
  return clauses.length ? clauses.join(" AND ") : undefined;
}

function resolveDataset(report: CotReport, include: CotInclude): string {
  const byInclude = DATASETS[report];
  if (!byInclude) throw new RangeError(`Unknown report "${report}"`);
  const id = byInclude[include];
  if (!id) throw new RangeError(`Unknown include "${include}"`);
  return id;
}

async function request(
  datasetId: string,
  params: QueryParams,
  opts: CotOptions,
): Promise<CotRow[]> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const sp = new URLSearchParams();

  if (params.select && params.select.length) sp.set("$select", params.select.join(","));
  const where = buildWhere(params);
  if (where) sp.set("$where", where);
  sp.set("$order", params.order ?? DEFAULT_ORDER);
  if (params.limit !== undefined) {
    if (!Number.isInteger(params.limit) || params.limit <= 0 || params.limit > 50000) {
      throw new RangeError(`limit must be an integer in 1–50000, got ${params.limit}`);
    }
    sp.set("$limit", String(params.limit));
  } else {
    sp.set("$limit", "1000");
  }
  if (params.offset !== undefined) {
    if (!Number.isInteger(params.offset) || params.offset < 0) {
      throw new RangeError(`offset must be a non-negative integer, got ${params.offset}`);
    }
    sp.set("$offset", String(params.offset));
  }

  if (!/^[a-z0-9]{4}-[a-z0-9]{4}$/.test(datasetId)) {
    throw new RangeError(`Invalid Socrata dataset id: "${datasetId}" (expected e.g. "6dca-aqww")`);
  }
  const url = `${base.replace(/\/+$/, "")}/resource/${datasetId}.json?${sp.toString()}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.appToken) headers["X-App-Token"] = opts.appToken;
  const res = await doFetch(url, { headers, signal: signalFor(opts) });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    if (!res.ok) throw new CotError(res.status, url);
    throw new CotError(res.status, url, `CFTC COT returned a non-JSON response (HTTP ${res.status}): ${url}`);
  }
  if (!res.ok) {
    const msg = (body as { message?: unknown } | null)?.message;
    throw new CotError(
      res.status,
      url,
      `CFTC COT request failed with HTTP ${res.status}: ${url}` +
        (typeof msg === "string" ? ` — ${msg.slice(0, 300)}` : ""),
    );
  }
  if (!Array.isArray(body)) {
    throw new CotError(res.status, url, `Unexpected CFTC COT response (expected an array of rows): ${url}`);
  }
  return body as CotRow[];
}

function signalFor(opts: CotOptions): AbortSignal | undefined {
  const { signal, timeoutMs } = opts;
  if (timeoutMs === undefined) return signal;
  if (!(timeoutMs > 0)) throw new RangeError(`timeoutMs must be > 0, got ${timeoutMs}`);
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  // AbortSignal.any is Node 20+; combine by hand for Node 18.
  const ctrl = new AbortController();
  const abort = (s: AbortSignal) => () => ctrl.abort(s.reason);
  if (signal.aborted) ctrl.abort(signal.reason);
  signal.addEventListener("abort", abort(signal), { once: true });
  timeout.addEventListener("abort", abort(timeout), { once: true });
  return ctrl.signal;
}

/**
 * Query a COT report family.
 *
 * ```ts
 * // The latest E-mini S&P 500 legacy report:
 * const [row] = await getCotReport("legacy", "futures-only", {
 *   market: "E-MINI S&P 500",
 *   limit: 1,
 * });
 * num(row.noncomm_positions_long_all);
 * ```
 */
export async function getCotReport(
  report: CotReport,
  include: CotInclude = "futures-only",
  params: QueryParams = {},
  opts: CotOptions = {},
): Promise<CotRow[]> {
  return request(resolveDataset(report, include), params, opts);
}

/** The part of "GOLD - COMMODITY EXCHANGE INC." before the exchange. */
function marketPart(name: string | undefined): string {
  return (name ?? "").split(" - ")[0]!.trim().toUpperCase();
}

/**
 * The single most recent report row for one market in a report family.
 * Returns null if nothing matches.
 *
 * `market` is either a name (case-insensitive contains-match) or
 * `{ contractMarketCode }`. A name that matches several markets in the latest
 * report resolves to the one whose contract market name equals it exactly
 * ("GOLD" → GOLD, not MICRO GOLD); if that still leaves more than one,
 * a RangeError lists the candidates.
 */
export async function latestForMarket(
  report: CotReport,
  market: string | { contractMarketCode: string },
  include: CotInclude = "futures-only",
  opts: CotOptions = {},
): Promise<CotRow | null> {
  const dataset = resolveDataset(report, include);
  if (typeof market !== "string") {
    const rows = await request(dataset, { contractMarketCode: market.contractMarketCode, limit: 1 }, opts);
    return rows[0] ?? null;
  }
  const rows = await request(dataset, { market, limit: 100 }, opts);
  if (!rows.length) return null;
  const latestDate = rows[0]!.report_date_as_yyyy_mm_dd;
  const latest = rows.filter((r) => r.report_date_as_yyyy_mm_dd === latestDate);
  if (latest.length === 1) return latest[0]!;
  const want = market.trim().toUpperCase();
  const exact = latest.filter(
    (r) =>
      (r.market_and_exchange_names ?? "").toUpperCase() === want ||
      (r.contract_market_name ?? "").trim().toUpperCase() === want ||
      marketPart(r.market_and_exchange_names) === want,
  );
  if (exact.length === 1) return exact[0]!;
  const names = latest.map((r) => `${r.market_and_exchange_names} (${r.cftc_contract_market_code})`);
  throw new RangeError(
    `Market "${market}" is ambiguous in the ${latestDate.slice(0, 10)} report — it matches ` +
      `${names.join("; ")}. Use a more specific name or { contractMarketCode }.`,
  );
}

/** Query directly by Socrata dataset id (escape hatch for exotic needs). */
export function queryDataset(
  datasetId: string,
  params: QueryParams = {},
  opts: CotOptions = {},
): Promise<CotRow[]> {
  return request(datasetId, params, opts);
}

/**
 * Parse a COT column string to a number, or null when empty/non-numeric.
 * `num("123456")` → 123456; `num("")` → null.
 */
export function num(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
