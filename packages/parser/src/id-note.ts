/**
 * The line tying a plain file to its writing history, which never prints: a Fountain note
 * `[[highwater: <ID>]]`, or in a Markdown file an HTML comment `<!-- highwater: <ID> -->`. Either
 * is read in either kind of file. This is the one definition: the history, printing, counting, the
 * Navigator, spelling and the Highwater Editor's hidden line all use it.
 */
const ID = "[0-9A-Za-z-]{8,}";
const NOTE = `\\[\\[\\s*highwater:\\s*(${ID})\\s*\\]\\]|<!--\\s*highwater:\\s*(${ID})\\s*-->`;

/** The note anywhere in a text (the ID in group 1 for a note, 2 for a comment). */
export const ID_NOTE = new RegExp(NOTE);
/** The note as the last thing in a text, with the line break before it. */
export const TRAILING_ID_NOTE = new RegExp(`\\n?[ \\t]*(?:${NOTE})[ \\t]*\\s*$`);
/** Text that is only the note, with any spaces and line breaks around it. */
export const ONLY_ID_NOTE = new RegExp(`^\\s*(?:${NOTE})\\s*$`);

/** A parsed note's text (inside `[[ ]]`) that is the history's ID: "highwater: <ID>". */
export function isIdNoteText(text: string): boolean {
  return new RegExp(`^\\s*highwater:\\s*${ID}\\s*$`).test(text);
}

/** The ID in a text's note, or null. */
export function idInNote(text: string): string | null {
  const m = ID_NOTE.exec(text);
  return m ? (m[1] ?? m[2] ?? null) : null;
}
