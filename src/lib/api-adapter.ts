import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { iedbFetch, iedbToolsPost } from "./http";
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

/**
 * Create an ApiFetchFn for IEDB Code Mode.
 * - GET requests route to the Query API (JSON responses).
 * - POST requests route to the Tools API (TSV responses auto-parsed to JSON).
 */
export function createIedbApiFetch(): ApiFetchFn {
    return async (request) => {
        // POST requests go to the Tools API
        if (request.method === "POST" && request.body) {
            const formData: Record<string, string> = {};
            if (typeof request.body === "object" && request.body !== null) {
                for (const [k, v] of Object.entries(request.body as Record<string, unknown>)) {
                    formData[k] = String(v);
                }
            }

            // Strip /tools prefix if present — the base URL already points to the Tools API
            const toolsPath = request.path.startsWith("/tools")
                ? request.path.replace(/^\/tools/, "")
                : request.path;

            const response = await iedbToolsPost(toolsPath, formData);

            if (!response.ok) {
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
                throw error;
            }

            const contentType = response.headers.get("content-type") || "";
            const text = await response.text();

            // Auto-parse TSV responses into JSON arrays
            if (
                contentType.includes("text/plain") ||
                contentType.includes("text/tab-separated-values") ||
                looksLikeTsv(text)
            ) {
                const parsed = parseTsv(text);
                if (parsed.rows.length > 0) {
                    const data = coerceNumericFields(parsed.rows, NUMERIC_FIELDS);
                    return { status: response.status, data };
                }
                // Empty TSV (headers only or blank) — return empty array
                return { status: response.status, data: [] };
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

        // GET requests go to the Query API
        const response = await iedbFetch(request.path, request.params);

        if (!response.ok) {
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
            throw error;
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("json")) {
            const text = await response.text();

            // Some Query API responses might still be TSV-like
            if (looksLikeTsv(text)) {
                const parsed = parseTsv(text);
                if (parsed.rows.length > 0) {
                    const data = coerceNumericFields(parsed.rows, NUMERIC_FIELDS);
                    return { status: response.status, data };
                }
                return { status: response.status, data: [] };
            }

            return { status: response.status, data: text };
        }

        const data = await response.json();
        return { status: response.status, data };
    };
}
