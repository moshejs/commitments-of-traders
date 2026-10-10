import { describe, expect, it, vi } from "vitest";
import {
  CotError,
  DATASETS,
  getCotReport,
  latestForMarket,
  num,
  queryDataset,
} from "../src/index.js";
import { goldLatest, tenYear2022 } from "./fixtures.js";

function mockFetch(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  })) as unknown as typeof fetch;
}

function url(f: unknown, call = 0): string {
  // URLSearchParams encodes spaces as "+"; normalize before decoding.
  const raw = (f as ReturnType<typeof vi.fn>).mock.calls[call]![0] as string;
  return decodeURIComponent(raw.replace(/\+/g, " "));
}

const ROW = {
  market_and_exchange_names: "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE",
  report_date_as_yyyy_mm_dd: "2026-07-07T00:00:00.000",
  noncomm_positions_long_all: "123456",
  open_interest_all: "2000000",
};

describe("dataset routing", () => {
  it("maps every report family × include to the right resource id", () => {
    expect(DATASETS.legacy["futures-only"]).toBe("6dca-aqww");
    expect(DATASETS.legacy.combined).toBe("jun7-fc8e");
    expect(DATASETS.disaggregated["futures-only"]).toBe("72hh-3qpy");
    expect(DATASETS.disaggregated.combined).toBe("kh3c-gbw2");
    expect(DATASETS.tff["futures-only"]).toBe("gpe5-46if");
    expect(DATASETS.tff.combined).toBe("yw9f-hn96");
  });

  it("getCotReport hits the resolved dataset URL", async () => {
    const f = mockFetch([ROW]);
    await getCotReport("disaggregated", "combined", { limit: 5 }, { fetch: f });
    expect(url(f)).toContain("/resource/kh3c-gbw2.json?");
    expect(url(f)).toContain("$limit=5");
    expect(url(f)).toContain(
      "$order=report_date_as_yyyy_mm_dd DESC, market_and_exchange_names ASC, id ASC",
    );
  });

  it("rejects unknown report/include", async () => {
    const f = mockFetch([]);
    await expect(getCotReport("bogus" as never, "futures-only", {}, { fetch: f })).rejects.toThrow(
      RangeError,
    );
  });
});

