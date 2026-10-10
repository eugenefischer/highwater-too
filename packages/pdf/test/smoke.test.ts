import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index.ts";

describe("@highwater/pdf", () => {
  it("loads", () => {
    expect(PACKAGE_NAME).toBe("@highwater/pdf");
  });
});
