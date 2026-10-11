# Highwater Too

A VS Code extension that replaces the discontinued Highland 2: it opens, edits and saves `.highland` files safely, gives screenplays and manuscripts a Highland-style workspace, exports PDFs that match Highland's, and keeps a git writing history as a record of authorship.

**Status:** M0–M6 done (bundle I/O, parser, editing, screenplay and manuscript PDF, workspace); M7 (writing history) built and in testing; M8 (release) next. See the spec for decisions and the build plan.

## Plain .fountain, .md and .txt files

`.highland` files always open with Highwater Too, and `.fountain` files open as **Highwater Fountain**. Other plain files keep their usual language unless you choose otherwise:

- **One file:** click the language name in the status bar (for example "Markdown") and choose **Highwater Fountain**, **Highwater Markdown** or **Highwater Plain Text**. VS Code remembers the choice for that file.
- **Every .md file:** run **Highwater Too: Open .md Files with Highwater Too…** and choose everywhere or this workspace (it sets `files.associations`). **Open .md Files as Ordinary Markdown Again** undoes it. VS Code's own Markdown preview and Markdown extensions do not apply to files opened this way, and Highland's Markdown dialect differs from standard Markdown in places (every line is a paragraph, `===` is a page break).

Plain files get the Navigator, preview, PDF export, Live Margins, the Title Page Builder and the writing history. The Bin, Scratchpad and Assets live inside `.highland` files, so plain files do not have them.

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
```

The pixel comparison needs poppler's `pdftoppm` (`brew install poppler`); its tests are skipped without it.

## Licence

MIT. The PDF engine is our own, written against Highland 2's measured layouts; its approach to dual dialogue and (MORE)/(CONT'D) follows [Better Fountain](https://github.com/piersdeseilligny/betterfountain) (MIT, © Piers Deseilligny), but no code is copied from it.

`packages/pdf/fonts` holds Courier Prime 1.203 (the version Highland 2 embeds), © The Courier Prime Project Authors, under the SIL Open Font License 1.1 (`packages/pdf/fonts/OFL.txt`).
