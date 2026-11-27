import { describe, expect, it } from "vitest";
import { workTitle } from "../src/work-title.ts";

const all = { titlePage: true, heading: true };

describe("a new work's title", () => {
  it("takes a screenplay's title page Title, without its markup", () => {
    const script = "Title:\n    _**BRICK & STEEL**_\n    _**FULL RETIRED**_\nCredit: Written by\nAuthor: Someone\n\nINT. ROOM - DAY\n";
    expect(workTitle(script, "text.fountain", "brick.highland", all)).toBe("BRICK & STEEL FULL RETIRED");
    expect(workTitle(script, "text.fountain", "brick.highland", { titlePage: false, heading: true })).toBe("brick");
  });

  it("never uses a screenplay's first heading", () => {
    expect(workTitle("# ACT ONE\n\nINT. ROOM - DAY\n", "text.fountain", "My Script.fountain", all)).toBe("My Script");
  });

  it("takes a manuscript's Title, then its CC line, then its first top-level heading", () => {
    expect(workTitle("Title: The *Story*\n\n# Chapter One\n", "text.md", "s.md", all)).toBe("The Story");
    expect(workTitle("TL: Eugene Fischer\nCC: **Story Title**\n    by Eugene Fischer\n\n# Chapter One\n", "text.md", "s.md", all)).toBe("Story Title");
    expect(workTitle("Some prose first.\n\n## Part\n\n# The Real Title [[note]]\n", "text.md", "s.md", all)).toBe("The Real Title");
    expect(workTitle("# The Heading\n", "text.md", "story_draft.md", { titlePage: true, heading: false })).toBe("story_draft");
  });

  it("falls back to the file's name", () => {
    expect(workTitle("Just text.\n", "text.txt", "Notes.txt", all)).toBe("Notes");
    expect(workTitle("", "text.md", "Draft 3.highland", all)).toBe("Draft 3");
  });

  it("knows the script's kind by any of the names it may have, as everywhere else", () => {
    for (const name of ["text.md", "text.markdown", "Story.MD"]) expect(workTitle("# The Title\n\nText.\n", name, "s", all), name).toBe("The Title");
    for (const name of ["text.fountain", "Script.spmd"]) expect(workTitle("Title: A Script\n\nINT. ROOM - DAY\n", name, "s", all), name).toBe("A Script");
    expect(workTitle("# Not a heading in plain text\n", "text.txt", "plain", all)).toBe("plain");
  });
});
