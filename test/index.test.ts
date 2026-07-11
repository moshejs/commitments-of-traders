import { describe, expect, it, vi } from "vitest";
import {
  CotError,
  DATASETS,
  getCotReport,
  latestForMarket,
  num,
  queryDataset,
} from "../src/index.js";

function mockFetch(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
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
    expect(url(f)).toContain("$order=report_date_as_yyyy_mm_dd DESC");
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
    expect(url(f)).toContain("$limit=1");
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
