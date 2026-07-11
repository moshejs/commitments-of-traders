# commitments-of-traders

Typed, zero-dependency client for the **CFTC Commitments of Traders (COT)** reports — Legacy, Disaggregated, and Traders in Financial Futures, futures-only or combined — via the official [Socrata API](https://publicreporting.cftc.gov/). **No API key required.**

```
npm install commitments-of-traders
```

## Why

The weekly COT report is one of the most-watched positioning datasets in futures and FX — how commercials, large speculators, and managed money are positioned across every US futures market. The CFTC publishes it through a free Socrata API, but building the SoQL queries (market filters, date ranges, the six different report datasets) by hand is tedious, and npm had no client library — only an MCP server. This is the library.

```ts
import { getCotReport, latestForMarket, num } from "commitments-of-traders";

// Latest E-mini S&P 500 large-speculator positioning:
const es = await latestForMarket("legacy", "E-MINI S&P 500");
const net = num(es.noncomm_positions_long_all) - num(es.noncomm_positions_short_all);

// Managed-money gold positioning (disaggregated, futures + options):
const gold = await getCotReport("disaggregated", "combined", { market: "GOLD", limit: 1 });
num(gold[0].m_money_positions_long_all);

// A full year of one market, with a raw SoQL filter ANDed in:
const history = await getCotReport("tff", "futures-only", {
  market: "10-YEAR U.S. TREASURY",
  since: "2025-01-01",
  where: "open_interest_all > 1000000",
});
```

## Reports

All three families, in both futures-only and combined (futures + options) forms — six datasets, all wired up:

| `report` | `include: "futures-only"` | `include: "combined"` |
| --- | --- | --- |
| `"legacy"` | Legacy — Futures Only | Legacy — Combined |
| `"disaggregated"` | Disaggregated — Futures Only | Disaggregated — Combined |
| `"tff"` | TFF — Futures Only | TFF — Combined |

(The exact Socrata resource IDs are exported as `DATASETS` and were verified against publicreporting.cftc.gov.)

## API

Every function takes an optional final `options`: `{ fetch?, baseUrl?, appToken? }` — inject `fetch` for tests, or a Socrata app token to raise rate limits (not required).

- **`getCotReport(report, include?, params?)`** — query a report family (`include` defaults to `"futures-only"`).
- **`latestForMarket(report, market, include?)`** — the single most recent row for a market, or `null`.
- **`queryDataset(datasetId, params?)`** — query by raw Socrata id.
- **`num(value)`** — Socrata returns every column as a string; `num` converts to `number | null`.

**`params`**: `market` (case-insensitive contains-match), `contractMarketCode`, `since` / `until` (YYYY-MM-DD), `where` (raw SoQL, ANDed in), `select`, `order`, `limit`, `offset`. Market names and codes are safely escaped. Failures throw `CotError` with `status` and `url`.

Rows are typed for the always-present identity columns (market, report date, codes, open interest) with an index signature for the hundreds of position columns that vary by report family. The mocked test suite runs offline; `npm run smoke` exercises the live API.

## Related

By the same author, a fixed-income & markets toolkit: [`treasurydirect`](https://github.com/moshejs/treasurydirect) · [`treasury-fiscaldata`](https://github.com/moshejs/treasury-fiscaldata) · [`newyorkfed`](https://github.com/moshejs/newyorkfed) · [`tbill`](https://github.com/moshejs/tbill) · [`compounded-sofr`](https://github.com/moshejs/compounded-sofr) · [`instrument-identifiers`](https://github.com/moshejs/instrument-identifiers) · [`32nds`](https://github.com/moshejs/32nds).

## Author

Built by **[Moshe Malka](https://moshemalka.com)** — engineering leader in New York City. Studio work at [Quentin.Code](https://www.quentin.software/).

MIT © Moshe Malka
