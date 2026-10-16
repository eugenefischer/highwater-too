# Changelog

## 0.2.11

- Clearer wording when a file has newer saves from another computer: what this file is, when the newest version was saved, and what each choice does ("Keep This Version: carry on with the currently open file, edits included. When you next save, it becomes the newest version.").

## 0.2.10

- Fixed: character completion waited for an L or N in the name (CAMPBELL at "CAMPBEL", COLLEGE KID at "COL", INGRAM at "IN"). The documents' word pattern used Unicode letter classes, which VS Code compiles without the Unicode flag unless told to, so only the letters p, L and N (and a few marks) counted as parts of words. Words are now whole names, which also fixes ⌘D (select the word at the cursor) and other commands that act on the word at the cursor. (Double-click and ⌥←/⌥→ use a separate VS Code setting and were not affected.)
- The 0.2.5 change to completion (asking again after the first letter) is removed: it rested on a wrong explanation and was not needed.

## 0.2.9

- Preview: a scrollbar press now allows two seconds for the drag to start, so pressing and pausing before dragging still moves the editor.

## 0.2.8

- Fixed: 0.2.7 broke the Preview's sync. A press on the Preview's scrollbar marked a drag in progress, and the browser often never reports the release, so the Preview took every later scroll as yours and stopped following the editor (and a resize could move the editor again). A press now counts only while the scrolling it causes goes on.

## 0.2.7

- Fixed: while typing with the Preview open, the editor could jump. After a refresh the Preview kept its place by proportion, and at some widths its pages settled a pixel or so later; that settling was taken for the writer scrolling the Preview and sent to the editor. Now the editor leads: the Preview lines up with the editor's top line after every refresh and resize, and only scrolling you do in the Preview (wheel or trackpad, keys, its scrollbar) moves the editor.

## 0.2.6

