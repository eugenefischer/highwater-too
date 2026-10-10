# Highwater Too

A VS Code extension that replaces the discontinued Highland 2: it opens, edits and saves `.highland` files safely, gives screenplays and manuscripts a Highland-style workspace, exports PDFs that match Highland's, and keeps a git writing history as a record of authorship.

**Status:** milestone M0 (repo and test harness). See the spec for decisions and the build plan.

## Layout

```
packages/
  parser/      Fountain + Markdown + Highland directives -> document tree with exact spans
  bundle/      .highland ZIP read/write, info.json model, unknown-entry passthrough
  pdf/         forked Better Fountain engine (screenplay) + manuscript layout, on PDFKit
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
npm run pdf-compare -- expected.pdf actual.pdf [--tolerance 1] [--pixels]
```

The pixel comparison needs poppler's `pdftoppm` (`brew install poppler`); its tests are skipped without it.

## Licence

MIT. `packages/pdf` will include code forked from [Better Fountain](https://github.com/piersdeseilligny/betterfountain) (MIT, © Piers Deseilligny); its notice must be kept there.
