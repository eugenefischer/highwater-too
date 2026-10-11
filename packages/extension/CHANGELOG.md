# Changelog

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
