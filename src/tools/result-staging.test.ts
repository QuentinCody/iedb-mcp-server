import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@bio-mcp/shared/mcp";
import { DynamicWorkerExecutor } from "@bio-mcp/shared/codemode/execute-tool";
import { registerCodeMode } from "./code-mode";
import { registerQueryData } from "./query-data";
import { registerGetSchema } from "./get-schema";
import { iedbResponse } from "../lib/tool-result";
import {verifyCitationEnvelope} from "@bio-mcp/shared";

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const stored: unknown[] = [];
  const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === "/process") {
      const { data } = await request.json() as { data: unknown };
      stored.push(typeof data === "string" ? JSON.parse(data) : data);
      return Response.json({ success: true, tables_created: ["payloads"], total_rows: 1 });
    }
    if (path === "/query") return Response.json({ success: true, results: [{ native_text: "α".repeat(22000) }], row_count: 1 });
    return Response.json({ success: true, schema: { tables: { rows: { columns: [{ name: "text", description: "α".repeat(22000) }] } } } });
  } }) };
  const env = { IEDB_DATA_DO: namespace, CODE_MODE_LOADER: { get: () => ({}) } } as unknown as Parameters<typeof registerCodeMode>[1];
  const server = new McpServer({ name: "fixture", version: "1" });
  registerCodeMode(server, env); registerQueryData(server, env); registerGetSchema(server, env);
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<Record<string, unknown>> }> })._registeredTools;
  return { stored, env, tools };
}

it.each(["", "mcp_"])("stages a composed isolate result below 100KB through %s execution", async prefix => {
  const { tools, stored } = fixture();
  const native = { observations: [{ source: "fixture", text: "α".repeat(22000), values: [0, null, "0001"] }] };
  // Only V8 is replaced; final result handling, citation, registration and staging are real.
  vi.spyOn(DynamicWorkerExecutor.prototype, "execute").mockResolvedValue({ result: native });
  const result = await tools[`${prefix}iedb_execute`].handler({ code: "return composed;" }, {});
  expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true, staged: true, _staging: expect.any(Object), _meta: { citation: { result_hash: expect.any(String) } } } });
  expect(stored).toContainEqual(expect.objectContaining({ structuredContent: expect.objectContaining({ data: native }) }));
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30000);
});

it.each(["iedb_query_data", "mcp_iedb_query_data", "iedb_get_schema", "mcp_iedb_get_schema"])("keeps complete large SQL/schema output recoverable through %s", async name => {
  const { tools, stored } = fixture();
  const result = await tools[name].handler({ data_access_id: "fixture", sql: "SELECT native_text FROM rows" }, {});
  expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true, staged: true, _staging: expect.any(Object) } });
  expect(JSON.stringify(stored)).toContain("α".repeat(22000));
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30000);
});

it("retains failure state and full error evidence when staging", async () => {
  const { env, stored } = fixture();
  const original = { content: [{ type: "text" as const, text: "error evidence" }], structuredContent: { success: false, error: { message: "α".repeat(22000) } } };
  expect(await iedbResponse(async () => original, env, "iedb_execute", {})).toMatchObject({ isError: true, structuredContent: { success: false, staged: true } });
  expect(stored).toContainEqual(expect.objectContaining({ ...original, structuredContent: expect.objectContaining(original.structuredContent), isError: true }));
});

it("fails explicitly when an oversized response cannot be staged", async () => {
  expect(await iedbResponse(async () => ({ content: [{ type: "text", text: "α".repeat(22000) }] }), {}, "iedb_execute", {})).toMatchObject({ isError: true, content: expect.any(Array), structuredContent: { success: false, error: { code: "RESPONSE_ERROR" } } });
});

it("cites thrown native errors with the original tool arguments", async () => {
  const args = {code: "return await api.post('/ng/pipeline/validate', draft);"};
  const native = {provider_response: {errors: ["unavailable"]}, submission_state_unknown: false};
  const result = await iedbResponse(async () => {throw Object.assign(new Error("Metadata unavailable"), {status: 503, data: native});}, {}, "mcp_iedb_execute", {}, args);
  expect(result).toMatchObject({isError: true, structuredContent: {success: false, data: native}});
  const structured = result.structuredContent as any;
  expect((await verifyCitationEnvelope({citation: structured._meta.citation, structuredContent: structured, toolArguments: args})).verification).toMatchObject({query: "verified", result: "verified"});
});

it("binds staged citations to the complete stored envelope", async () => {
  const {env, stored} = fixture(); const args = {sql: "SELECT native_text FROM rows", data_access_id: "fixture"};
  const result = await iedbResponse(async () => ({content: [{type: "text", text: "native"}], structuredContent: {success: true, data: {rows: [{text: "α😀".repeat(15000)}]}}}), env, "iedb_query_data", {}, args);
  const structured = result.structuredContent as any;
  expect(structured._meta.citation.result_scope).toBe("staged:full_result");
  expect((await verifyCitationEnvelope({citation: structured._meta.citation, structuredContent: structured, toolArguments: args, materialized: {value: stored[0]}})).verification).toMatchObject({query: "verified", result: "verified"});
});
