# Changelog

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
