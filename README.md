# Highwater Too

A VS Code extension that replaces the discontinued Highland 2: it opens, edits and saves `.highland` files safely, gives screenplays and manuscripts a Highland-style workspace, exports PDFs that match Highland's, and keeps a git writing history as a record of authorship.

**Status:** M0–M3 done (bundle I/O, parser, editing in VS Code); M4 (screenplay PDF) in progress. See the spec for decisions and the build plan.

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
