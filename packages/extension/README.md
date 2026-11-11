# Highwater Too

Write screenplays and manuscripts in VS Code, in the `.highland` files of Highland 2, which is no longer developed. Highwater Too opens and saves `.highland` files safely (Highland 2 still opens them afterwards), gives them a Highland-style workspace, previews and exports PDFs laid out the way Highland 2 lays them out, and keeps a git history of your writing.

**Version 0.1.0** — the first release: the Screenplay and Manuscript templates, and everything below.

## Getting started

- **Open a document:** open a `.highland` file from the Explorer or with **Highwater Too: Open Document…**, which also opens `.fountain` and `.md` files. The script text opens in an ordinary editor tab; saving writes it back into the `.highland` file, keeping everything else in it (settings, Bin, Scratchpad, images). Before the first save of each session the original file is backed up.
- **New documents:** **New Document…**, in the Navigator's title bar or on the empty sidebar, makes a blank screenplay or manuscript as a `.highland` file, or as a plain `.fountain` or `.md` file. **New Screenplay** and **New Manuscript** make `.highland` files directly.
- **Plain files:** `.fountain` files open as **Highwater Fountain**. For a `.md` or `.txt` file, click the language name in the status bar and choose **Highwater Markdown** or **Highwater Plain Text**, or run **Open .md Files with Highwater Too…** to open every `.md` file that way. Plain files get the Bin, Scratchpad and Assets too: the Bin and Scratchpad are kept with the writing history rather than in the file (only Highwater Too shows them; you are told so the first time), and images go in a `<name> assets` folder beside the file, made when you add the first one.
- **Converting:** **Convert to .highland File…** turns a plain file into a `.highland` document, and **Convert to .fountain File…** (or `.md`, `.txt`, by the text type) turns a `.highland` document back into a plain file. Both are in the editor's “…” menu, the tab's right-click menu and the Command Palette; Convert to .highland File… is also in the Explorer's right-click menu. The Bin, Scratchpad, images, print template and the writing history move with the work, so its history stays one history whichever way it goes. The file it was converted from is no longer tracked, and you are asked whether to move it (and its images folder) to the Trash.
- **Changes made elsewhere:** if Highland 2 (or anything else) changes the file while it is open, unchanged documents reload. Edited ones ask, as Highland does: **Save Anyway** keeps your changes, **Revert** keeps the other application's, and either way the version that loses is kept in the writing history (or, with the history off, in the backups); **Save As…** saves yours to a different file; **Compare** shows the two side by side.

## Writing

