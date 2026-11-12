import { describe, expect, it } from "vitest";
import { commitMessage } from "@highwater/history";
import { parseSave } from "../src/save-message.ts";

describe("parseSave", () => {
  const date = new Date(2026, 10, 13, 15, 42);
  it("reads a save's kind and word change", () => {
    expect(parseSave(commitMessage("save", date, "one two", "one two three four"))).toEqual({ kind: "Save", note: "", delta: "+2", words: "4" });
  });
  it("reads a loss of words, thousands and a note", () => {
    const before = Array(1300).fill("word").join(" ");
    expect(parseSave(commitMessage("revert", date, before, "a b", "to Nov 10, 3:42 PM"))).toEqual({ kind: "Revert", note: "to Nov 10, 3:42 PM", delta: "−1,298", words: "2" });
  });
  it("keeps a join's message as its note", () => {
    expect(parseSave("Connect 2026-11-13 15:42, the history of Draft.highland joined\n\nHighwater-Document: x")).toEqual({ kind: "Connect", note: "the history of Draft.highland joined", delta: "", words: "" });
  });
});
