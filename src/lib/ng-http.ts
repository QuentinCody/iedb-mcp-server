export function fail(message: string, status = 400, data?: unknown): never {
  throw Object.assign(new Error(message), {status, data: {incomplete: true, ...(data && typeof data === "object" ? data : {})}});
}
export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export async function readJson(url: URL, init: RequestInit = {}, options: {requireCompleteResponse?: boolean} = {}) {
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const controller = new AbortController();
  const context = () => ({source_url: url.href, http_status: response?.status ?? null,
    retry_after: response?.headers.get("Retry-After") ?? null, submission_state_unknown: init.method === "POST"});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("IEDB request/body exceeded 50 seconds")); }, 50000);
  });
  const receive = async () => {
    response = await fetch(url, {...init, headers: {Accept: "application/json", "Content-Type": "application/json"}, redirect: "manual", signal: controller.signal});
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new Error("IEDB request exceeded its deadline"); }
    if (Number(response.headers.get("Content-Length")) > 4 * 1024 * 1024) {
      void response.body?.cancel().catch(() => {}); throw new Error("IEDB response exceeds 4 MiB");
    }
    reader = response.body?.getReader();
    return await readPredictionText(reader, response);
  };
  let received: Awaited<ReturnType<typeof receive>>;
  try {
    received = await Promise.race([receive(), expired]);
  } catch (error) {
    fail(`IEDB response unavailable: ${error instanceof Error ? error.message : "read failed"}. Do not automatically resubmit.`,
      response && !response.ok ? response.status : 502, {...context(), native_body_complete: false});
  } finally {
    clearTimeout(timer); controller.abort(); void reader?.cancel().catch(() => {});
  }
  return await decodePredictionEvidence(received, url, context, options);
}

async function readPredictionText(reader: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>> | undefined, response: Response) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let raw = ""; let bytes = 0;
  while (reader) {
    const { done, value } = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > 4 * 1024 * 1024) throw new Error("IEDB response exceeds 4 MiB");
    raw += decoder.decode(value, { stream: true });
  }
  return { raw: raw + decoder.decode(), bytes, response };
}

async function decodePredictionEvidence(received: { raw: string; bytes: number; response: Response; }, url: URL, context: () => { source_url: string; http_status: number | null; retry_after: string | null; submission_state_unknown: boolean; }, options: { requireCompleteResponse?: boolean; }) {
  const { raw, bytes } = received;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const provenance = {
    source_url: url.href, retrieved_at: new Date().toISOString(),
    response_sha256: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join(""),
    http_status: received.response.status, decoded_bytes: bytes, content_type: received.response.headers.get("Content-Type"),
    content_range: received.response.headers.get("Content-Range"), retry_after: received.response.headers.get("Retry-After")
  };
  let data: unknown;
  let validJson = true;
  try { data = JSON.parse(raw); } catch { data = raw; validJson = false; }
  const evidence = { ...context(), ...provenance, provider_response: data, native_text: raw, native_body_complete: true };
  if (!received.response.ok) fail(`IEDB HTTP ${received.response.status}`, received.response.status, evidence);
  // IQ-API row pagination legitimately uses 206; Next-Generation objects require full responses.
  if (options.requireCompleteResponse && (received.response.status === 206 || received.response.headers.has("Content-Range"))) fail("Partial IEDB JSON response cannot establish complete metadata or results", 502, evidence);
  if (!validJson) fail("Invalid IEDB JSON response", 502, evidence);
  return { data, status: received.response.status, provenance };
}
