import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { iedbToolsPost } from "../lib/http";
import { parseTsv, coerceNumericFields } from "../lib/tsv-parser";
import {
    createCodeModeResponse,
    createCodeModeError,
} from "@bio-mcp/shared/codemode/response";
import { shouldStage, stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";

interface PredictEnv {
    IEDB_DATA_DO?: {
        idFromName(name: string): unknown;
        get(id: unknown): { fetch(req: Request): Promise<Response> };
    };
}

export function registerPredictBcell(server: McpServer, env?: PredictEnv) {
    const handler = async (args: Record<string, unknown>, extra: Record<string, unknown>) => {
        const runtimeEnv = env || (extra as { env?: PredictEnv })?.env;
        try {
            const sequence = String(args.sequence).trim().toUpperCase();
            const method = String(args.method || "Bepipred");
            const windowSize = String(args.window_size || "");

            const formData: Record<string, string> = {
                method,
                sequence_text: sequence,
            };
            if (windowSize) formData.window_size = windowSize;

            const response = await iedbToolsPost("/tools_api/bcell/", formData);

            if (!response.ok) {
                const body = await response.text().catch(() => "");
                throw new Error(`IEDB Tools API error: HTTP ${response.status}${body ? ` - ${body.slice(0, 300)}` : ""}`);
            }

            const tsvText = await response.text();
            const parsed = parseTsv(tsvText);
            const numericFields = ["score", "start", "end"];
            const results = coerceNumericFields(parsed.rows, numericFields);

            const responseSize = JSON.stringify(results).length;
            if (shouldStage(responseSize) && runtimeEnv?.IEDB_DATA_DO) {
                const staged = await stageToDoAndRespond(
                    results,
                    runtimeEnv.IEDB_DATA_DO as any,
                    "bcell_prediction",
                    undefined,
                    undefined,
                    "iedb",
                    (extra as { sessionId?: string })?.sessionId,
                );
                return createCodeModeResponse(
                    {
                        staged: true,
                        data_access_id: staged.dataAccessId,
                        total_rows: staged.totalRows,
                        _staging: staged._staging,
                        message: `B-cell epitope prediction staged (${results.length} residues). Use iedb_query_data with data_access_id '${staged.dataAccessId}' to query.`,
                    },
                    { meta: { staged: true, data_access_id: staged.dataAccessId } },
                );
            }

            return createCodeModeResponse(
                {
                    predictions: results,
                    total: results.length,
                    method,
                },
                { meta: { fetched_at: new Date().toISOString(), total: results.length } },
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return createCodeModeError("API_ERROR", `iedb_predict_bcell failed: ${msg}`);
        }
    };

    server.registerTool(
        "iedb_predict_bcell",
        {
            title: "Predict B-cell Epitopes",
            description:
                "Predict linear B-cell epitopes from a protein sequence. Returns per-residue scores indicating epitope probability.",
            inputSchema: {
                sequence: z.string().min(8).describe("Protein sequence (amino acid one-letter codes)"),
                method: z
                    .enum(["Bepipred", "Bepipred-2.0", "Chou-Fasman", "Emini", "Karplus-Schulz", "Kolaskar-Tongaonkar", "Parker"])
                    .default("Bepipred")
                    .optional()
                    .describe("Prediction method"),
                window_size: z
                    .number()
                    .int()
                    .min(1)
                    .max(50)
                    .optional()
                    .describe("Window size for averaging (method-dependent)"),
            },
        },
        async (args, extra) => handler(args as Record<string, unknown>, extra as Record<string, unknown>),
    );
}
