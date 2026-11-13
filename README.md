# Highwater Too

**Write screenplays and manuscripts in VS Code, in the `.highland` files of Highland 2.**

[![CI](https://github.com/eugenefischer/highwater-too/actions/workflows/ci.yml/badge.svg)](https://github.com/eugenefischer/highwater-too/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

<!-- Screenshot: a screenplay open in the Highwater Editor, sidebar on the Navigator, a mid-script scene in view. Dark theme, window about 1600×1000. -->
![A screenplay in the Highwater Editor, with the Navigator in the sidebar](docs/images/hero.png)

Highland 2 is no longer developed. Highwater Too picks up where it left off. It opens your existing `.highland` files, gives them a writing space that looks and works like Highland's, prints PDFs laid out the way Highland lays them out, and saves the files so that Highland 2 can still open them. It also adds something Highland never had: a writing history that records every save.

## Highlights

- **Your files, safe.** Every part of a `.highland` file is kept when you save: the text, Bin, Scratchpad, images and settings. Every real Highland file we have tested comes back byte for byte.
- **A page, not a code editor.** The Highwater Editor shows your script in a page-width column of Courier Prime, with dialogue indented on every line, wrapped lines too. It has Highland's top bar, sidebar, themes and shortcuts.
- **PDFs that match Highland's.** All fourteen of Highland 2's templates. The screenplay templates print line for line with Highland's own PDFs, and so do the prose templates when Highland's fonts are installed.
- **A record of how you wrote it.** Every save is kept in a git repository on your computer. You can compare any save with your text now, go back to it, and keep the history in step across computers through any git server.
- **Plain files too.** `.fountain`, `.md` and `.txt` files get the same editor, preview and history.

## Is it for you?

Highwater Too is for writers who used Highland 2, or who want to work the way it worked, and are happy to write inside VS Code.

It doesn't do everything Highland did. Not built yet:

- Statistics, goals and sprints
- Revision Mode and Gender Analysis
- Final Draft (`.fdx`) import and export
- `.textbundle` files

It has been tested on macOS and Linux. It should work on Windows, but nobody has tried it there yet.

## Install

You need **VS Code 1.100** or later. The writing history also needs **git**. On a Mac, if you don't have git yet, run `xcode-select --install` in Terminal.

1. Download `highwater-too.vsix` from the [latest release](https://github.com/eugenefischer/highwater-too/releases/latest).
2. In VS Code, open the Extensions view, click **…** at its top, and choose **Install from VSIX…**.
3. Open a `.highland` file. It opens in the Highwater Editor.

To start from scratch, run **Highwater Too: New Document…** from the Command Palette (⇧⌘P).

## A quick tour

### The Highwater Editor

<!-- Screenshot: the top bar and a page of dialogue, showing wrapped dialogue lines indented. -->
![Dialogue in the Highwater Editor, wrapped lines indented](docs/images/editor.png)

Documents open in a page-width column, as in Highland 2. The top bar switches between your text and the printed pages (⌘E), and holds the template menu and theme picker. The counts at the foot show characters, words and the exact page count.

Highland's writing keys work: ⌘B, ⌘I, ⌘U, ⌘/ for a note, ⌘Y to omit text, ⌃M for a marker. Character names, scene headings and locations are offered as you type. Spell checking, paragraph numbers and Show Invisibles are there when you want them. **Choose Theme…** applies one of Highland 2's eleven colour themes to the page and the rest of the window.

### The sidebar

<!-- Screenshot: the sidebar's tab row with the Bin open, a few cards visible. -->
![The Bin in the sidebar](docs/images/sidebar.png)

The sidebar on the left of the page (⌘0) holds Highland's panels:

- **Navigator** (⌘1): scenes, sections, notes and markers. Click one to go there, or drag it to move its text.
- **Bin** (⌘2): drag text in to keep it for later, and drag a card back to use it.
- **Assets** (⌘4): images.
- **Scratchpad** (⌘5): notes.

Two panels are new:

- **Writing History** lists this document's saves by day.
- **Works** lists everything in your history.

### Print and export

<!-- Screenshot: the pages view with the print options at the foot. -->
![The printed pages, with print options](docs/images/pages.png)

The pages view shows the PDF exactly as it will export, with Highland's print options at the foot: revision colours, paragraph numbers, synopses, notes and the title page. The template window lists Highland 2's templates with a page of your own text in each.

| Template | Match with Highland 2 |
|---|---|
| Screenplay, Multi-Cam, Stage Play, Graphic Novel, Manuscript, Plain Text | Line for line |
| Novel, Treatment, Modern Standard, Article, Bulletin, Speech, MLA Report, Wiki | Line for line with Highland's fonts installed; close otherwise |

You can also export manuscripts as Word documents (`.docx`) built from ordinary Word styles, and any document as plain text.

### Writing history

<!-- Screenshot: the Writing History panel with a save selected, showing its Compare and Revert buttons. -->
![The Writing History panel](docs/images/history.png)

Every save is recorded, with how many words it added or removed. Select a save to compare it with your text side by side, or revert to it. Reverting is recorded as a save of its own, so nothing is lost. Each work keeps its own history: its text, Bin, Scratchpad and images at every save. You can export one work's history as a file that anyone can open with `git clone`.

To keep your history on more than one computer, use **Set Up History Mirror…** with any git server you like: GitHub, GitLab, Gitea, an SSH server or a shared disk. Saves made on two computers are joined, never overwritten.

## Documentation

- [User guide](packages/extension/README.md): every feature, setting and shortcut. VS Code shows the same guide on the extension's page.
- [Changelog](packages/extension/CHANGELOG.md): what changed in each version.

## Development

Highwater Too is a TypeScript monorepo. Only `packages/extension` uses the VS Code API; everything else is plain TypeScript with its own tests.

```
packages/
  parser/      Fountain, Highland Markdown and directives → a document tree with exact source spans
  bundle/      reading and writing .highland files (ZIP), keeping entries it doesn't know
  pdf/         our own layout engine for all fourteen templates, drawn with PDFKit
  history/     the writing history: one git repository, a branch per work, a catalog on main, the mirror
  extension/   the VS Code extension, including the Highwater Editor (CodeMirror 6 in a custom editor)
tools/
  pdf-compare/ compares two PDFs line by line (with a pixel diff as backup)
  scripts/     probe generators and release checks
fixtures/      generated sample documents and Highland 2's PDFs of them
```

```sh
npm install
npm run ci                               # typecheck, tests and build
npm test                                 # unit tests (Vitest)
npm run test:e2e -w highwater-too        # end-to-end tests in a downloaded VS Code
npm run package -w highwater-too         # builds highwater-too.vsix
```

Some tests use real Highland documents that can't be published. Set `HIGHWATER_PRIVATE_FIXTURES` to a folder of your own `.highland` files to run them. Without it, those tests are skipped, as they are in CI. To check a folder of documents before a release, run `node --experimental-strip-types tools/scripts/check-documents.ts <folder>`. It opens every file, saves it unchanged and lays it out. The pixel comparison needs poppler (`brew install poppler`).

**Releasing:** bump the version in `packages/extension/package.json` and add an entry to its CHANGELOG. Then tag and push (`git tag v1.2.3 && git push origin v1.2.3`). The Release workflow tests, packages and attaches the `.vsix` to a GitHub Release.

## Acknowledgements

Thanks to Highland 2 and its makers, Quote-Unquote Apps, for years of a great writing app. Highwater Too is not affiliated with them.

The PDF engine is our own, measured against Highland 2's output. Its handling of dual dialogue and (MORE)/(CONT'D) follows the approach of [Better Fountain](https://github.com/piersdeseilligny/betterfountain) by Piers Deseilligny (MIT), but no code is copied from it.

Bundled fonts (Courier Prime, Amiri, Lato, Merriweather, Highland Sans, Gelasio, Tinos, TeX Gyre Schola, Cormorant Garamond, Spectral) are under the SIL Open Font License or similar open licences; each has its licence beside it. The spelling dictionary is Hunspell's en_US from SCOWL (MIT and BSD).

## Licence

[MIT](LICENSE)
