// Rows from the live CFTC Socrata API (publicreporting.cftc.gov), fetched 2026-10-10
// (selected columns only; values verbatim).
//   goldLatest — Disaggregated combined (kh3c-gbw2), report 2026-10-06, market like '%GOLD%':
//                the contains-match returns GOLD, MICRO GOLD, … on the same date
//   tenYear2022 — TFF futures-only (gpe5-46if), report 2022-02-01, market like '%10-YEAR%':
//                two markets, neither named exactly "10-YEAR"
export const goldLatest = [
  {
    "market_and_exchange_names": "GOLD - COMMODITY EXCHANGE INC.",
    "report_date_as_yyyy_mm_dd": "2026-10-06T00:00:00.000",
    "contract_market_name": "GOLD",
    "cftc_contract_market_code": "088691",
    "open_interest_all": "527641",
    "m_money_positions_long_all": "130247",
    "m_money_positions_short_all": "15427"
  },
  {
    "market_and_exchange_names": "MICRO GOLD - COMMODITY EXCHANGE INC.",
    "report_date_as_yyyy_mm_dd": "2026-10-06T00:00:00.000",
    "contract_market_name": "MICRO GOLD",
    "cftc_contract_market_code": "088695",
    "open_interest_all": "101297",
    "m_money_positions_long_all": "241",
    "m_money_positions_short_all": "0"
  }
];

export const tenYear2022 = [
  {
    "market_and_exchange_names": "10-YEAR U.S. TREASURY NOTES - CHICAGO BOARD OF TRADE",
    "report_date_as_yyyy_mm_dd": "2022-02-01T00:00:00.000",
    "contract_market_name": "UST 10Y NOTE",
    "cftc_contract_market_code": "043602",
    "open_interest_all": "3932501"
  },
  {
    "market_and_exchange_names": "ULTRA 10-YEAR U.S. T-NOTES - CHICAGO BOARD OF TRADE",
    "report_date_as_yyyy_mm_dd": "2022-02-01T00:00:00.000",
    "contract_market_name": "ULTRA UST 10Y",
    "cftc_contract_market_code": "043607",
    "open_interest_all": "1376130"
  }
];
