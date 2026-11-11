import {fail, readJson} from "./ng-http";
export async function readQueryLink(params: Record<string, unknown>) {
  if (Object.keys(params).some(key => key !== "url") || typeof params.url !== "string" || params.url.length > 16000) fail("Supply one bounded exported IQ-API url");
  let url: URL;
  try { url = new URL(params.url); } catch { fail("Invalid IQ-API URL"); }
  if (url.origin !== "https://query-api.iedb.org" || url.username || url.password || url.hash || !/^\/[a-z][a-z0-9_]*$/.test(url.pathname)) fail("Only HTTPS IQ-API table URLs are supported");
  const limits = url.searchParams.getAll("limit");
  if (limits.length > 1 || limits.length && (!/^\d+$/.test(limits[0]) || Number(limits[0]) < 1 || Number(limits[0]) > 1000)) fail("Query link limit must be 1–1000");
  const offsets = url.searchParams.getAll("offset");
  if (offsets.length > 1 || offsets.length && (!/^\d+$/.test(offsets[0]) || !Number.isSafeInteger(Number(offsets[0])))) fail("Invalid query link offset");
  if (!limits.length) url.searchParams.set("limit", "100");
  const result = await readJson(url);
  if (!Array.isArray(result.data)) fail("IQ-API table response must be an array", 502);
  return {data: result.data, _mcp: {...result.provenance, requested_url: params.url, effective_url: url.href,
    default_limit_applied: !limits.length, complete: false, immutable_snapshot: false,
    note: "This is one bounded page of a mutable query, not a frozen dataset. All exported filters, duplicate keys and ordering survive. Retain api_metrics separately for available update context; a short page does not establish complete coverage.",
  }};
}
