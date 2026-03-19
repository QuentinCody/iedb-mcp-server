import { restFetch } from "@bio-mcp/shared/http/rest-fetch";
import type { RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const TOOLS_API_BASE = "https://tools-cluster-interface.iedb.org/tools_api";
const QUERY_API_BASE = "https://query-api.iedb.org";

export interface IedbFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
    baseUrl?: string;
}

/**
 * Fetch from the IEDB Query API (PostgREST-style JSON).
 */
export async function iedbFetch(
    path: string,
    params?: Record<string, unknown>,
    opts?: IedbFetchOptions,
): Promise<Response> {
    const baseUrl = opts?.baseUrl ?? QUERY_API_BASE;
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(opts?.headers ?? {}),
    };

    return restFetch(baseUrl, path, params, {
        ...opts,
        headers,
        retryOn: [429, 500, 502, 503],
        retries: opts?.retries ?? 3,
        timeout: opts?.timeout ?? 30_000,
        userAgent: "iedb-mcp-server/1.0 (bio-mcp)",
    });
}

/**
 * POST to the IEDB Tools API (prediction endpoints, returns TSV).
 * Uses raw fetch because restFetch JSON-stringifies body, but Tools API needs form-urlencoded.
 */
export async function iedbToolsPost(
    path: string,
    formData: Record<string, string>,
    opts?: IedbFetchOptions,
): Promise<Response> {
    const baseUrl = opts?.baseUrl ?? TOOLS_API_BASE;
    const url = `${baseUrl}${path}`;
    const body = new URLSearchParams(formData);

    return fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "iedb-mcp-server/1.0 (bio-mcp)",
        },
        body: body.toString(),
    });
}
