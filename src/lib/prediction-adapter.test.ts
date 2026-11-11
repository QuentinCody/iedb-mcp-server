import {afterEach, expect, it, vi} from "vitest";
import {createIedbApiFetch} from "./api-adapter";

const api = createIedbApiFetch();
const text = (body: string, contentType = "text/plain") => new Response(body, {headers: {"Content-Type": contentType}});
function stub(response: Response) { const f = vi.fn().mockResolvedValue(response); vi.stubGlobal("fetch", f); return f; }
afterEach(() => vi.unstubAllGlobals());

it.each([
  ["/tools_api/mhci/", "https://tools-cluster-interface.iedb.org/tools_api/mhci/"],
  ["/tools/mhci/", "https://tools-cluster-interface.iedb.org/tools_api/mhci/"],
  ["/mhci/", "https://tools-cluster-interface.iedb.org/tools_api/mhci/"],
])("posts %s to the native Tools API path", async (path, url) => {
  const fetcher = stub(text("allele\tpeptide\tic50\nHLA-A*02:01\tSIINFEKL\t12.5\n"));
  const result = await api({method: "POST", path, body: {method: "recommended", sequence_text: "SIINFEKL", allele: "HLA-A*02:01", length: "9"}});
  expect(String(fetcher.mock.calls[0][0])).toBe(url);
  expect(result).toEqual({status: 200, data: [{allele: "HLA-A*02:01", peptide: "SIINFEKL", ic50: 12.5}]});
});

it.each([
  ["a one-line provider message", "Invalid allele HLA-A*99:99", "text/plain"],
  ["a header-only TSV", "allele\tpeptide\tic50\n", "text/plain"],
  ["an empty body", "", "text/tab-separated-values"],
])("surfaces %s as an upstream error, not an empty success", async (_label, body, contentType) => {
  stub(text(body, contentType));
  await expect(api({method: "POST", path: "/tools_api/mhci/", body: {method: "recommended"}}))
    .rejects.toMatchObject({status: 502, data: {response: body, upstream_status: 200}});
});

it("keeps the provider text in the error message", async () => {
  stub(text("Invalid allele HLA-A*99:99"));
  await expect(api({method: "POST", path: "/mhci/", body: {method: "recommended"}})).rejects.toThrow("Invalid allele HLA-A*99:99");
});