- Highlighting of scene headings, characters, dialogue, transitions, notes, boneyard, directives and Markdown; outline and folding by section and scene, or heading.
- Highland's writing keys: ⌘B, ⌘I, ⌘U, ⌃+ (highlight), ⌘/ (note), ⌘Y (omit), ⌘⇧. (centre), ⌃U and ⌃⇧U (upper and lower case).
- **Live Margins** (⌘L): cues, parentheticals and dialogue indented and transitions right-aligned, as on the page.
- **Highland-Style Editor**: documents open in a page-width column in Courier Prime, as in Highland 2, with every line of dialogue indented (wrapped lines included) and emphasis, notes and omitted text styled where they stand. Highland's top bar switches between the text and the printed pages (or ⌘E), and holds the template menu and Choose Theme; the pages have the print options at their foot (revision colours and stars, paragraph numbers, synopses, notes and the title page, printed as Highland prints them). Highland's counts (characters, words, pages) sit at the foot of the text. The panes, status bar, Highland's writing keys, completion, paragraph numbers, Go to Paragraph (⌃G), Show Invisibles and Check Spelling While Typing (American English, off by default) work in it. The code button in the title bar turns the tab into VS Code's text editor (for extensions such as spell checkers, or multiple cursors); the book button turns it back. Turn off `highwater.highlandEditor` to open documents as text by default. **Choose Theme…** gives it, the Navigator and the whole window one of Highland 2's colour themes (or VS Code's). ⌘+ and ⌘− change its text size (⌥⌘0 resets).
- **Completion** in screenplays: start a line after an empty one in capitals and the characters who already speak are offered (most frequent first), with scene-heading prefixes and transitions; after `INT.` or `EXT.`, the script's locations; after ` - `, times of day.
- **Markers:** ⌃M inserts one (with an optional label, listed in the Navigator); ⌃⌥M jumps to the next.
- **Syntax Cheat Sheet** (the ? button in the Navigator's title bar): the markup for screenplays, manuscripts and both.
- **Title Page Builder:** a form for the title page fields.
- The status bar shows words (or selected words), the exact page count (laid out with the print template a second after typing stops) and screen or reading time (prose at 250 words a minute, as Highland states it), and the print template.

## The sidebar

Click the Highwater Too icon in the activity bar (it opens by itself when you open a document):

- **Navigator** (⌘1), in Highland's style: scenes, sections, synopses, notes, images, links, includes and markers, with the one the cursor is in highlighted; click to jump. Type in the Filter box at its foot to find an item; the eye button chooses which kinds are listed. Drag a scene, section or heading to move its text (with everything under it): a line shows where it will land, before another scene, section or heading, or at the end.
- **Bin** (⌘2): text cut or copied with ⌥⌘X or ⌥⌘C to use later, each with its word count and how it goes on; hover to read it all; open, reorder, insert or drag back.
- **Assets** (⌘4): images kept in the document (for a plain file, in the folder beside it), with their kind, pixel size and file size; hover for a preview; drag one into the text to insert it as an image.
- **Scratchpad** (⌘5): notes kept in the document, in their own tab.
- For a plain `.fountain` or `.md` file, the Bin and Scratchpad are kept with the writing history (in its folder, under `extras`), not in the file.
- **Writing History:** the document's saves (see below).
- The panes show the document you are in, and its Bin items and Scratchpad count as the document. Another kind of file empties them; the Preview and the panes themselves do not. Closing a document closes its Bin item and Scratchpad tabs.

## Preview and export

- **Preview** (⌘E, or the button in the editor's title bar): the PDF exactly as it will export, beside the editor, updated as you type; it follows the editor, and scrolling it yourself moves the editor to match (the editor never moves while you type in it). Clicking a line takes you to it; Sync turns the following off.
- **Export PDF** (in the Preview's toolbar, or the Command Palette): the PDF.
- **Export Text** (title bar button): the text as `.fountain`, `.md` or `.txt` without revision marks; the save dialog's format menu offers plain text as well as the document's own kind. An export is always a new file, outside the writing history: edited and saved, it starts a history of its own. To change the kind of file a work is kept in, convert it instead (see Plain files).
- **Export Word Document** (manuscripts; in the Preview's toolbar, or the Command Palette): a `.docx` laid out like the PDF, built from ordinary Word styles, a real header with page numbers, lists and tables, so it can be edited and resubmitted. Word does its own page breaks, so the page count can differ slightly from the PDF. The **Docx Font** setting (`highwater.docxFont`) chooses Courier New (the default; on every computer) or the PDF's Courier Prime, embedded in the file (shown by Word and LibreOffice, not by Pages or Google Docs).
- **Templates:** Screenplay, Multi-Cam, Stage Play, Graphic Novel, Manuscript and Plain Text, measured line for line, and Novel, Treatment, Modern Standard, Article, Bulletin, Speech, MLA Report and Wiki, closely matched, against Highland 2's own PDFs; the active one is shown in the status bar (click to change it) and saved in the document as Highland 2 does. `{{HEADER}}`, `{{FOOTER}}`, `{{PAGENUMBER}}`, `{{SERIES}}`, `{{TIMESTAMP}}`, `{{TOC}}` and `{{INCLUDE}}` work. A few of Highland 2's layout quirks are fixed rather than copied: a footer's middle part is centred, `%pp` counts pages after `{{PAGENUMBER}}`, text never runs over the footer, block quotes wrap at the margin and there is no blank last page.

## Writing history

New in Highwater Too: every save is recorded in a git repository, as a record of how each work was written. It needs git (on a Mac, the Xcode command-line tools).

- One repository for all your writing, in your system's application-data folder (on a Mac, `~/Library/Application Support/Highwater Too/History`); one branch per work, so one work's history can be shared without the others. **Change Writing History Location…** moves it.
- ⌘S records at once; autosaves at most every five minutes. Each record says how many words changed.
- Each save records exactly what is inside the `.highland` file, unpacked: the text, Bin, Scratchpad, settings and images. A plain file's save holds the same, as far as it has them. Every save also names the kind of file the work is kept in and the file's name. On another computer with the same mirror, a plain file's Bin and Scratchpad come in with its saves (unless they were changed there too, when that computer's stay).
- A plain file is found in the history by its path. **Link Writing History to This File** adds a note at its end naming its history (notes never print), so it is found even after a move. A moved, unlinked file is recognised from the catalog by its exact text or its file name, after asking (see Recognising files).
- **Open Work from History…** (Writing History panel): lists every work in the history, including works saved only on another computer and brought in through the mirror. A work already on this computer opens. Any other is restored exactly as its latest save was kept, as a `.highland` or plain file under its recorded name, and continues the same history; to change its kind of file, convert it afterwards.
- **Writing History** panel: click a save to compare it with the text now; right-click it for **Revert to This Save…**, which puts that save's text (and its Bin and Scratchpad) into the document. Saving records it as a revert, and every later save stays in the history. **Export Writing History…** writes one work's history to a file anyone can open with `git clone`.
- **Works** panel: every work in the writing history, here or only on the mirror, newest first; a work on this computer expands to its saves. Right-click a work to open or restore it, **Remove from This Computer…** (its history stays on the mirror, sent there first, and can be restored later) or **Delete Writing History…** (permanent, after a warning; with a mirror you choose to delete it everywhere, or only on this computer, which then never fetches it back). The file itself is never deleted: kept and worked on, it starts a new history, and a plain file keeps its Bin and Scratchpad.
- **Connect to a Work's History…** (Writing History panel menu): joins the open document, and its own history if it has one, to another work's history; it lists works whose file is no longer where it was saved. Use it when a `.highland` file was saved in Highland 2, edited and renamed: Highland removes the file's link to its history when it saves, so its next save in VS Code starts a new history. Joining is permanent and confirmed first.
- **Newer saves from another computer:** when a sync brings newer saves of a work whose file is open here (or you switch to it), and the file is an older save, it asks: **Update to the Latest** (the file becomes the newest version) or **Keep This Version** (carry on with the open file; your next save makes it the newest version). With unsaved changes it offers **Open the Latest Beside It** instead. Until you choose, the file's saves are not recorded; the history item in the status bar asks again.
- **Joining copies:** if a file was copied to a computer without the mirror and worked on there, its history there starts from a save of the original. When that computer connects to the mirror, it offers to join the two histories (both are kept) or keep them separate.
- **Set Up History Mirror…** (optional) keeps the history in step with any git remote: it pushes after saves, and pulls other computers' saves of the works on this computer when VS Code starts, when you open a document (at most once a minute) and every ten minutes. A computer holds only the works used on it: a work saved elsewhere comes here only when you restore it or connect a file to it. Every computer knows the others' works by a small catalog (titles, file names, dates and text hashes, no writing), which is how Open Work from History… lists them. Nothing is ever overwritten: when two computers both saved a work, the histories are joined. Use the same mirror address on each computer. **Sync Writing History Now** (in the Writing History panel's menu) pulls and pushes at once. Signing in: github.com uses VS Code's GitHub sign-in; for other servers over HTTPS (Gitea, Forgejo, GitLab, …) you are asked for your username and an access token the first time the server wants them, kept in VS Code's secure storage and sent only to that server (if git already has a login for it, in the Mac keychain say, that is used without asking). **Sign In to History Mirror…** and **Forget History Mirror Sign-In** are in the panel's menu; when a sign-in is needed, the history item in the status bar shows a warning and clicking it signs in. SSH addresses use your SSH key.
- **Recognising files:** a file this computer has no history for is looked up in the catalog, by its ID, by its text (exactly a save's text, if it has at least the minimum number of words) or by its file name. It is always asked before anything is fetched. If the file is not the work's latest save, you choose how it continues (update it to the latest, keep this version, join from its text, or keep it as a separate copy); there is no default, and until you choose, its saves are not recorded (the status bar's history item says so; click it to choose).
- **Copies and moves:** a file found by its ID or text while the work's own file is still there, and still the work's, is a copy (Finder's Duplicate, a sync service's conflicted copy). You're asked: **Keep as a Separate Work** (it gets a history of its own) or **Make This the Work's File** (the history carries on with it; the old file is asked about if opened again). No default; until you choose, its saves are not recorded. If the work's file is gone, the new file is the work's file moved, and the history follows it without asking. Only the work's current path counts: a new file where a work used to be is not that work. A `.highland` file made with Save As… after a conflict is a new document from the start.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `highwater.highlandShortcuts` | on | Highland 2's shortcuts in documents (⌘E Preview, ⌘L Live Margins, ⌘0 sidebar, ⌘1/⌘2/⌘4/⌘5 panels, ⇧⌘I Show Invisibles) instead of VS Code's. Off: Preview is ⌃⌥P and Live Margins ⌃⌥L. |
| `highwater.showSidebarOnOpen` | on | Switch to the Highwater Too sidebar when a document is opened. |
| `highwater.docxFont` | Courier New | Font for Export Word Document: Courier New, double-spaced, or Courier Prime embedded in the file, as in the PDF. |
| `highwater.writingHistory` | on | Record saves in the writing history. |
| `highwater.historyFolder` | (system default) | Where the writing history and session backups are kept. |
| `highwater.historyRemote` | (none) | A git remote to mirror the writing history to. |
| `highwater.fontSize` | 0 | Text size in the Highland-Style Editor, in pixels; 0 is VS Code's editor size × 1.4, about Highland 2's. ⌘+, ⌘− and ⌥⌘0 change it. |
| `highwater.themeWindow` | on | Choose Theme… also switches VS Code's colour theme to the matching Highwater one, so the whole window matches. |
| `highwater.paragraphNumbers` | off | Highland 2's paragraph numbers in the Highland-Style Editor's margin. |
| `highwater.spellCheck` | off | Check spelling while typing in the Highland-Style Editor (American English). |
| `highwater.spellingWords` | none | Words added with **Learn Spelling**. |
| `highwater.theme` | Match VS Code | Highland 2's colour theme for the Highland-Style Editor and the Navigator (Classic, Dracula, Solarized and the rest). |
| `highwater.highlandEditor` | on | Open documents in the Highland-Style Editor. Off: they open as text (the book button still switches). |
| `highwater.historyMatchMinWords` | 50 | The fewest words a file's text must have to be recognised as a save of a work, so empty files and templates never match. |

## Known limitations

- With Live Margins on, while you type the first words of a line VS Code may briefly show "…" where part of the margin should be; it settles within about a second of a pause.
- The prose templates (Novel, Treatment, Modern Standard, Article, Bulletin, Speech, MLA Report, Wiki) match Highland 2's look closely, not line for line: their line and page breaks can differ. They use Highland 2's fonts: Highland Sans, Amiri, Lato and Merriweather come with Highwater Too; Georgia, Times New Roman and Avenir Next (macOS) and SF Pro Display and New York (found in Highland 2's app) are used when installed. Otherwise Gelasio prints for Georgia and Tinos for Times New Roman (both with the same character widths), Merriweather for New York and Lato for Avenir Next and SF Pro, with a note when you export. Multi-Cam prints with its default options. Live Margins show the Screenplay layout whatever the template.
- Live Margins cannot indent the continuation of a wrapped line (VS Code's editor does not allow it).
- `{{TOC: ##}}` with a level filter prints its entries; Highland 2 prints it oddly.
- No Stats panel (⌘3), Sprint, Gender Analysis, Revision Mode or FDX yet; `.textbundle` files are not supported.

## Licence

MIT. Courier Prime is © The Courier Prime Project Authors, under the SIL Open Font License 1.1. The spelling dictionary is Hunspell's en_US from SCOWL (Kevin Atkinson and others), under its own permissive licence (MIT and BSD; `dist/dictionary-en/license`). Highwater Too is not affiliated with Quote-Unquote Apps or Highland 2.
