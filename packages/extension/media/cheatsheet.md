# Syntax Cheat Sheet

Screenplays use **Fountain**; manuscripts use **Markdown**. Everything under *Both* works in either.

## Screenplays (Fountain)

| Write | For |
|---|---|
| `INT. KITCHEN - DAY` | Scene heading (also `EXT.`, `INT./EXT.`, `I/E.`, `EST.`) |
| `.FLASHBACK` | Forced scene heading |
| `INT. KITCHEN - DAY #12#` | Scene number |
| `BOB` on its own line, after an empty line | Character cue; the lines under it are dialogue |
| `@McCLANE` | Forced character cue (for names with lower case) |
| `BOB (V.O.)` | Cue with an extension |
| `(quietly)` under a cue | Parenthetical |
| `ALICE ^` | Dual dialogue: speaks at the same time as the cue before |
| `CUT TO:` | Transition (capitals ending in `TO:`) |
| `> FADE OUT.` | Forced transition |
| `> THE END <` | Centred text |
| `~Singing in the rain` | Lyric |
| `!Some action` | Forced action |
| `Title:`, `Credit:`, `Author:`, `Source:`, `Draft date:`, `Contact:` at the very top | Title page (continue a value on indented lines) |

## Manuscripts (Markdown)

| Write | For |
|---|---|
| `# Chapter One` | Heading (`##`, `###` for lower levels) |
| A line of text | A paragraph (each line is its own paragraph) |
| `* * *` | Scene break, printed as a centred `#` |
| `> Quoted text` | Block quote |
| `- item`, `* item`, `1. item` | Lists (indent for nested items) |
| `Term :: Definition` | Term list |
| `\| A \| B \|` then `\|---\|---\|` | Table |
| `![caption](image.png)` | Image (from the document's Assets, or next to the file) |
| `[text](https://…)` | Link |
| `Right-aligned text>` | Right-aligned line |
| `{{TOC}}`, `{{TOC: ##}}` | Table of contents (all headings, or one level) |

## Both

| Write | For |
|---|---|
| `*italic*` `**bold**` `_underline_` `~~strike~~` | Emphasis |
| `+highlight+` | Highlight |
| `[[a note]]` | Note: shown in the editor, never printed |
| `/* omitted text */` | Boneyard: kept in the file, never printed |
| `# Act One` (screenplays) | Section, for the Navigator; not printed |
| `= A synopsis` | Synopsis; not printed |
| `===` | Page break |
| `{{%m: label}}` | Marker (⌃M inserts one, ⌃⌥M jumps to the next) |
| `{{INCLUDE: other.highland}}` | Includes another file's text when printing |
| `{{HEADER: Name / Title / %p}}`, `{{FOOTER: …}}` | Page header or footer: `%p` page, `%pp` total pages, `%#` current section or chapter, `%none` off |
| `{{HEADER: Left \| Centre \| Right}}` | Header in three parts |
| `{{PAGENUMBER: 10}}` | Number pages from 10 |
| `{{SERIES}}`, `{{SERIES: 5}}` | Counter: 1, 2, 3… (or from 5) |
| `{{TIMESTAMP}}` | Today's date |
