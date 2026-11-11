# Highwater Too

A VS Code extension that replaces the discontinued Highland 2: it opens, edits and saves `.highland` files safely, gives screenplays and manuscripts a Highland-style workspace, exports PDFs that match Highland's, and keeps a git writing history as a record of authorship.

**Status:** version 0.5.2 (with M15: the Highland-Style Editor is the default): the MVP (M0–M8) and M9 are built, with Bin, Scratchpad and Assets for plain files, conversion between `.highland` and plain files, and the second version of the writing history (a catalog of works, fetching on demand, recognising files, the Works panel, reverting, removing and deleting, offering newer saves from other computers, and connecting a file to a work by hand). M10 (more templates) built: all fourteen of Highland 2's templates, the scripts and Plain Text line for line, the eight prose templates as a close match. In real-world testing. See the spec for decisions and the build plan.

## Plain .fountain, .md and .txt files

`.highland` files always open with Highwater Too, and `.fountain` files open as **Highwater Fountain**. Other plain files keep their usual language unless you choose otherwise:

- **One file:** click the language name in the status bar (for example "Markdown") and choose **Highwater Fountain**, **Highwater Markdown** or **Highwater Plain Text**. VS Code remembers the choice for that file.
- **Every .md file:** run **Highwater Too: Open .md Files with Highwater Too…** and choose everywhere or this workspace (it sets `files.associations`). **Open .md Files as Ordinary Markdown Again** undoes it. VS Code's own Markdown preview and Markdown extensions do not apply to files opened this way, and Highland's Markdown dialect differs from standard Markdown in places (every line is a paragraph, `===` is a page break).

Plain files get the Navigator, preview, PDF export, Live Margins, the Title Page Builder and the writing history, and the Bin, Scratchpad and Assets too. A plain file can't hold a Bin or Scratchpad, so those are kept with the writing history rather than in the file (only Highwater Too shows them, and a one-time warning says so), and images go in a `<name> assets` folder beside the file, made when the first one is added. **Convert to .highland File…** gathers them all into one `.highland` file, and **Convert to .fountain / .md / .txt File…** goes back; the writing history, Bin, Scratchpad and images move with the work either way. Exports (Export Text) are always separate files outside the history.

## Writing history (new; Highland 2 had nothing like it)

Every save is recorded in a git repository, as a record of how each work was written. It is on by default and needs nothing set up beyond git itself (on a Mac, the Xcode command-line tools).

