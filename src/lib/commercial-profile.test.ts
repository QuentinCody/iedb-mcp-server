import { describe, expect, it } from "vitest";
import { createIedbApiFetch } from "./api-adapter";

// License audit 2026-11-10: the IEDB database is CC BY 4.0. The analysis and
// prediction tools need a license for industry use, so they are withheld from a
// reselling caller.
describe("IEDB adapter under the commercial license profile", () => {
	const apiFetch = createIedbApiFetch();

	it("refuses the next-generation tool routes with HTTP 451 and makes no upstream request", async () => {
		const result = await apiFetch({ method: "POST", path: "/ng/pipeline", body: { stages: [] }, licenseProfile: "commercial" });
		expect(result.status).toBe(451);
		expect(result.data).toMatchObject({ error: "NOT_LICENSED_FOR_COMMERCIAL_USE" });
		expect((await apiFetch({ method: "GET", path: "/ng/results/abc", licenseProfile: "commercial" })).status).toBe(451);
	});

	it("refuses a legacy prediction POST with HTTP 451", async () => {
		const result = await apiFetch({ method: "POST", path: "/mhci/", body: { method: "netmhcpan", sequence_text: "SLYNTVATL" }, licenseProfile: "commercial" });
		expect(result.status).toBe(451);
	});
});
