import { describe, expect, it } from "vitest";
import { assetMarkdown, binLabel, move, uniqueName } from "../src/syntax/workspace.ts";

describe("workspace helpers", () => {
  it("labels a Bin item by its first non-empty line", () => {
    expect(binLabel("\n\n  INT. HOUSE - DAY\n\nShe enters.")).toBe("INT. HOUSE - DAY");
    expect(binLabel("")).toBe("(empty)");
    expect(binLabel("x".repeat(80), 10)).toBe("xxxxxxxxx…");
  });

  it("moves an item", () => {
    expect(move(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(move(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("writes image Markdown for an asset", () => {
    expect(assetMarkdown("cat.png")).toBe("![cat](assets/cat.png)");
    expect(assetMarkdown("my cat (2).png")).toBe("![my cat (2)](assets/my%20cat%20%282%29.png)");
  });

  it("finds a free asset name", () => {
    expect(uniqueName("cat.png", ["dog.png"])).toBe("cat.png");
    expect(uniqueName("cat.png", ["cat.png", "cat 2.png"])).toBe("cat 3.png");
  });
});
