import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDocument, ExternalChangeError, readBundle, writeBundle } from "../src/index.ts";
import { listZip } from "./zip-listing.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "highwater-bundle-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeBundle", () => {
  it("writes, reads back and names the folder after the file", async () => {
    const path = join(dir, "Pilot.highland");
    const doc = createDocument({ mode: "fountain", template: "Screenplay", text: "INT. HOUSE - DAY" });
    await writeBundle(path, doc);
    const { bundle } = await readBundle(path);
    expect(bundle.text).toBe("INT. HOUSE - DAY");
    expect(bundle.originalFolder).toBe("Pilot.textbundle");
    expect(await readdir(dir)).toEqual(["Pilot.highland"]);
  });

  it("refuses to overwrite a file another program changed, leaving it untouched", async () => {
    const path = join(dir, "Pilot.highland");
    const first = await writeBundle(path, createDocument({ mode: "fountain", template: "Screenplay", text: "one" }));
    await writeFile(path, "changed by Highland");
    await utimes(path, new Date(), new Date(Date.now() + 5000));
    await expect(
      writeBundle(path, createDocument({ mode: "fountain", template: "Screenplay", text: "two" }), { expected: first }),
    ).rejects.toThrow(ExternalChangeError);
    expect(await readFile(path, "utf8")).toBe("changed by Highland");
    expect(await readdir(dir)).toEqual(["Pilot.highland"]);
  });

  it("saves normally when the disk copy still matches", async () => {
    const path = join(dir, "Pilot.highland");
    const first = await writeBundle(path, createDocument({ mode: "markdown", template: "Manuscript", text: "# One" }));
    const { bundle } = await readBundle(path);
    bundle.text = "# Two";
    await writeBundle(path, bundle, { expected: first });
    expect((await readBundle(path)).bundle.text).toBe("# Two");
    expect(listZip(new Uint8Array(await readFile(path))).every((e) => e.name.startsWith("Pilot.textbundle/"))).toBe(true);
  });
});
