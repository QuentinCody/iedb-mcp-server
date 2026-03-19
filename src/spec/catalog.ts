import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

export const iedbCatalog: ApiCatalog = {
    name: "IEDB Query API",
    baseUrl: "https://query-api.iedb.org",
    version: "2.0",
    auth: "none",
    endpointCount: 30,
    notes:
        "- PostgREST-style query API: use query params for filtering\n" +
        "- Supports operators: eq, neq, gt, gte, lt, lte, like, ilike, in, is\n" +
        "- Example filter: ?linear_sequence=eq.SLYNTVATL\n" +
        "- Pagination: use limit and offset query params\n" +
        "- Response is always a JSON array of objects\n" +
        "- For MHC binding/processing predictions, use the Tools API via api.post() — responses are auto-parsed from TSV to JSON",
    endpoints: [
        // === Epitopes ===
        {
            method: "GET",
            path: "/epitope_search",
            summary: "Search epitopes by sequence, organism, disease, or MHC restriction",
            category: "epitope",
            queryParams: [
                { name: "linear_sequence", type: "string", required: false, description: "Filter by peptide sequence (supports eq, like operators)" },
                { name: "source_organism_iri", type: "string", required: false, description: "Source organism IRI (e.g. http://purl.obolibrary.org/obo/NCBITaxon_11676 for HIV-1)" },
                { name: "disease_iri", type: "string", required: false, description: "Disease IRI" },
                { name: "mhc_allele_name", type: "string", required: false, description: "MHC allele name (e.g. HLA-A*02:01)" },
                { name: "limit", type: "number", required: false, description: "Max results to return" },
                { name: "offset", type: "number", required: false, description: "Number of results to skip" },
            ],
        },
        {
            method: "GET",
            path: "/epitope/{epitope_id}",
            summary: "Get epitope details by ID",
            category: "epitope",
            pathParams: [
                { name: "epitope_id", type: "number", required: true, description: "IEDB epitope ID" },
            ],
        },
        // === T-cell Assays ===
        {
            method: "GET",
            path: "/tcell_search",
            summary: "Search T-cell assay results — cytokine release, killing, proliferation",
            category: "assay",
            queryParams: [
                { name: "linear_sequence", type: "string", required: false, description: "Epitope sequence" },
                { name: "mhc_allele_name", type: "string", required: false, description: "MHC restriction" },
                { name: "assay_type", type: "string", required: false, description: "Assay type (e.g. 'IFNg release')" },
                { name: "source_organism_iri", type: "string", required: false, description: "Source organism" },
                { name: "host_organism_iri", type: "string", required: false, description: "Host organism" },
                { name: "limit", type: "number", required: false, description: "Max results" },
                { name: "offset", type: "number", required: false, description: "Skip results" },
            ],
        },
        // === B-cell Assays ===
        {
            method: "GET",
            path: "/bcell_search",
            summary: "Search B-cell/antibody assay results",
            category: "assay",
            queryParams: [
                { name: "linear_sequence", type: "string", required: false, description: "Epitope sequence" },
                { name: "assay_type", type: "string", required: false, description: "Assay type" },
                { name: "source_organism_iri", type: "string", required: false, description: "Source organism" },
                { name: "limit", type: "number", required: false, description: "Max results" },
                { name: "offset", type: "number", required: false, description: "Skip results" },
            ],
        },
        // === MHC Ligand Assays ===
        {
            method: "GET",
            path: "/mhc_ligand_search",
            summary: "Search MHC ligand elution and binding assay results",
            category: "assay",
            queryParams: [
                { name: "linear_sequence", type: "string", required: false, description: "Peptide sequence" },
                { name: "mhc_allele_name", type: "string", required: false, description: "MHC allele" },
                { name: "assay_type", type: "string", required: false, description: "Assay type (e.g. 'dissociation constant KD')" },
                { name: "source_organism_iri", type: "string", required: false, description: "Source organism" },
                { name: "limit", type: "number", required: false, description: "Max results" },
                { name: "offset", type: "number", required: false, description: "Skip results" },
            ],
        },
        // === References ===
        {
            method: "GET",
            path: "/reference_search",
            summary: "Search IEDB references (publications curated for epitope data)",
            category: "reference",
            queryParams: [
                { name: "author", type: "string", required: false, description: "Author name" },
                { name: "title", type: "string", required: false, description: "Publication title (supports like operator)" },
                { name: "pubmed_id", type: "string", required: false, description: "PubMed ID" },
                { name: "limit", type: "number", required: false, description: "Max results" },
                { name: "offset", type: "number", required: false, description: "Skip results" },
            ],
        },
        {
            method: "GET",
            path: "/reference/{reference_id}",
            summary: "Get reference details by ID",
            category: "reference",
            pathParams: [
                { name: "reference_id", type: "number", required: true, description: "IEDB reference ID" },
            ],
        },
        // === Antigens ===
        {
            method: "GET",
            path: "/antigen_search",
            summary: "Search source antigens (proteins from which epitopes are derived)",
            category: "antigen",
            queryParams: [
                { name: "antigen_name", type: "string", required: false, description: "Antigen name (supports like operator)" },
                { name: "source_organism_iri", type: "string", required: false, description: "Source organism" },
                { name: "limit", type: "number", required: false, description: "Max results" },
                { name: "offset", type: "number", required: false, description: "Skip results" },
            ],
        },
        // === Organisms ===
        {
            method: "GET",
            path: "/organism_search",
            summary: "Search organisms with epitope data in IEDB",
            category: "organism",
            queryParams: [
                { name: "organism_name", type: "string", required: false, description: "Organism name (supports like operator)" },
                { name: "limit", type: "number", required: false, description: "Max results" },
                { name: "offset", type: "number", required: false, description: "Skip results" },
            ],
        },
        // === Disease ===
        {
            method: "GET",
            path: "/disease_search",
            summary: "Search diseases with epitope data in IEDB",
            category: "disease",
            queryParams: [
                { name: "disease_name", type: "string", required: false, description: "Disease name (supports like)" },
                { name: "limit", type: "number", required: false, description: "Max results" },
                { name: "offset", type: "number", required: false, description: "Skip results" },
            ],
        },
    ],
};
