import type {ApiFetchFn} from "@bio-mcp/shared/codemode/catalog";
import {fail, readJson, record} from "./ng-http";

const BASE = "https://query-api.iedb.org";
const tables = new Set(["/epitope_export", "/reference_export", "/mhc_search", "/mhc_ligand_search"]);
export function isQueryDiscoveryPath(path: string): boolean {
  return path.startsWith("/query/") || tables.has(path) || path.startsWith("/epitope/") || path.startsWith("/reference/");
}

function pageUrl(path: string, params: Record<string, unknown>): URL {
  const url = new URL(path, BASE);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) fail(`IQ-API parameter ${key} must be a string or finite number`);
    url.searchParams.set(key, String(value));
  }
  const limit = url.searchParams.get("limit") ?? "100";
  const offset = url.searchParams.get("offset") ?? "0";
  if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 1000) fail("IQ-API limit must be 1–1000");
  if (!/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset))) fail("IQ-API offset must be a nonnegative safe integer");
  url.searchParams.set("limit", limit);
  url.searchParams.set("offset", offset);
  if (url.href.length > 16000) fail("IQ-API query exceeds 16000 characters");
  return url;
}

/** Schema-backed IQ-API reads; prediction submissions retain their separate transport. */
export const queryDiscoveryFetch: ApiFetchFn = async request => {
  if (request.method !== "GET" || request.body !== undefined) fail("IQ-API discovery and export reads require GET without a body");
  const params = request.params ?? {};
  if (request.path === "/query/schema") {
    return await readQuerySchema(params);
  }
  let path = request.path === "/mhc_ligand_search" ? "/mhc_search" : request.path;
  let effective = {...params};
  let identity: {field: string; id: string} | undefined;
  if (path.startsWith("/epitope/") || path.startsWith("/reference/")) {
    const parts = path.split("/");
    if (parts.length !== 3 || !/^[1-9]\d*$/.test(parts[2]) || !Number.isSafeInteger(Number(parts[2]))) fail("Supply one positive safe-integer IEDB identifier");
    if (Object.keys(params).length) fail("ID detail helpers accept no query parameters; use the native export table for filters and paging");
    identity = {field: parts[1] === "epitope" ? "structure_id" : "reference_id", id: parts[2]};
    path = parts[1] === "epitope" ? "/epitope_export" : "/reference_export";
    effective = {[identity.field]: `eq.${identity.id}`};
  }
  const metrics = path === "/query/metrics";
  if (metrics) path = "/api_metrics";
  else if (!tables.has(path)) fail("Unknown IQ-API discovery route", 404);
  const url = pageUrl(path, effective);
  const result = await readJson(url);
  if (!Array.isArray(result.data)) fail("IQ-API table response must be an array", 502, {...result.provenance, provider_response: result.data});
  if (result.data.length > Number(url.searchParams.get("limit"))) fail("IQ-API returned more rows than the requested page limit", 502, {...result.provenance, provider_response: result.data});
  const expected = identity;
  if (expected && result.data.some(row => !record(row) || !["string", "number"].includes(typeof row[expected.field]) || String(row[expected.field]) !== expected.id)) fail("IQ-API export response does not match the requested identifier", 502, {...result.provenance, provider_response: result.data});
  if (!metrics) return {status: result.status, data: result.data};
  return {status: result.status, data: {data: result.data, _mcp: {...result.provenance,
    resource_kind: "query_metrics", complete: false, immutable_snapshot: false,
    note: "One page of provider table counts and creation/update metadata, preserved verbatim. These dates do not pin a historical snapshot, prove synchronized table updates or identify prediction-model versions. Use limit/offset for further pages; a short page does not certify completeness.",
  }}};
};

async function readQuerySchema(params: Record<string, unknown>) {
  if (Object.keys(params).length) fail("Query schema discovery accepts no parameters");
  const result = await readJson(new URL(`${BASE}/docs/swagger/iedb_api.json`));
  if (!record(result.data) || !record(result.data.paths) || (typeof result.data.swagger !== "string" && typeof result.data.openapi !== "string")) fail("IEDB returned no recognizable Query API schema", 502, { ...result.provenance, provider_response: result.data });
  return {
    status: result.status, data: {
      data: result.data, _mcp: {
        ...result.provenance,
        resource_kind: "query_schema", immutable_snapshot: false,
        note: "Published IQ-API schema, not the Next-Generation prediction schema or a data release. Some search-table definitions omit column/filter details; omitted fields are not proof of unsupported filters. Native definitions and references are retained.",
      }
    }
  };
}