- Fixed: with Live Margins on, transitions and other lines indented more than 43 characters had their margin cut short with "…" (VS Code's default limit for inlay hints; now off in Highwater documents).
- Known: while you type the first words of a line, VS Code may briefly show "…" at the left edge in place of part of the margin. VS Code holds margins before the cursor at their previous width while typing; it settles within about a second. Left as is; a Highland-style editor (M15) would not have it.

## 0.2.5

- **Changes made elsewhere** now ask as Highland 2 does: **Save Anyway** (keep your changes), **Revert** (keep the other application's), **Save As…**, or **Compare**. The version that loses is kept: as a save in the writing history noting it was set aside, or in the backups when the history is off.
- Fixed: images dragged from the Assets panel into the text arrived as the image file's address instead of an image. The panel's items carry their file's address, and VS Code inserted that; dropping a document's own image now inserts `![name](assets/name.png)`.
- Fixed: Bin cut and copy (⌥⌘X, ⌥⌘C, and the right-click items) did nothing in plain `.fountain` and `.md` files.
- Fixed: the Bin panel did not show a Bin item's changes after it was saved in its tab (or after Revert to This Save) in a `.highland` file.
- Fixed: character name completion often came only after most of the name was typed. At the first capital nothing is offered (it may be action), and VS Code took that as final for the word; it now asks again at the second letter.
- Reading time for prose is now 250 words a minute, as Highland 2 states it (was 230).
- Export Text offers plain text (`.txt`) as well as the document's own kind, and leaves out the note linking a plain file to its history.
- Conversions are also in the editor's “…” menu and the tab's right-click menu.
- The Move to Trash question after a conversion offers **Keep** instead of Cancel.

## 0.2.4

- **Connect to a Work's History…** (Writing History panel menu, Command Palette): joins the open document to another work's history, by your choice. It lists works whose file is no longer where it was saved, newest first, or every work. A document with a history of its own is joined to the work in one merge (both kept, no longer separable); one without continues the work from its current text, recorded as `Connect`. A confirmation spells this out first. This is for a `.highland` file that lost its link to its history: Highland 2 removes the link when it saves, so a file saved in Highland, then edited and renamed, starts a new history when VS Code next saves it.
- Fixed: **Delete Everywhere** did not always stick. A work fetched to a computer but never opened there survived the deletion on that computer and was pushed back to the mirror, so other computers could still restore it; and a computer that pushed before pulling could push a deleted work back. Deletion now goes by the work's branch, every pull, push or fetch applies the catalog's deletions first, and a push takes off the mirror any work recorded as deleted.
- Fixed: a moved plain file was only recognised when first saved, not when opened, if it was the first document opened in the session.
- Restore asks where to save before fetching, so a cancelled restore leaves nothing on this computer. Fetching a work deleted since the last sync says so instead of failing.
- The Works panel's Refresh brings the catalog up to date from the mirror first.

## 0.2.3

- **Newer saves from another computer:** when a sync brings newer saves of a work whose file is open here, or you switch to such a file, and the file is an older save, you are asked: **Update to the Latest** (the file, its Bin and its Scratchpad become the latest save) or **Keep This Version** (your next save goes back to it, recorded as a `Revert`). With unsaved changes, or changes since that save, **Open the Latest Beside It** takes the place of Update, and you are asked again when you next save. No choice is pre-selected; until you choose, the file's saves are not recorded. Nothing is asked when the file is the latest save, and each latest save is asked about once.
- **The panes follow the focused document:** Navigator, Bin, Assets and Writing History show the document you are in, and switch as soon as you move to another. Moving to a file that is not a Highwater document, or closing the document, empties them. Moving to the panes, the Preview, a save from the history, or the document's Bin items or Scratchpad keeps it. The Writing History panel fills in by itself, including for a `.md` file switched to Highwater Markdown.
- **Closing a document closes its Bin items and Scratchpad:** when the document's last tab closes, any open tabs of its Bin items or Scratchpad close too (unsaved ones ask, as VS Code does), for `.highland` and plain files.

## 0.2.2

- **Works panel** in the Highwater Too sidebar: every work in the catalog, on this computer or only on the mirror, newest first, with its saves (click one to compare it with the file, or to read it if the file is not here). Right-click: Open, Restore…, Remove from This Computer…, Delete Writing History….
- **Revert to This Save…** (right-click a save in the Writing History panel): the save's text replaces the document's, unsaved, and its Bin and Scratchpad come back; saving records a `Revert` naming the save. Nothing later is lost.
- **Remove from This Computer…:** sends the work's latest saves to the mirror, then removes its history from this computer and prunes the repository so none of its data is left here. It can be restored, or its file connected again, later.
- **Delete Writing History…:** permanent, after a warning that names how many saves go. With a mirror, **Delete everywhere?** removes it from the mirror and, through a deletion record in the catalog, from every computer when it next syncs; **Only on This Computer** deletes it here and never fetches it back. The file is not touched: a `.highland` file gets a new ID on its next save and a plain file keeps its Bin and Scratchpad, starting a new history.
- **Joining copies:** after a sync, a history on this computer that began from a save of another work (a copy worked on offline) is offered to be joined with it: both histories are kept, in a merge on the original work's branch. A different kind of file asks Make This File the Work's File or Keep as a Separate Copy.
- The mirror no longer sets a default fetch, so nothing but what is asked for is copied here.

## 0.2.1

- **Fetching on demand:** a computer holds only the works used on it. Pulling brings `main` and the works already here; a work saved elsewhere is fetched only when you restore it, or connect a file to it. Pushing sends `main` and this computer's works.
- **The catalog on `main`:** for every work, its title, form, file name, last save and the text hash of every save (no writing), one folder per work. When two computers change it, it is merged by fixed rules (hash lists combined, the later save's details kept). The README is written from it. Open Work from History… lists works on the mirror as well as here, and fetches one when you choose it.
- **Recognising files:** a file this computer has no history for is looked up in the catalog by its ID, then by its text's hash (texts with fewer words than the new `highwater.historyMatchMinWords` setting, default 50, are skipped), then by its file name. It always asks before fetching or connecting. Once connected: a different kind of file asks Make This File the Work's File or Keep as a Separate Copy; an older save asks Update to the Latest, Keep This Version (recorded as a Revert) or Keep as a Separate Copy; a `.highland` file edited since an older save asks Open the Latest Beside It, Keep This Version or Keep as a Separate Copy; a text matching no save asks Join, Continuing from This Text or Keep as a Separate Copy. No choice is pre-selected; until you choose, the file's saves are not recorded, and the status bar's history item asks again.
- Matching a file to a history by guessing from similar text is gone: only IDs, paths, exact text hashes and (asked) file names.
- Fixed: a plain file's save could be recorded without its Bin and Scratchpad when the writing history was turned on (or its folder changed) just before. A second copy of the history was started for the same folder and raced the first, and a stale lookup could hide the Bin; now there is one per folder, and each save looks the Bin up afresh.

## 0.2.0

**Start a new writing history before installing:** this version records saves in a new layout and does not read histories made by earlier versions. Delete the history folder (on a Mac, `~/Library/Application Support/Highwater Too/History`) on each computer, and the mirror's repository if you use one.

- Each save now holds exactly what is inside the `.highland` file, unpacked (zipped, a save is that file): the text, `bin/`, `scratchpad.txt`, `info.json`, `assets/` and the rest, at the same paths. A plain file's save holds the same, as far as it has them; its print template is kept in an `info.json` as a `.highland` file keeps it. Converting between the two leaves the recorded files unchanged.
- Every save names the kind of file the work is kept in and the file's name (`Highwater-Form`, `Highwater-File`). New kinds of save: `Revert` and `Restore`; `Convert`, `Revert` and `Restore` are recorded even when nothing changed.
- `.highland` files note which text they last saved (`highwaterToo.savedText` in `info.json`, not recorded in the history), for recognising copies that fall behind in a later version.
- **Open Work from History…** opens a work already on this computer, and restores any other exactly as its latest save was kept, under its recorded name. Restoring an older save, or as another kind of file, is gone: going back to an older save from the open document comes in a later version, and converting is done after restoring.

## 0.1.6

- **Convert to .highland File…** (was Save as .highland File…) and new **Convert to .fountain / .md / .txt File…** (by the text type) move a work between a `.highland` file and a plain file. The writing history, Bin, Scratchpad, images and print template go with it, so the history stays one branch whichever way it goes; each conversion is a `Convert` save naming the new file. A plain file made from a `.highland` file keeps the rest of it (settings, characters, navigator filters), so converting back restores it, and the history's text, Bin and image files are unchanged by a round trip. The file a work was converted from is no longer tracked; you are asked whether to move it (and its images folder) to the Trash.
- **Export Text** now works for plain files too, and an export is always a separate file outside the writing history: it no longer joins the original's history by matching its text. Exporting over a file that has its own history is refused.
- Fixed: restoring a work with Open Work from History… to the path of a file it had been converted from left that path untracked.

## 0.1.5

- Plain `.fountain` and `.md` files get the Bin, Scratchpad and Assets. A plain file can't hold them, so the Bin and Scratchpad are kept with the writing history (in its folder, under `extras`) and recorded with each save, and images go in a visible `<name> assets` folder beside the file, made only when the first one is added. The first time any of them is used with a plain file, a one-time warning says they are not part of the file and only Highwater Too shows them, and offers Save as .highland File… instead. With the writing history off, they are kept on this computer.
- A plain file's print template is kept with its Bin and Scratchpad, so it is recorded and mirrored too (it was kept per workspace).
- On another computer, a plain file's Bin and Scratchpad come in from the mirror with its saves, unless they were changed there as well.
- **Save as .highland File…** brings a plain file's Bin, Scratchpad, images (their paths in the text follow) and print template into the new file, which continues the file's writing history. The plain file is left as it was, with an offer to move it (and its images folder) to the Trash; if it is kept and saved again, it starts a history of its own.
- **Open Work from History…** restores a plain file with its Bin, Scratchpad and images, and makes a complete `.highland` file from a plain file's save.
- **Link Writing History to This File** (Command Palette): adds a note naming the file's writing history at its end, so the history and extras follow the file through a move and heavy rewriting. The note never prints and is not listed in the Navigator.

## 0.1.4

- History mirror on Gitea, Forgejo, GitLab or any HTTPS server: asks for your username and an access token when the server wants a login (with a link to Gitea's and Forgejo's token page), keeps them in VS Code's secure storage and uses them for every push and pull, for that server only. A login problem shows as a warning on the status bar's history item (click to sign in) instead of being retried. Set Up History Mirror checks the address at once and says what is wrong: sign-in, a missing repository (offered to create it), or an unreachable server. New: Sign In to History Mirror…, Forget History Mirror Sign-In.
- The history repository's README (on its `main` branch, which is what a mirror's web page shows) explains what the repository is, lists every work with its branch, what each commit holds, and how to get a work back or share one. Existing histories get it the next time VS Code starts.
- Everything since 0.1.3's first build: history pulling and Open Work from History, markers that never print, lyrics in Live Margins, line numbers off by default.

## 0.1.3

- Completion in screenplays: character names, scene-heading prefixes, the script's locations, times of day and transitions.
- Markers: Insert Marker (⌃M) and Go to Next Marker (⌃⌥M), written as Highland 2 writes them. Markers never print: the text lays out as if they were not there (Highland 2 breaks the line at a marker; that is not copied).
- Live Margins: lyrics at the dialogue indent.
- Line numbers are off in documents by default (turn them back on with VS Code's Line Numbers setting).
- Navigator: drag scenes, sections and headings to reorder the text.
- Syntax Cheat Sheet, from the Navigator's title bar or the Command Palette.
- Writing history mirror now pulls as well as pushes: other computers' saves come in on start-up, when a document is opened (at most once a minute) and every ten minutes; histories are matched to documents by ID, then by text. **Sync Writing History Now** replaces Push Writing History Now.
- Each save also records the rest of the `.highland` file (settings, assets). **Open Work from History…** rebuilds any work at any save, from this computer or another one, as a `.highland` or plain file that continues its history.

## 0.1.2

- **Export Word Document (.docx)** for manuscripts: the PDF's layout in ordinary Word formatting (styles, header and footer with page-number fields, title page, real lists, tables, table of contents, links, images). Font setting: Courier New, double-spaced (default), or Courier Prime embedded in the file.
- The editor's title bar has just Preview and Export Text; Export PDF and Export .docx (for manuscripts) are in the Preview's toolbar, and both stay in the Command Palette.

## 0.1.1

- **New Document…** in the sidebar (on the empty Navigator and as a button in its title bar) and the Command Palette: a blank screenplay or manuscript, as a `.highland` file or a plain `.fountain` or `.md` file.
- **Open Document…** opens `.fountain` and `.md` files as well as `.highland` files.

## 0.1.0 — first release

- Open, edit and save `.highland` files safely: the script as an editor tab, everything else in the file kept; backups before the first save of each session; changes made elsewhere reload or offer Revert, Save, Save As or Compare.
- Highwater Fountain, Markdown and Plain Text: highlighting, outline, folding, Highland's writing keys, word and page counts.
- Sidebar: Navigator, Bin, Assets, Scratchpad and Writing History; Live Margins; Title Page Builder.
- PDF preview and export with the Screenplay and Manuscript templates, matching Highland 2's PDFs line for line on the test documents; preview scrolls with the editor; print template in the status bar.
- Writing history: every save in a git repository, a branch per work; history panel and comparison; export of one work; optional mirror to any git remote.
