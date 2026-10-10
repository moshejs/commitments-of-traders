# commitments-of-traders

Typed, zero-dependency client for the **CFTC Commitments of Traders (COT)** reports — Legacy, Disaggregated, and Traders in Financial Futures, futures-only or combined — via the official [Socrata API](https://publicreporting.cftc.gov/). **No API key required.**

```
npm install commitments-of-traders
```

## Why

The weekly COT report is one of the most-watched positioning datasets in futures and FX — how commercials, large speculators, and managed money are positioned across every US futures market. The CFTC publishes it through a free Socrata API, but building the SoQL queries (market filters, date ranges, the six different report datasets) by hand is tedious, and npm had no client library — only an MCP server. This is the library.

```ts
import { getCotReport, latestForMarket, num } from "commitments-of-traders";

// Latest E-mini S&P 500 large-speculator positioning
// ("E-MINI S&P 500" also matches MICRO E-MINI; the exact name wins):
const es = await latestForMarket("legacy", "E-MINI S&P 500");
const net = num(es.noncomm_positions_long_all) - num(es.noncomm_positions_short_all);

// Managed-money gold positioning (disaggregated, futures + options):
const gold = await latestForMarket("disaggregated", "GOLD", "combined");
num(gold.m_money_positions_long_all);

// History of one market: use its contract market code, which survives the
// CFTC's Feb 2022 renames ("10-YEAR U.S. TREASURY NOTES" → "UST 10Y NOTE"):
const history = await getCotReport("tff", "futures-only", {
  contractMarketCode: "043602",
  since: "2025-01-01",
  where: "open_interest_all > 1000000", // raw SoQL, ANDed in
});
num(history[0].lev_money_positions_long); // TFF columns have no _all suffix
```

## Reports

All three families, in both futures-only and combined (futures + options) forms — six datasets, all wired up:

| `report` | `include: "futures-only"` | `include: "combined"` |
| --- | --- | --- |
| `"legacy"` | Legacy — Futures Only | Legacy — Combined |
| `"disaggregated"` | Disaggregated — Futures Only | Disaggregated — Combined |
| `"tff"` | TFF — Futures Only | TFF — Combined |

(The exact Socrata resource IDs are exported as `DATASETS`. Each was checked against the dataset's title on publicreporting.cftc.gov, and the 2026 rows of all six were cross-checked against the CFTC's own annual text files at cftc.gov/files/dea/history: identical row counts, no value mismatches.)

## API

Every function takes an optional final `options`: `{ fetch?, baseUrl?, appToken?, timeoutMs?, signal? }` — inject `fetch` for tests, a Socrata app token to raise rate limits (not required), or `timeoutMs`/`signal` to abort (no timeout by default).

- **`getCotReport(report, include?, params?)`** — query a report family (`include` defaults to `"futures-only"`).
- **`latestForMarket(report, market, include?)`** — the single most recent row for one market, or `null`. `market` is a name (contains-match) or `{ contractMarketCode }`. When a name matches several markets in the latest report (e.g. `"GOLD"` → GOLD and MICRO GOLD), the one whose contract market name equals it exactly is returned; otherwise it throws a `RangeError` listing the candidates. If the name only matches a market that has since been renamed, you get its last row under the old name — check `report_date_as_yyyy_mm_dd`.
- **`queryDataset(datasetId, params?)`** — query by raw Socrata id.
- **`num(value)`** — Socrata returns every column as a string; `num` converts to `number | null`.

**`params`**: `market` (case-insensitive contains-match; `%` and `_` act as SoQL wildcards), `contractMarketCode` (exact, stable across renames — the right key for one market's history), `since` / `until` (inclusive YYYY-MM-DD), `where` (raw SoQL, ANDed in — not escaped, so never pass untrusted input here), `select`, `order` (default: report date descending, then market name, then row id — deterministic, so `offset` paging is stable), `limit` (default 1000, max 50000), `offset`. Values passed as `market` and `contractMarketCode` are escaped as SoQL string literals.

**Errors**: non-2xx responses throw `CotError` with `status`, `url`, and Socrata's own message when it sends one (e.g. `No such column`). Non-JSON or non-array bodies also throw `CotError`. Invalid arguments (bad dates, reversed ranges, bad limit/offset, malformed dataset ids) throw `RangeError` before any request.

Rows are typed for the always-present identity columns (market, report date, codes, open interest) with an index signature for the hundreds of position columns that vary by report family. The mocked test suite runs offline; `npm run smoke` exercises the live API.

## Related

By the same author, a fixed-income & markets toolkit: [`treasurydirect`](https://github.com/moshejs/treasurydirect) · [`treasury-fiscaldata`](https://github.com/moshejs/treasury-fiscaldata) · [`newyorkfed`](https://github.com/moshejs/newyorkfed) · [`tbill`](https://github.com/moshejs/tbill) · [`compounded-sofr`](https://github.com/moshejs/compounded-sofr) · [`instrument-identifiers`](https://github.com/moshejs/instrument-identifiers) · [`32nds`](https://github.com/moshejs/32nds).

## Author

Built by **[Moshe Malka](https://moshemalka.com)** — engineering leader in New York City. Studio work at [Quentin.Code](https://www.quentin.software/).

MIT © Moshe Malka
