import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

export class IedbDataDO extends RestStagingDO {
    protected getSchemaHints(data: unknown): SchemaHints | undefined {
        if (!data || typeof data !== "object") return undefined;

        if (Array.isArray(data)) {
            const sample = data[0];
            if (sample && typeof sample === "object") {
                // Epitope search results
                if ("linear_sequence" in sample || "epitope_id" in sample) {
                    return {
                        tableName: "epitopes",
                        indexes: ["linear_sequence", "organism_name", "disease_name"],
                    };
                }
                // T-cell assay results
                if ("assay_type" in sample && "t_cell" in (sample as Record<string, unknown>)) {
                    return {
                        tableName: "tcell_assays",
                        indexes: ["assay_type", "mhc_allele_name"],
                    };
                }
                // B-cell assay results
                if ("assay_type" in sample && "bcell" in (sample as Record<string, unknown>)) {
                    return {
                        tableName: "bcell_assays",
                        indexes: ["assay_type", "epitope_structure"],
                    };
                }
                // MHC binding prediction results
                if ("allele" in sample && ("ic50" in sample || "percentile_rank" in sample || "score" in sample)) {
                    return {
                        tableName: "mhc_predictions",
                        indexes: ["allele", "peptide", "method"],
                    };
                }
            }
        }

        return undefined;
    }
}
