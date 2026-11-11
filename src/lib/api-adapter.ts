import { type ApiFetchFn, commercialUseRefusal } from "@bio-mcp/shared/codemode/catalog";
import { iedbFetch, iedbToolsPost } from "./http";
import {nextgenFetch} from "./nextgen";
import {readQueryLink} from "./query-link";
import {fail} from "./ng-http";
import {isQueryDiscoveryPath, queryDiscoveryFetch} from "./query-discovery";
import { parseTsv, coerceNumericFields } from "./tsv-parser";

/** Common numeric fields in IEDB Tools API TSV output. */
const NUMERIC_FIELDS = [
    "start", "end", "length", "percentile_rank", "score",
    "ic50", "ann_ic50", "smm_ic50", "comblib_ic50",
    "ann_percentile_rank", "smm_percentile_rank", "comblib_percentile_rank",
    "netmhcpan_ic50", "netmhcpan_percentile_rank",
    "mhcflurry_ic50", "mhcflurry_percentile_rank",
    "proteasome_score", "tap_score", "processing_score", "total_score",
    "position",
];

/**
 * Detect whether a text body looks like TSV (tab-separated values).
 * Heuristic: at least 2 lines, first line has tabs, and most lines have tabs.
 */
function looksLikeTsv(text: string): boolean {
    const lines = text.trim().split("\n");
    if (lines.length < 2) return false;

    // Skip comment lines (starting with #)
    let firstDataLine = 0;
    while (firstDataLine < lines.length && lines[firstDataLine].startsWith("#")) {
        firstDataLine++;
    }
    if (firstDataLine >= lines.length) return false;

    // Header line must have tabs
    return lines[firstDataLine].includes("\t");
}

/** Parse a TSV body into numeric-coerced rows; null when it has no data rows. */
function parseTsvRows(text: string): Record<string, unknown>[] | null {
    const parsed = parseTsv(text);
    if (parsed.rows.length === 0) return null;
    return coerceNumericFields(parsed.rows, NUMERIC_FIELDS);
}

/** Build the adapter's HTTP error (status + body) from a non-OK upstream response. */
async function httpErrorFromResponse(response: Response) {
    let errorBody: string;
    try {
        errorBody = await response.text();
    } catch {
        errorBody = response.statusText;
    }
    const error = new Error(`HTTP ${response.status}: ${errorBody.slice(0, 200)}`) as Error & {
        status: number;
        data: unknown;
    };
    error.status = response.status;
    error.data = errorBody;
    return error;
}

/** POST requests go to the Tools API; TSV responses are auto-parsed to JSON. */
async function predictionFetch(request: Parameters<ApiFetchFn>[0]) {
    const { contentType, text, response } = await readPredictionResponse(request);

    // Auto-parse TSV responses into JSON arrays
    if (looksLikeTsv(text)) {
        const data = parseTsvRows(text);
        if (data) return { status: response.status, data };
    }
    // A text/TSV body with no prediction rows (provider message, header-only
    // or blank body) is a failed prediction, not an empty success.
    if (
        looksLikeTsv(text) ||
        contentType.includes("text/plain") ||
        contentType.includes("text/tab-separated-values")
    ) {
        throw predictionFailure(text, response.status);
    }

    // JSON response from Tools API (some endpoints return JSON)
    if (contentType.includes("json")) {
        try {
            return { status: response.status, data: JSON.parse(text) };
        } catch {
            return { status: response.status, data: text };
        }
    }

    return { status: response.status, data: text };
}

/** GET requests go to the Query API (JSON responses). */
async function queryApiFetch(request: Parameters<ApiFetchFn>[0]) {
    const response = await iedbFetch(request.path, request.params);
    if (!response.ok) throw await httpErrorFromResponse(response);

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("json")) {
        const text = await response.text();

        // Some Query API responses might still be TSV-like
        if (looksLikeTsv(text)) {
            return { status: response.status, data: parseTsvRows(text) ?? [] };
        }

        return { status: response.status, data: text };
    }

    const data = await response.json();
    return { status: response.status, data };
}

/**
 * Create an ApiFetchFn for IEDB Code Mode.
 * - GET requests route to the Query API (JSON responses).
 * - POST requests route to the Tools API (TSV responses auto-parsed to JSON).
 */
export function createIedbApiFetch(): ApiFetchFn {
    return async (request) => {
        // License audit 2026-11-10: the IEDB database is CC BY 4.0. The analysis
        // and prediction tools (/ng/ and every POST) need a license for industry use.
        if (request.licenseProfile === "commercial" && (request.path.startsWith("/ng/") || request.method !== "GET")) {
            return commercialUseRefusal("The IEDB prediction tools", "industry use of the tools needs a license from IEDB; database queries (GET) stay available");
        }
        if (request.path.startsWith("/ng/")) return nextgenFetch(request);
        if (isQueryDiscoveryPath(request.path)) return queryDiscoveryFetch(request);
        if (request.path === "/query-link") {
            if (request.method !== "GET" || request.body !== undefined) fail("Exported query links are read-only");
            return {status: 200, data: await readQueryLink(request.params ?? {})};
        }
        if (!["GET", "POST"].includes(request.method)) fail("IEDB adapter supports GET and explicit prediction POST only");
        if (request.method === "POST" && request.body) return predictionFetch(request);
        return queryApiFetch(request);
    };
}

async function readPredictionResponse(request: Parameters<ApiFetchFn>[0]) {
  const formData: Record<string, string> = {};
  if (typeof request.body === "object" && request.body !== null) {
    for (const [k, v] of Object.entries(request.body as Record<string, unknown>)) {
      formData[k] = String(v);
    }
  }

  // Strip a whole /tools or /tools_api segment — the base URL already ends in /tools_api
  const toolsPath = request.path.replace(/^\/(?:tools_api|tools)(?=\/|$)/, "");

  const response = await iedbToolsPost(toolsPath, formData);

  if (!response.ok) throw await httpErrorFromResponse(response);

  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  return { contentType, text, response };
}

function predictionFailure(text: string, upstreamStatus: number) {
  const body = text.trim();
  const message = body
    ? `IEDB Tools API returned no prediction rows: ${body.slice(0, 200)}`
    : "IEDB Tools API returned an empty prediction response";
  const error = new Error(message) as Error & { status: number; data: unknown };
  error.status = 502;
  error.data = { response: text, upstream_status: upstreamStatus };
  return error;
}
