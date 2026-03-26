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

export function registerPredictMhcII(server: McpServer, env?: PredictEnv): void {
    const handler = async (args: Record<string, unknown>, extra: Record<string, unknown>) => {
        const runtimeEnv = env || (extra as { env?: PredictEnv })?.env;
        try {
            const sequence = String(args.sequence).trim().toUpperCase();
            const method = String(args.method || "recommended");
            const allele = String(args.allele || "HLA-DRB1*01:01");

            const formData: Record<string, string> = {
                method,
                sequence_text: sequence,
                allele,
            };

            const response = await iedbToolsPost("/tools_api/mhcii/", formData);

            if (!response.ok) {
                const body = await response.text().catch(() => "");
                throw new Error(`IEDB Tools API error: HTTP ${response.status}${body ? ` - ${body.slice(0, 300)}` : ""}`);
            }

            const tsvText = await response.text();
            const parsed = parseTsv(tsvText);
            const numericFields = ["ic50", "percentile_rank", "score", "rank"];
            const results = coerceNumericFields(parsed.rows, numericFields);

            const responseSize = JSON.stringify(results).length;
            if (shouldStage(responseSize) && runtimeEnv?.IEDB_DATA_DO) {
                const staged = await stageToDoAndRespond(
                    results,
                    runtimeEnv.IEDB_DATA_DO as DurableObjectNamespace,
                    "mhcii_prediction",
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
                        message: `MHC-II prediction results staged (${results.length} peptides). Use iedb_query_data with data_access_id '${staged.dataAccessId}' to query.`,
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
                },
                { meta: { fetched_at: new Date().toISOString(), total: results.length } },
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return createCodeModeError("API_ERROR", `iedb_predict_mhcii failed: ${msg}`);
        }
    };

    server.registerTool(
        "iedb_predict_mhcii",
        {
            title: "Predict MHC Class II Binding",
            description:
                "Predict peptide binding to MHC class II molecules (HLA-DR/DP/DQ). Submit a protein sequence and get predicted binding affinities for specified HLA class II alleles.",
            inputSchema: {
                sequence: z.string().min(8).describe("Protein sequence (amino acid one-letter codes)"),
                method: z
                    .enum(["recommended", "nn_align", "smm_align", "comblib", "netmhciipan"])
                    .default("recommended")
                    .optional()
                    .describe("Prediction method"),
                allele: z
                    .string()
                    .default("HLA-DRB1*01:01")
                    .optional()
                    .describe("MHC-II allele (e.g. HLA-DRB1*01:01). Comma-separate for multiple."),
            },
        },
        async (args, extra) => handler(args as Record<string, unknown>, extra as Record<string, unknown>),
    );
}
