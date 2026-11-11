import {afterEach, expect, it, vi} from "vitest";
import {readJson} from "./ng-http";

const url = new URL("https://api-nextgen-tools.iedb.org/api/v1/results/result1");
const hash = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), b => b.toString(16).padStart(2, "0")).join("");
function stub(response: Response) {
  const fetcher = vi.fn().mockResolvedValue(response); vi.stubGlobal("fetch", fetcher); return fetcher;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each([400, 422, 429, 503])("retains native HTTP %i validation evidence and never retries submission", async status => {
  const native = {errors: [{field: "input_parameters", message: "Synthetic validation error", value: "α"}], warnings: ["Retain me"], future: {x: null}};
  const raw = JSON.stringify(native, null, 2);
  const expectedHash = await hash(raw);
  const fetcher = stub(new Response(raw, {status, headers: {"Retry-After": "60", "Content-Type": "application/problem+json"}}));
  await expect(readJson(url, {method: "POST", body: "{}"})).rejects.toMatchObject({status, data: {
    provider_response: native, native_text: raw, native_body_complete: true,
    source_url: url.href, http_status: status, response_sha256: expectedHash,
    retry_after: "60", content_type: "application/problem+json", incomplete: true, submission_state_unknown: true,
  }});
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(["<html>Service unavailable</html>", "", "not json"])('preserves non-JSON error body "%s"', async raw => {
  stub(new Response(raw, {status: 502}));
  await expect(readJson(url)).rejects.toMatchObject({status: 502, data: {provider_response: raw, native_text: raw, native_body_complete: true, submission_state_unknown: false}});
});

it("retains malformed successful JSON without claiming a rejected submission", async () => {
  stub(new Response("{unfinished", {status: 202}));
  await expect(readJson(url, {method: "POST"})).rejects.toMatchObject({status: 502, data: {http_status: 202, native_text: "{unfinished", submission_state_unknown: true}});
});

it("does not follow a redirect and retains its native response", async () => {
  const fetcher = stub(new Response('"redirect"', {status: 302, headers: {Location: "https://other.example"}}));
  await expect(readJson(url)).rejects.toMatchObject({status: 302, data: {provider_response: "redirect"}});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]).toMatchObject({redirect: "manual"});
});

it("handles split UTF-8 code points without changing native values or byte hashes", async () => {
  const raw = '{"score":"0.9000","chain":"α","missing":null}';
  const bytes = new TextEncoder().encode(raw);
  stub(new Response(new ReadableStream({start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); }})));
  expect(await readJson(url)).toMatchObject({data: JSON.parse(raw), provenance: {decoded_bytes: bytes.length, response_sha256: await hash(raw)}});
});

it.each([200, 503])("rejects advertised oversized HTTP %i bodies without reading", async status => {
  const cancel = vi.fn(); const body = new ReadableStream({cancel});
  stub(new Response(body, {status, headers: {"Content-Length": String(4 * 1024 * 1024 + 1)}}));
  await expect(readJson(url)).rejects.toMatchObject({status: status === 200 ? 502 : status, data: {native_body_complete: false, http_status: status}});
  expect(cancel).toHaveBeenCalled();
});

it("bounds actual bytes when content-length understates the body", async () => {
  stub(new Response(new Uint8Array(4 * 1024 * 1024 + 1), {headers: {"Content-Length": "1"}}));
  await expect(readJson(url)).rejects.toThrow("4 MiB");
});

it("does not present an invalid UTF-8 body as complete evidence", async () => {
  stub(new Response(Uint8Array.of(0xff), {status: 400}));
  await expect(readJson(url)).rejects.toMatchObject({status: 400, data: {http_status: 400, native_body_complete: false}});
});

it("bounds header wait even if fetch ignores abort", async () => {
  vi.useFakeTimers(); const fetcher = vi.fn(() => new Promise<Response>(() => {})); vi.stubGlobal("fetch", fetcher);
  const outcome = readJson(url, {method: "POST"}).catch(error => error);
  await vi.advanceTimersByTimeAsync(50000);
  expect(await outcome).toMatchObject({status: 502, data: {http_status: null, submission_state_unknown: true, native_body_complete: false}});
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("uses one deadline across headers and a stalled body without awaiting cancellation", async () => {
  vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}));
  const fetcher = vi.fn((_url: URL, _init: RequestInit) => new Promise<Response>(resolve => setTimeout(() => resolve(new Response(new ReadableStream({cancel}), {status: 503, headers: {"Retry-After": "120"}})), 30000)));
  vi.stubGlobal("fetch", fetcher);
  const outcome = readJson(url).catch(error => error);
  await vi.advanceTimersByTimeAsync(49999); expect(cancel).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await outcome).toMatchObject({status: 503, data: {http_status: 503, retry_after: "120", native_body_complete: false}});
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true);
});

it("cancels a late response after header timeout without consuming it", async () => {
  vi.useFakeTimers(); const cancel = vi.fn();
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => setTimeout(() => resolve(new Response(new ReadableStream({cancel}))), 55000))));
  const outcome = readJson(url).catch(error => error);
  await vi.advanceTimersByTimeAsync(50000); expect(await outcome).toMatchObject({status: 502});
  await vi.advanceTimersByTimeAsync(5000); expect(cancel).toHaveBeenCalledTimes(1);
});
