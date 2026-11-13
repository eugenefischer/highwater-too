# Highwater Too

Highwater Too is a VS Code extension for writing screenplays and manuscripts in the `.highland` format used by Highland 2. It reads and writes `.highland` files without losing anything Highland 2 stored in them. It also works with plain `.fountain`, `.md` and `.txt` files. It was created because Highland 2 is no longer being developed, having been replaced by [Highland Pro](https://quoteunquoteapps.com/highland-pro/). 

Highland Pro is undoubtedly great, and anyone who can justify a subscription to creative writing software should use it and not this.

Alas, my own blocks of time for doing creative writing are too irregular these days for subscription writing software to make sense. I really just want to keep using Highland 2 forever, and a VS Code extension will let me do just that, with the added benefit of letting me (1) use it on any operating system, and (2) add git based version tracking with remote mirroring.

While I'm aiming for feature parity with Highland 2, I have no intention of trying to add any features unique to Highland Pro. If you want Highland Pro-specific features, including support for any changes or additions that may have been made to the .highland file type, please buy Highland Pro. 

The extension is in active use. It has not been published to the VS Code Marketplace; builds are attached to the GitHub releases.

<!-- Screenshot: a screenplay open in the Highwater Editor with the sidebar showing the Navigator. -->
![A screenplay in the Highwater Editor](docs/images/hero.png)

## AI Use Disclosure

The day job that keeps me from creative writing is working as a software developer. I write code myself when I'm paid to do so. I let Claude write all of this.

## What it does

**Opening and saving.** A `.highland` file is a ZIP archive holding the script text (Fountain or Highland's Markdown dialect), the Bin, the Scratchpad, images and a settings file. Highwater Too edits the text and the Bin, Scratchpad and images, and writes every other entry back unchanged, so Highland 2 can still open the file. Saves go to a temporary file first, which then replaces the original. If another program changes the file while it is open, you are asked which version to keep.

**Editing.** Documents open in the Highwater Editor, a custom editor built on CodeMirror 6. It lays the text out in a page-width column of Courier Prime and indents every line of dialogue, including wrapped lines, which VS Code's text editor can't do. Highland 2's sidebar is reproduced: Navigator, Bin, Assets and Scratchpad, plus Writing History and Works panels for the history described below. Highland 2's keyboard shortcuts, colour themes, character and scene completion, markers, paragraph numbers and spell checking (American English) are supported. Any document can also be switched to VS Code's ordinary text editor.

**Printing.** PDFs come from our own layout engine, written to reproduce Highland 2's output. All fourteen Highland 2 templates are implemented:

- Screenplay, Multi-Cam, Stage Play, Graphic Novel, Manuscript and Plain Text match Highland 2's PDFs line for line.
- Novel, Treatment, Modern Standard, Article, Bulletin, Speech, MLA Report and Wiki match line for line when Highland's fonts are installed. Without them, free stand-ins with the same character widths are used where possible, and lines and pages may fall differently.

The print options (revision colours, paragraph numbers, synopses, notes, title page) and Highland's directives (`{{HEADER}}`, `{{FOOTER}}`, `{{PAGENUMBER}}`, `{{TOC}}`, `{{INCLUDE}}` and others) are supported. Manuscripts can also be exported to `.docx`.

**Writing history.** Each save is committed to a git repository in the system's application-data folder:

- One branch per work, holding the unpacked contents of the `.highland` file at each save.
- A catalog of works on `main` (titles, file names, dates and text hashes, no text).
- Autosaves are recorded at most every five minutes.
- Works are matched to files by an ID stored in the file, or by path for plain files.

From the Writing History panel you can compare any save with the current text (VS Code's diff view), revert to it, or export one work's history as a git bundle. The repository can optionally be mirrored to any git remote, which keeps several computers in step. Concurrent saves from different computers are joined with merge commits, never force-pushed.

**Not implemented:** statistics, goals and sprints; Revision Mode; Gender Analysis; Final Draft (`.fdx`) import and export; `.textbundle` files. Testing has been on macOS and Linux; Windows is untested.

## Installing

Requirements: VS Code 1.100 or later, and git for the writing history.

1. Download `highwater-too.vsix` from the [latest release](https://github.com/eugenefischer/highwater-too/releases/latest).
2. In VS Code, open the Extensions view, choose **…** › **Install from VSIX…**, and select the file.

The [user guide](packages/extension/README.md) covers every feature, setting and shortcut. Changes are listed in the [changelog](packages/extension/CHANGELOG.md).

## Repository layout

The repository is an npm workspace of TypeScript packages. Only `packages/extension` depends on the VS Code API.

| Path | Contents |
|---|---|
| `packages/parser` | Parses Fountain, Highland's Markdown and its directives into a document tree with exact source spans. |
| `packages/bundle` | Reads and writes `.highland` archives, keeping entries it doesn't know about. |
| `packages/pdf` | The layout engine for all fourteen templates, drawn with PDFKit; the `.docx` exporter; bundled fonts. |
| `packages/history` | The writing history: the git repository, branches, catalog and mirror. |
| `packages/extension` | The VS Code extension, including the Highwater Editor. |
| `tools/pdf-compare` | Compares two PDFs line by line by text and position, with a pixel diff as a fallback. |
| `tools/scripts` | Generators for the probe documents used to measure Highland 2's layout, and a release check. |
| `fixtures` | Generated test documents, and Highland 2's PDFs of them. |

## Building and testing

Node 22 is used in CI.

```sh
npm install
npm run ci                          # typecheck, unit tests, build
npm test                            # unit tests only (Vitest)
npm run test:e2e -w highwater-too   # end-to-end tests in a downloaded copy of VS Code
npm run package -w highwater-too    # writes highwater-too.vsix at the repository root
```

Layout tests compare our PDFs with Highland 2's PDFs of the same documents. Those in `fixtures/` run everywhere. Others use real documents that are not in the repository: set `HIGHWATER_PRIVATE_FIXTURES` to a folder of `.highland` files to run them; otherwise they are skipped. `node --experimental-strip-types tools/scripts/check-documents.ts <folder>` opens every `.highland` file in a folder, saves it and checks that the output is unchanged and lays out. The pixel comparison needs poppler's `pdftoppm`.

CI runs on Ubuntu and macOS. Pushing a tag `vX.Y.Z` that matches the version in `packages/extension/package.json` runs the release workflow, which tests, packages and attaches the `.vsix` to a GitHub release.

## Licence

MIT; see [LICENSE](LICENSE).

The bundled fonts are under their own open licences, included beside them in `packages/pdf/fonts`. Most use the SIL Open Font License. Courier Prime is the version Highland 2 embeds. The spelling dictionary is Hunspell's en_US from SCOWL (MIT and BSD). The handling of dual dialogue and (MORE)/(CONT'D) follows the approach of [Better Fountain](https://github.com/piersdeseilligny/betterfountain) (MIT); no code is taken from it.

Highwater Too is not affiliated with Quote-Unquote Apps, the makers of Highland 2.
