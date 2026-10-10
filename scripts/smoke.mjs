// Live smoke test against the real CFTC Socrata API (not run in CI).
// Usage: npm run smoke
import { getCotReport, latestForMarket, num } from "../dist/index.js";

const latest = await getCotReport("legacy", "futures-only", { limit: 1 });
console.log(`latest legacy report week: ${latest[0]?.report_date_as_yyyy_mm_dd?.slice(0, 10)}`);

const es = await latestForMarket("legacy", "E-MINI S&P 500", "futures-only");
if (es) {
  const long = num(es.noncomm_positions_long_all);
  const short = num(es.noncomm_positions_short_all);
  console.log(`E-MINI S&P 500 non-commercial: long ${long}, short ${short}, net ${long - short}`);
}

const gold = await latestForMarket("disaggregated", "GOLD", "combined");
console.log(`disaggregated ${gold?.market_and_exchange_names} managed-money long: ${num(gold?.m_money_positions_long_all)}`);

const tff = await getCotReport("tff", "futures-only", { contractMarketCode: "043602", limit: 1 });
console.log(`TFF 043602 row: ${tff[0]?.market_and_exchange_names ?? "none"} ${tff[0]?.report_date_as_yyyy_mm_dd?.slice(0, 10)}`);
console.log("SMOKE OK");
