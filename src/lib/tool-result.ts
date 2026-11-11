import {buildCitation} from "@bio-mcp/shared";
import { shouldStage, stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";

type Result = { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean; [key: string]: unknown };
type DataEnv = { IEDB_DATA_DO?: unknown };
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const source = {id: "iedb", name: "Immune Epitope Database (IEDB)", url: "https://www.iedb.org", license: "CC BY 4.0"};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const RESERVE_BYTES = 1024;

async function cite(structured: Record<string, unknown>, toolName: string, query: unknown) {
  const meta = record(structured._meta) ? structured._meta : {};
  if (record(meta.citation)) return structured;
  const {_meta: _metadata, ...root} = structured;
  const citation = await buildCitation({source, server: "iedb", tool: toolName.replace(/^mcp_/, ""), query,
    queryScope: "tool_arguments", result: root, resultScope: "structured_content:root_without_meta", retrievedAt: new Date().toISOString()});
  return {...structured, _meta: {...meta, citation}};
}

export async function iedbResponse(work: () => Promise<Result>, env: DataEnv, toolName: string, extra: unknown, query: unknown = {}): Promise<Result> {
  try {
    const original: Result = await work().catch(error => {
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      const message = status && error instanceof Error ? error.message.slice(0, 500) : "IEDB response could not be returned.";
      return {content: [{type: "text" as const, text: message}], isError: true,
        structuredContent: {success: false, error: {code: status ? "API_ERROR" : "RESPONSE_ERROR", message, status},
          ...(error && typeof error === "object" && "data" in error ? {data: error.data} : {})}};
    });
    const structured = original.structuredContent ?? { success: original.isError !== true };
    const failed = original.isError === true || structured.success === false || (record(structured.data) && structured.data.__api_error === true)
      || Boolean(structured.program_error) || structured.disposition === "partial";
    const result = { ...original, structuredContent: await cite(failed ? {...structured, success: false} : structured, toolName, query), ...(failed ? { isError: true } : {}) };
    if (!shouldStage(bytes(result) + RESERVE_BYTES)) return result;
    return await stageResponse(env, result, toolName, extra, query, failed);
  } catch {
    const structured = { success: false, error: { code: "RESPONSE_ERROR", message: "IEDB response could not be returned." } };
    return { content: [{ type: "text", text: "IEDB response could not be returned." }], structuredContent: await cite(structured, toolName, query), isError: true };
  }
}

async function stageResponse(env: DataEnv, result: Result, toolName: string, extra: unknown, query: unknown, failed: unknown) : Promise<Result> {
  if (!env.IEDB_DATA_DO) throw new Error("Missing staging storage");
  const staged = await stageToDoAndRespond(result, env.IEDB_DATA_DO as Parameters<typeof stageToDoAndRespond>[1], "iedb", undefined,
    { toolName, serverName: "iedb" }, "iedb", extra as Parameters<typeof stageToDoAndRespond>[6]);
  const citation = await buildCitation({
    source, server: "iedb", tool: toolName.replace(/^mcp_/, ""), query, queryScope: "tool_arguments",
    result, resultScope: "staged:full_result", dataAccessId: staged.dataAccessId, retrievedAt: new Date().toISOString()
  });
  const structuredContent = { success: !failed, staged: true, data: undefined, data_access_id: staged.dataAccessId, _staging: staged._staging, _meta: { citation } };
  if (bytes(structuredContent) > 100000) throw new Error("Staging metadata exceeds transport limit");
  const handle = { content: [{ type: "text" as const, text: "Response staged. Use iedb_query_data; the payloads table retains the complete original response." }], structuredContent, ...(failed ? { isError: true } : {}) };
  if (shouldStage(bytes(handle) + RESERVE_BYTES)) throw new Error("Staging handle exceeds transport limit");
  return handle;
}
