/**
 * Parse TSV text from IEDB Tools API into structured JSON.
 * The Tools API returns tab-separated values with headers.
 */
export interface TsvParseResult {
    headers: string[];
    rows: Record<string, string>[];
    rawLineCount: number;
}

export function parseTsv(tsv: string): TsvParseResult {
    const lines = tsv.trim().split("\n");
    if (lines.length === 0) {
        return { headers: [], rows: [], rawLineCount: 0 };
    }

    // Find the header line (skip comment lines starting with #)
    let headerIndex = 0;
    while (headerIndex < lines.length && lines[headerIndex].startsWith("#")) {
        headerIndex++;
    }

    if (headerIndex >= lines.length) {
        return { headers: [], rows: [], rawLineCount: lines.length };
    }

    const headers = lines[headerIndex].split("\t").map((h) => h.trim());
    const rows: Record<string, string>[] = [];

    for (let i = headerIndex + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = line.split("\t");
        const row: Record<string, string> = {};
        for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = values[j]?.trim() ?? "";
        }
        rows.push(row);
    }

    return { headers, rows, rawLineCount: lines.length };
}

/**
 * Convert numeric string fields to numbers where appropriate.
 */
export function coerceNumericFields(
    rows: Record<string, string>[],
    numericFields: string[],
): Record<string, unknown>[] {
    return rows.map((row) => {
        const result: Record<string, unknown> = { ...row };
        for (const field of numericFields) {
            if (field in result && result[field] !== "") {
                const num = Number(result[field]);
                if (!isNaN(num)) {
                    result[field] = num;
                }
            }
        }
        return result;
    });
}
