import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { crossCheck } from "./pdf-crosscheck.ts";

const generated = fileURLToPath(new URL("../../../fixtures/generated/", import.meta.url));
const priv = process.env.HIGHWATER_PRIVATE_FIXTURES;

describe("structure matches Highland's printed PDF", () => {
  it("ScreenplayEdgeCases: every cue, including dual dialogue and the forced cue", async () => {
    const r = await crossCheck(join(generated, "ScreenplayEdgeCases.highland"), join(generated, "ScreenplayEdgeCases.pdf"));
    expect(r.ours).toEqual(r.theirs);
    expect(r.intExtHeadings.ours).toBe(r.intExtHeadings.theirs);
  });

  it.runIf(priv)("Astounding (57 pages): every cue and scene heading", async () => {
    const dir = join(priv!, "Files with exports");
    const r = await crossCheck(join(dir, "Astounding_date_EJ draft 2 copy.highland"), join(dir, "Astounding_2024_02_19 copy.pdf"));
    expect(r.ours.length).toBeGreaterThan(400);
    expect(r.ours).toEqual(r.theirs);
    expect(r.intExtHeadings.ours).toBe(r.intExtHeadings.theirs);
  });
});
