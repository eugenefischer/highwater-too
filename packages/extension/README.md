# Highwater Too

Write screenplays and manuscripts in VS Code, in the `.highland` files of Highland 2, which is no longer developed. Highwater Too opens and saves `.highland` files safely (Highland 2 still opens them afterwards), gives them a Highland-style workspace, previews and exports PDFs laid out the way Highland 2 lays them out, and keeps a git history of your writing.

**Version 0.1.0** — the first release: the Screenplay and Manuscript templates, and everything below.

## Getting started

- **Open a document:** open a `.highland` file from the Explorer or with **Highwater Too: Open Document…**, which also opens `.fountain` and `.md` files. The script text opens in an ordinary editor tab; saving writes it back into the `.highland` file, keeping everything else in it (settings, Bin, Scratchpad, images). Before the first save of each session the original file is backed up.
- **New documents:** **New Document…**, in the Navigator's title bar or on the empty sidebar, makes a blank screenplay or manuscript as a `.highland` file, or as a plain `.fountain` or `.md` file. **New Screenplay** and **New Manuscript** make `.highland` files directly.
- **Plain files:** `.fountain` files open as **Highwater Fountain**. For a `.md` or `.txt` file, click the language name in the status bar and choose **Highwater Markdown** or **Highwater Plain Text**, or run **Open .md Files with Highwater Too…** to open every `.md` file that way. **Save as .highland File…** turns a plain file into a `.highland` document.
- **Changes made elsewhere:** if Highland 2 (or anything else) changes the file while it is open, unchanged documents reload; edited ones offer Revert, Save, Save As or Compare.

## Writing

- Highlighting of scene headings, characters, dialogue, transitions, notes, boneyard, directives and Markdown; outline and folding by section and scene, or heading.
- Highland's writing keys: ⌘B, ⌘I, ⌘U, ⌃+ (highlight), ⌘/ (note), ⌘Y (omit), ⌘⇧. (centre), ⌃U and ⌃⇧U (upper and lower case).
- **Live Margins** (⌘L): cues, parentheticals and dialogue indented and transitions right-aligned, as on the page.
- **Title Page Builder:** a form for the title page fields.
- The status bar shows words (or selected words), an estimate of pages and screen or reading time, and the print template.

## The sidebar

Click the Highwater Too icon in the activity bar (it opens by itself when you open a document):

- **Navigator** (⌘1): scenes, sections, synopses, notes, images, links, includes and markers; click to jump; filter by type.
- **Bin** (⌘2): text cut or copied with ⌥⌘X or ⌥⌘C to use later; open, reorder, insert or drag back.
- **Assets** (⌘4): images kept in the document; drag one into the text.
- **Scratchpad** (⌘5): notes kept in the document, in their own tab.
- **Writing History:** the document's saves (see below).

## Preview and export

- **Preview** (⌘E, or the button in the editor's title bar): the PDF exactly as it will export, beside the editor, updated as you type; it scrolls with the editor, and clicking a line takes you to it.
- **Export PDF** (in the Preview's toolbar, or the Command Palette): the PDF.
- **Export Text** (title bar button): the text as `.fountain` or `.md` without revision marks.
- **Export Word Document** (manuscripts; in the Preview's toolbar, or the Command Palette): a `.docx` laid out like the PDF, built from ordinary Word styles, a real header with page numbers, lists and tables, so it can be edited and resubmitted. Word does its own page breaks, so the page count can differ slightly from the PDF. The **Docx Font** setting (`highwater.docxFont`) chooses Courier New (the default; on every computer) or the PDF's Courier Prime, embedded in the file (shown by Word and LibreOffice, not by Pages or Google Docs).
- **Templates:** Screenplay and Manuscript, measured against Highland 2's own PDFs; the active one is shown in the status bar (click to change it) and saved in the document as Highland 2 does. `{{HEADER}}`, `{{FOOTER}}`, `{{PAGENUMBER}}`, `{{SERIES}}`, `{{TIMESTAMP}}`, `{{TOC}}` and `{{INCLUDE}}` work. A few of Highland 2's layout quirks are fixed rather than copied: a footer's middle part is centred, `%pp` counts pages after `{{PAGENUMBER}}`, text never runs over the footer, block quotes wrap at the margin and there is no blank last page.

## Writing history

New in Highwater Too: every save is recorded in a git repository, as a record of how each work was written. It needs git (on a Mac, the Xcode command-line tools).

- One repository for all your writing, in your system's application-data folder (on a Mac, `~/Library/Application Support/Highwater Too/History`); one branch per work, so one work's history can be shared without the others. **Change Writing History Location…** moves it.
- ⌘S records at once; autosaves at most every five minutes. Each record says how many words changed.
- **Writing History** panel: click a save to compare it with the text now. **Export Writing History…** writes one work's history to a file anyone can open with `git clone`.
- **Set Up History Mirror…** (optional) pushes the history to any git remote after saves, never overwriting it.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `highwater.highlandShortcuts` | on | Highland 2's shortcuts in documents (⌘E Preview, ⌘L Live Margins, ⌘0 sidebar, ⌘1/⌘2/⌘4/⌘5 panels) instead of VS Code's. Off: Preview is ⌃⌥P and Live Margins ⌃⌥L. |
| `highwater.showSidebarOnOpen` | on | Switch to the Highwater Too sidebar when a document is opened. |
| `highwater.docxFont` | Courier New | Font for Export Word Document: Courier New, double-spaced, or Courier Prime embedded in the file, as in the PDF. |
| `highwater.writingHistory` | on | Record saves in the writing history. |
| `highwater.historyFolder` | (system default) | Where the writing history and session backups are kept. |
| `highwater.historyRemote` | (none) | A git remote to mirror the writing history to. |

## Known limitations

- Only the Screenplay and Manuscript templates so far; documents using Highland 2's other templates print with one of these.
- Live Margins cannot indent the continuation of a wrapped line (VS Code's editor does not allow it).
- `{{TOC: ##}}` with a level filter prints its entries; Highland 2 prints it oddly.
- No Stats panel (⌘3), Sprint, Gender Analysis, Revision Mode or FDX yet; `.textbundle` files are not supported.
- The history mirror pushes but does not yet bring saves made on another computer into this one.

## Licence

MIT. Courier Prime is © The Courier Prime Project Authors, under the SIL Open Font License 1.1. Highwater Too is not affiliated with Quote-Unquote Apps or Highland 2.
