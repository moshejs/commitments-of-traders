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
  /** Filter to one market name (SoQL `like %…%`, case-insensitive contains). */
  market?: string;
  /** Exact CFTC contract market code. */
  contractMarketCode?: string;
  /** Report date lower bound (inclusive), YYYY-MM-DD. */
  since?: string;
  /** Report date upper bound (inclusive), YYYY-MM-DD. */
  until?: string;
  /** Raw SoQL `$where` clause; ANDed with the structured filters above. */
  where?: string;
  /** Columns to select (SoQL `$select`). Default all. */
  select?: string[];
  /** Sort column and direction. Default report date descending. */
  order?: string;
  /** Row cap (Socrata `$limit`). Default 1000. */
  limit?: number;
  /** Row offset (Socrata `$offset`). */
  offset?: number;
}

export class CotError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string) {
    super(`CFTC COT request failed with HTTP ${status}: ${url}`);
    this.name = "CotError";
    this.status = status;
    this.url = url;
  }
}

const DEFAULT_BASE = "https://publicreporting.cftc.gov";
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Escape a single-quoted SoQL string literal. */
function soqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function checkDate(d: string, label: string): void {
  if (!ISO_DATE_RE.test(d)) throw new RangeError(`Invalid ${label}: "${d}" (expected YYYY-MM-DD)`);
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
  sp.set("$order", params.order ?? "report_date_as_yyyy_mm_dd DESC");
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

  const url = `${base}/resource/${datasetId}.json?${sp.toString()}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.appToken) headers["X-App-Token"] = opts.appToken;
  const res = await doFetch(url, { headers });
  if (!res.ok) throw new CotError(res.status, url);
  return (await res.json()) as CotRow[];
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

/**
 * The single most recent report row for a market in a report family.
 * Returns null if the market matches nothing.
 */
export async function latestForMarket(
  report: CotReport,
  market: string,
  include: CotInclude = "futures-only",
  opts: CotOptions = {},
): Promise<CotRow | null> {
  const rows = await request(
    resolveDataset(report, include),
    { market, limit: 1, order: "report_date_as_yyyy_mm_dd DESC" },
    opts,
  );
  return rows[0] ?? null;
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