- **What a save holds:** exactly what is inside the `.highland` file, unpacked (zipped, a save is that file): the text (revision marks included), `bin/`, `scratchpad.txt`, `info.json`, `assets/` and the rest. A work kept as a plain `.fountain`, `.md` or `.txt` file has the same files as far as it has them; its Bin and Scratchpad are kept by Highwater Too, not in the file. Each commit names the work's ID, the kind of file it was kept in and the file's name.
- **When:** each ⌘S at once; autosaves at most every five minutes, and once more when the document closes. Each commit says when it was made and how many words it added or removed (Save, Autosave, Close, or Convert, Revert and Restore for those actions). A failed commit never blocks a save.
- **Where:** one repository for all your writing, in your system's folder for application data (`~/Library/Application Support/Highwater Too/History` on a Mac, `~/.local/share/highwater-too/history` on Linux, `%LOCALAPPDATA%\Highwater Too\History` on Windows). **Change Writing History Location…** moves it; folders kept in sync by Dropbox, iCloud and the like are best avoided, as syncing can damage git repositories.
- **One branch per work**, with no history shared between them, so one work's history can be shared or deleted without touching the others. `main` holds a README and a catalog of the works (titles, file names, dates and text hashes; no writing). **Export Writing History…** writes a single work to a git bundle that anyone can open with `git clone`.
- **Finding a document's history:** a `.highland` file carries an ID in `info.json` (put back if Highland 2 drops it); a plain file is found by its path, or by its ID if it was linked with **Link Writing History to This File**. A file the history does not know is looked up in the catalog by ID, by its exact text, or by its file name, and you are always asked before it is connected. A file that is not the work's latest save asks how it continues (update to the latest, keep this version, join from its text, or keep it as a separate copy); until you choose, its saves are not recorded. A copy of a work's file (the original still there) asks whether it is a separate work or the work's file now; a moved file is followed without asking.
- **Converting and exporting:** **Convert to .highland File…** and **Convert to .fountain / .md / .txt File…** move a work between kinds of file and keep one history; the file left behind is no longer tracked. Exports are always new files outside the history.
- **Seeing it:** the **Writing History** panel lists the current document's saves; click one to compare it with the text now, or right-click for **Revert to This Save…** (saving records the revert; nothing later is lost). The **Works** panel lists every work, here or only on the mirror. The status bar shows when the last save was recorded.
- **Mirror (optional):** **Set Up History Mirror…** keeps the repository in step with any git remote: GitHub, GitLab, Gitea or Forgejo, an SSH server, or another disk. It never force-pushes, joins saves made on two computers instead of overwriting either, and can create the remote repository for you. Each computer holds only the works used on it: a work saved elsewhere is fetched only when you restore it (**Open Work from History…** or the Works panel) or connect a file to it. A copy worked on offline and connected later is offered to join its original's history. A remote you do not control also gives your timestamps an independent witness.
- **Removing and deleting:** **Remove from This Computer…** takes a work's history off this computer, leaving it on the mirror. **Delete Writing History…** deletes it permanently, everywhere or only on this computer. Neither touches the file, which starts a new history if you keep working on it.
- **Turning it off:** for one document from the panel, or everywhere with the **Writing History** setting.

## Layout

```
packages/
  parser/      Fountain + Markdown + Highland directives -> document tree with exact spans
  bundle/      .highland ZIP read/write, info.json model, unknown-entry passthrough
  pdf/         layout engine for Highland's Screenplay and Manuscript templates, on PDFKit
  history/     the writing history: one git repo, a branch per work, catalog on main, mirror
  extension/   VS Code glue: file system provider, tree views, commands, decorations, PDF viewer
tools/
  pdf-compare/ PDF line/position comparison (+ pixel backup) against Highland's reference PDFs
  scripts/     design-phase Python helpers
fixtures/      generated Highland samples and their reference PDFs
```

Only `packages/extension` may import `vscode`.

## Commands

```sh
npm install
npm run ci            # typecheck + tests + build
npm test              # Vitest
HIGHWATER_PRIVATE_FIXTURES=… npm test   # also runs the tests on the private Highland samples
npm run test:e2e -w highwater-too       # end-to-end tests in a downloaded VS Code
npm run package -w highwater-too        # builds highwater-too.vsix
npm run pdf-compare -- expected.pdf actual.pdf [--tolerance 1] [--pixels]
node --experimental-strip-types tools/scripts/check-documents.ts <folder>   # release check: every .highland file opens, saves unchanged and lays out
```

**Releasing:** set the version in `packages/extension/package.json`, add it to `packages/extension/CHANGELOG.md`, commit, then tag and push (`git tag v0.1.0 && git push origin v0.1.0`). The Release workflow tests, builds the `.vsix` and attaches it to a GitHub Release. The extension's own page text is `packages/extension/README.md`.

The pixel comparison needs poppler's `pdftoppm` (`brew install poppler`); its tests are skipped without it.

## Licence

MIT. The PDF engine is our own, written against Highland 2's measured layouts; its approach to dual dialogue and (MORE)/(CONT'D) follows [Better Fountain](https://github.com/piersdeseilligny/betterfountain) (MIT, © Piers Deseilligny), but no code is copied from it.

`packages/pdf/fonts` holds Courier Prime 1.203 (the version Highland 2 embeds), © The Courier Prime Project Authors, under the SIL Open Font License 1.1 (`packages/pdf/fonts/OFL.txt`). The Highland-Style Editor's spelling dictionary is the `dictionary-en` package (Hunspell en_US from SCOWL; MIT and BSD), bundled from `node_modules` at build time with its licence.
