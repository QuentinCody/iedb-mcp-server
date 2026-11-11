import {afterEach, expect, it, vi} from "vitest";
import {readQueryLink} from "./query-link";
const json = (data: unknown) => new Response(JSON.stringify(data), {headers: {"Content-Type": "application/json", "Content-Range": "0-0/*"}});
afterEach(() => vi.unstubAllGlobals());
it("retains exported duplicate filters and records a bounded effective query", async () => {
  const rows = [{assay_id: 1, qualitative_measure: "Positive", extra: null}];
  const fetcher = vi.fn().mockResolvedValue(json(rows)); vi.stubGlobal("fetch", fetcher);
  const url = "https://query-api.iedb.org/tcell_search?assay_id=gt.1&assay_id=lt.10&order=assay_id.asc";
  const result = await readQueryLink({url});
  const actual = new URL(fetcher.mock.calls[0][0]); expect(actual.searchParams.getAll("assay_id")).toEqual(["gt.1", "lt.10"]);
  expect(actual.searchParams.get("order")).toBe("assay_id.asc"); expect(actual.searchParams.get("limit")).toBe("100");
  expect(result).toMatchObject({data: rows, _mcp: {requested_url: url, default_limit_applied: true, content_range: "0-0/*", complete: false, immutable_snapshot: false, response_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)}});
});
it("retains an explicit limit and offset without pretending an empty page proves completeness", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json([])));
  expect(await readQueryLink({url: "https://query-api.iedb.org/mhc_search?limit=10&offset=20"})).toMatchObject({data: [], _mcp: {default_limit_applied: false, complete: false}});
});
it.each([
  "http://query-api.iedb.org/tcell_search", "https://elsewhere.example/tcell_search", "https://query-api.iedb.org@elsewhere.example/tcell_search",
  "https://user:password@query-api.iedb.org/tcell_search", "https://query-api.iedb.org/tcell_search#fragment", "https://query-api.iedb.org/rpc/write",
  "https://query-api.iedb.org/tcell_search?limit=0", "https://query-api.iedb.org/tcell_search?limit=1001", "https://query-api.iedb.org/tcell_search?limit=10&limit=20",
  "https://query-api.iedb.org/tcell_search?offset=-1",
])("rejects invalid exported links before network: %s", async url => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(readQueryLink({url})).rejects.toMatchObject({status: 400}); expect(fetcher).not.toHaveBeenCalled();
});
it("rejects provider error envelopes rather than treating them as rows", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({message: "not a table"})));
  await expect(readQueryLink({url: "https://query-api.iedb.org/tcell_search"})).rejects.toMatchObject({status: 502});
});
