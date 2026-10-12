# Highwater Too

A VS Code extension that replaces the discontinued Highland 2: it opens, edits and saves `.highland` files safely, gives screenplays and manuscripts a Highland-style workspace, exports PDFs that match Highland's, and keeps a git writing history as a record of authorship.

**Status:** version 0.1.0, the MVP release (M8): M0–M7 built; the writing history is in real-world testing. See the spec for decisions and the build plan.

## Plain .fountain, .md and .txt files

`.highland` files always open with Highwater Too, and `.fountain` files open as **Highwater Fountain**. Other plain files keep their usual language unless you choose otherwise:

- **One file:** click the language name in the status bar (for example "Markdown") and choose **Highwater Fountain**, **Highwater Markdown** or **Highwater Plain Text**. VS Code remembers the choice for that file.
- **Every .md file:** run **Highwater Too: Open .md Files with Highwater Too…** and choose everywhere or this workspace (it sets `files.associations`). **Open .md Files as Ordinary Markdown Again** undoes it. VS Code's own Markdown preview and Markdown extensions do not apply to files opened this way, and Highland's Markdown dialect differs from standard Markdown in places (every line is a paragraph, `===` is a page break).

Plain files get the Navigator, preview, PDF export, Live Margins, the Title Page Builder and the writing history, and the Bin, Scratchpad and Assets too. A plain file can't hold a Bin or Scratchpad, so those are kept with the writing history rather than in the file (only Highwater Too shows them, and a one-time warning says so), and images go in a `<name> assets` folder beside the file, made when the first one is added. **Save as .highland File…** gathers them all into one `.highland` file that continues the writing history.

## Writing history (new; Highland 2 had nothing like it)

Every save is recorded in a git repository, as a record of how each work was written. It is on by default and needs nothing set up beyond git itself (on a Mac, the Xcode command-line tools).

- **What is kept:** the text of each save (revision marks included), the Bin and Scratchpad, and the rest of the document: a `.highland` file's settings and images, or a plain file's print template and images.
- **When:** each ⌘S at once; autosaves at most every five minutes, and once more when the document closes. Each commit says when it was made and how many words it added or removed. A failed commit never blocks a save.
- **Where:** one repository for all your writing, in your system's folder for application data (`~/Library/Application Support/Highwater Too/History` on a Mac, `~/.local/share/highwater-too/history` on Linux, `%LOCALAPPDATA%\Highwater Too\History` on Windows). **Change Writing History Location…** moves it; folders kept in sync by Dropbox, iCloud and the like are best avoided, as syncing can damage git repositories.
- **One branch per work**, with no history shared between them, so one work's history can be shared or deleted without touching the others or rewriting anything. **Export Writing History…** writes a single work to a git bundle that anyone can open with `git clone`.
- **Moving and renaming:** a `.highland` document carries an ID that ties it to its history (put back if Highland 2 drops it on save); other files are found by their path or their text.
- **Seeing it:** the **Writing History** panel in the sidebar lists the current document's saves; click one to compare it with the text as it is now. The status bar shows when the last save was recorded.
- **Mirror (optional):** **Set Up History Mirror…** pushes the repository to any git remote after saves: GitHub, GitLab, Gitea or Forgejo, an SSH server, or another disk. It never force-pushes, joins saves made on another computer instead of overwriting them, and can create the remote repository for you. A remote you do not control also gives your timestamps an independent witness.
- **Turning it off:** for one document from the panel, or everywhere with the **Writing History** setting.

## Layout

```
packages/
  parser/      Fountain + Markdown + Highland directives -> document tree with exact spans
  bundle/      .highland ZIP read/write, info.json model, unknown-entry passthrough
  pdf/         layout engine for Highland's Screenplay and Manuscript templates, on PDFKit
  history/     per-document git repos, path index, commit batching, optional push
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

`packages/pdf/fonts` holds Courier Prime 1.203 (the version Highland 2 embeds), © The Courier Prime Project Authors, under the SIL Open Font License 1.1 (`packages/pdf/fonts/OFL.txt`).