describe("SoQL construction", () => {
  it("builds a case-insensitive market contains-filter", async () => {
    const f = mockFetch([ROW]);
    await getCotReport("legacy", "futures-only", { market: "E-MINI S&P 500" }, { fetch: f });
    expect(url(f)).toContain(
      "$where=upper(market_and_exchange_names) like upper('%E-MINI S&P 500%')",
    );
  });

  it("escapes single quotes in market names", async () => {
    const f = mockFetch([]);
    await getCotReport("legacy", "futures-only", { market: "WHEAT-SRW O'HARE" }, { fetch: f });
    expect(url(f)).toContain("O''HARE");
  });

  it("ANDs date bounds, contract code, and raw where", async () => {
    const f = mockFetch([]);
    await getCotReport(
      "legacy",
      "futures-only",
      {
        contractMarketCode: "13874A",
        since: "2026-01-01",
        until: "2026-07-07",
        where: "open_interest_all > 1000000",
      },
      { fetch: f },
    );
    const u = url(f);
    expect(u).toContain("cftc_contract_market_code = '13874A'");
    expect(u).toContain("report_date_as_yyyy_mm_dd >= '2026-01-01T00:00:00.000'");
    expect(u).toContain("report_date_as_yyyy_mm_dd <= '2026-07-07T23:59:59.999'");
    expect(u).toContain("(open_interest_all > 1000000)");
    expect(u.match(/ AND /g)).toHaveLength(3);
  });

  it("passes select and offset through", async () => {
    const f = mockFetch([]);
    await getCotReport(
      "legacy",
      "futures-only",
      { select: ["market_and_exchange_names", "open_interest_all"], offset: 100 },
      { fetch: f },
    );
    expect(url(f)).toContain("$select=market_and_exchange_names,open_interest_all");
    expect(url(f)).toContain("$offset=100");
  });

  it("sends an app token header when provided", async () => {
    const f = mockFetch([]);
    await getCotReport("legacy", "futures-only", {}, { fetch: f, appToken: "TOK" });
    const init = (f as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-App-Token"]).toBe("TOK");
  });
});

describe("latestForMarket", () => {
  it("returns the row, limit 1, newest first", async () => {
    const f = mockFetch([ROW]);
    const row = await latestForMarket("legacy", "E-MINI S&P 500", "futures-only", { fetch: f });
    expect(row?.market_and_exchange_names).toContain("E-MINI S&P 500");
    expect(url(f)).toContain("$limit=100");
  });

  it("returns null when nothing matches", async () => {
    const f = mockFetch([]);
    expect(await latestForMarket("legacy", "NOTHING", "futures-only", { fetch: f })).toBeNull();
  });
});

describe("errors, validation, and helpers", () => {
  it("throws CotError with status on non-2xx", async () => {
    const f = mockFetch("bad", 429);
    await expect(queryDataset("6dca-aqww", {}, { fetch: f })).rejects.toMatchObject({
      name: "CotError",
      status: 429,
    });
    await expect(queryDataset("6dca-aqww", {}, { fetch: f })).rejects.toBeInstanceOf(CotError);
  });

  it("rejects bad limit/offset/date", async () => {
    const f = mockFetch([]);
    await expect(queryDataset("x", { limit: 0 }, { fetch: f })).rejects.toThrow(RangeError);
    await expect(queryDataset("x", { limit: 99999 }, { fetch: f })).rejects.toThrow(RangeError);
    await expect(queryDataset("x", { offset: -1 }, { fetch: f })).rejects.toThrow(RangeError);
    await expect(getCotReport("legacy", "futures-only", { since: "bad" }, { fetch: f })).rejects.toThrow(
      RangeError,
    );
  });

  it("num parses numeric strings and nulls the rest", () => {
    expect(num("123456")).toBe(123456);
    expect(num("")).toBeNull();
    expect(num("  ")).toBeNull();
    expect(num(undefined)).toBeNull();
  });
});

describe("latestForMarket disambiguation (live-response fixtures)", () => {
  it('"GOLD" resolves to GOLD, not MICRO GOLD, whatever order the server returns ties in', async () => {
    const micro = goldLatest.find((r) => r.market_and_exchange_names.startsWith("MICRO"))!;
    const gold = goldLatest.find((r) => r.market_and_exchange_names.startsWith("GOLD"))!;
    for (const rows of [[micro, gold], [gold, micro]]) {
      const row = await latestForMarket("disaggregated", "GOLD", "combined", { fetch: mockFetch(rows) });
      expect(row!.market_and_exchange_names).toBe("GOLD - COMMODITY EXCHANGE INC.");
      expect(row!.cftc_contract_market_code).toBe("088691");
    }
  });

  it("throws a RangeError listing candidates when still ambiguous", async () => {
    await expect(
      latestForMarket("tff", "10-YEAR", "futures-only", { fetch: mockFetch(tenYear2022) }),
    ).rejects.toThrow(/ambiguous.*043602.*043607/);
  });

  it("returns the only latest-date match even when older rows differ", async () => {
    const newer = { ...goldLatest[0]!, report_date_as_yyyy_mm_dd: "2026-10-13T00:00:00.000" };
    const row = await latestForMarket("disaggregated", "GOLD", "combined", {
      fetch: mockFetch([newer, ...goldLatest]),
    });
    expect(row!.report_date_as_yyyy_mm_dd).toBe("2026-10-13T00:00:00.000");
  });

  it("accepts { contractMarketCode }", async () => {
    const f = mockFetch([goldLatest[0]]);
    await latestForMarket("disaggregated", { contractMarketCode: "088691" }, "combined", { fetch: f });
    expect(url(f)).toContain("$where=cftc_contract_market_code = '088691'");
    expect(url(f)).toContain("$limit=1");
  });
});

describe("hardening", () => {
  it("includes Socrata's error message; wraps non-JSON and non-array bodies", async () => {
    const f = mockFetch({ message: "Query coordinator error: query.soql.no-such-column" }, 400);
    await expect(queryDataset("6dca-aqww", {}, { fetch: f })).rejects.toThrow(/HTTP 400.*no-such-column/);
    await expect(queryDataset("6dca-aqww", {}, { fetch: mockFetch("<html>", 200) })).rejects.toThrow(
      /non-JSON/,
    );
    await expect(queryDataset("6dca-aqww", {}, { fetch: mockFetch({ error: true }) })).rejects.toBeInstanceOf(
      CotError,
    );
  });

  it("rejects malformed dataset ids, impossible dates and reversed ranges", async () => {
    const f = mockFetch([]);
    await expect(queryDataset("../views/x", {}, { fetch: f })).rejects.toThrow(/dataset id/);
    await expect(getCotReport("legacy", "futures-only", { since: "2026-02-30" }, { fetch: f })).rejects.toThrow(
      RangeError,
    );
    await expect(
      getCotReport("legacy", "futures-only", { since: "2026-07-01", until: "2026-01-01" }, { fetch: f }),
    ).rejects.toThrow(/after until/);
  });

  it("honors timeoutMs and trims a trailing baseUrl slash", async () => {
    const f = mockFetch([]);
    await queryDataset("6dca-aqww", {}, { fetch: f, baseUrl: "https://proxy.local/", timeoutMs: 1000 });
    expect(url(f)).toMatch(/^https:\/\/proxy\.local\/resource\/6dca-aqww\.json\?/);
    const hang = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    ) as unknown as typeof fetch;
    await expect(queryDataset("6dca-aqww", {}, { fetch: hang, timeoutMs: 20 })).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });
});
