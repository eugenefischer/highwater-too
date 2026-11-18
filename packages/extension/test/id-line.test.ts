import { describe, expect, it } from "vitest";
import { Annotation, EditorSelection, EditorState } from "@codemirror/state";
import { idLineGuard, idLineRange, onlyAddsIdLine } from "../src/highland-editor/id-line.ts";
import { idForm, idLineAddition, idNote, noteId, withoutIdNote, withoutTrailingIdNote } from "../src/extras-folder.ts";

const ID = "1a2b3c4d-5e6f-7a8b-9c0d-112233445566";

describe("the ID line of a linked plain file", () => {
  it("is a note in .fountain files and an HTML comment in .md files, and either is read", () => {
    expect(idForm("/w/Script.fountain")).toBe("fountain");
    expect(idForm("/w/Story.md")).toBe("markdown");
    expect(idNote(ID, "markdown")).toBe(`<!-- highwater: ${ID} -->`);
    expect(noteId(`Text.\n\n<!-- highwater: ${ID} -->\n`)).toBe(ID);
    expect(noteId(`Text.\n\n[[highwater: ${ID}]]\n`)).toBe(ID);
    expect(withoutIdNote(`Text.\n\n<!-- highwater: ${ID} -->\n`)).toBe("Text.\n");
  });

  it("goes on a line of its own after a blank line", () => {
    expect(idLineAddition("Text.", ID, "markdown")).toBe(`\n\n<!-- highwater: ${ID} -->\n`);
    expect(idLineAddition("Text.\n", ID, "fountain")).toBe(`\n[[highwater: ${ID}]]\n`);
    expect(idLineAddition("Text.\n\n", ID, "fountain")).toBe(`[[highwater: ${ID}]]\n`);
    expect(idLineAddition("", ID, "fountain")).toBe(`[[highwater: ${ID}]]\n`);
  });

  it("is left out of printing only when it is last, so nothing before it moves", () => {
    expect(withoutTrailingIdNote(`INT. ROOM - DAY\n\nAction.\n\n[[highwater: ${ID}]]\n`)).toBe("INT. ROOM - DAY\n\nAction.\n");
    const middle = `Action.\n\n[[highwater: ${ID}]]\n\nMore.\n`;
    expect(withoutTrailingIdNote(middle)).toBe(middle);
  });

  it("is hidden from the end of the writing to the end of the text, only on a line of its own", () => {
    const text = `Action.\n\n\n<!-- highwater: ${ID} -->\n`;
    // The line and the one blank line before it; a further blank line the writer made stays.
    expect(idLineRange(text)).toEqual({ from: "Action.\n".length, to: text.length });
    expect(idLineRange(`Action.\n\n<!-- highwater: ${ID} -->`)).toEqual({ from: "Action.".length, to: `Action.\n\n<!-- highwater: ${ID} -->`.length });
    expect(idLineRange(`[[highwater: ${ID}]]`)).toEqual({ from: 0, to: `[[highwater: ${ID}]]`.length });
    expect(idLineRange(`Action [[highwater: ${ID}]]\n`)).toBeNull();
    expect(idLineRange(`[[highwater: ${ID}]]\n\nAction.\n`)).toBeNull();
    const long = `${"x".repeat(1000)}\n${"\n".repeat(300)}[[highwater: ${ID}]]`;
    expect(idLineRange(long)).toEqual({ from: 1299, to: long.length });
  });

  it("can't be edited in the Highwater Editor: edits stop where it begins, and the cursor stays before it", () => {
    const remote = Annotation.define<boolean>();
    const text = `Action.\n\n[[highwater: ${ID}]]\n`;
    let state = EditorState.create({ doc: text, extensions: [idLineGuard((tr) => !!tr.annotation(remote))] });
    // Select All, Delete: the writing goes, the line stays.
    state = state.update({ changes: { from: 0, to: state.doc.length } }).state;
    expect(state.doc.toString()).toBe(`\n\n[[highwater: ${ID}]]\n`);
    // Typing at the very end goes in before it.
    state = state.update({ selection: EditorSelection.cursor(state.doc.length) }).state;
    expect(state.selection.main.head).toBe(0);
    state = state.update({ changes: { from: state.selection.main.head, insert: "New." } }).state;
    expect(state.doc.toString()).toBe(`New.\n\n[[highwater: ${ID}]]\n`);
    // A replacement that reaches into it changes only the writing.
    state = state.update({ changes: { from: 2, to: state.doc.length, insert: "w" } }).state;
    expect(state.doc.toString()).toBe(`New\n\n[[highwater: ${ID}]]\n`.replace("New", "New".slice(0, 2) + "w"));
    // Typing at the end of the writing (where the hidden part begins) is allowed.
    let t = EditorState.create({ doc: text, extensions: [idLineGuard(() => false)] });
    t = t.update({ changes: { from: 7, insert: " More." } }).state;
    expect(t.doc.toString()).toBe(`Action. More.\n\n[[highwater: ${ID}]]\n`);
    // Return at the end makes a new line of writing, visible, with the cursor on it.
    t = t.update({ changes: { from: 13, insert: "\n" }, selection: EditorSelection.cursor(14) }).state;
    expect(t.doc.toString()).toBe(`Action. More.\n\n\n[[highwater: ${ID}]]\n`);
    expect(t.selection.main.head).toBe(14);
    expect(idLineRange(t.doc)).toEqual({ from: 14, to: t.doc.length });
    // The extension's own change may touch it.
    state = state.update({ changes: { from: 0, to: state.doc.length, insert: "Reverted." }, annotations: remote.of(true) }).state;
    expect(state.doc.toString()).toBe("Reverted.");
  });

  it("added by a save stays out of the page's undo", () => {
    expect(onlyAddsIdLine("", `\n\n<!-- highwater: ${ID} -->\n`)).toBe(true);
    expect(onlyAddsIdLine("", "\n\nMore text.\n")).toBe(false);
    expect(onlyAddsIdLine("x", `[[highwater: ${ID}]]`)).toBe(false);
  });
});
