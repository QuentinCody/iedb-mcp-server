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

export function registerPredictProcessing(server: McpServer, env?: PredictEnv): void {
    const handler = async (args: Record<string, unknown>, extra: Record<string, unknown>) => {
        const runtimeEnv = env || (extra as { env?: PredictEnv })?.env;
        try {
            const sequence = String(args.sequence).trim().toUpperCase();
            const method = String(args.method || "recommended");
            const allele = String(args.allele || "HLA-A*02:01");
            const length = String(args.length || "9");
            const proteasome = String(args.proteasome_type || "immuno");

            const formData: Record<string, string> = {
                method,
                sequence_text: sequence,
                allele,
                length,
                proteasome_type: proteasome,
            };

            const response = await iedbToolsPost("/tools_api/processing/", formData);

            if (!response.ok) {
                const body = await response.text().catch(() => "");
                throw new Error(`IEDB Tools API error: HTTP ${response.status}${body ? ` - ${body.slice(0, 300)}` : ""}`);
            }

            const tsvText = await response.text();
            const parsed = parseTsv(tsvText);
            const numericFields = ["proteasome_score", "tap_score", "mhc_score", "processing_score", "total_score"];
            const results = coerceNumericFields(parsed.rows, numericFields);

            const responseSize = JSON.stringify(results).length;
            if (shouldStage(responseSize) && runtimeEnv?.IEDB_DATA_DO) {
                const staged = await stageToDoAndRespond(
                    results,
                    runtimeEnv.IEDB_DATA_DO as DurableObjectNamespace,
                    "processing_prediction",
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
                        message: `Antigen processing prediction staged (${results.length} peptides). Use iedb_query_data with data_access_id '${staged.dataAccessId}' to query.`,
                    },
                    { meta: { staged: true, data_access_id: staged.dataAccessId } },
                );
            }

            return createCodeModeResponse(
                {
                    predictions: results,
                    total: results.length,
                    method,
                    allele,
                    proteasome_type: proteasome,
                },
                { meta: { fetched_at: new Date().toISOString(), total: results.length } },
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return createCodeModeError("API_ERROR", `iedb_predict_processing failed: ${msg}`);
        }
    };

    server.registerTool(
        "iedb_predict_processing",
        {
            title: "Predict Antigen Processing",
            description:
                "Predict combined proteasomal cleavage, TAP transport, and MHC class I binding scores for peptide processing. Provides a total processing score for each peptide.",
            inputSchema: {
                sequence: z.string().min(8).describe("Protein sequence (amino acid one-letter codes)"),
                method: z
                    .enum(["recommended", "netmhcpan", "ann", "smm"])
                    .default("recommended")
                    .optional()
                    .describe("MHC binding prediction method component"),
                allele: z
                    .string()
                    .default("HLA-A*02:01")
                    .optional()
                    .describe("MHC-I allele (e.g. HLA-A*02:01)"),
                length: z
                    .string()
                    .default("9")
                    .optional()
                    .describe("Peptide length"),
                proteasome_type: z
                    .enum(["immuno", "constitutive"])
                    .default("immuno")
                    .optional()
                    .describe("Proteasome type: immuno (IFN-gamma induced) or constitutive"),
            },
        },
        async (args, extra) => handler(args as Record<string, unknown>, extra as Record<string, unknown>),
    );
}
