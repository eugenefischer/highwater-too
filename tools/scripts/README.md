# Scripts

Run with `node --experimental-strip-types`.

- `check-documents.ts <folder>`: opens every `.highland` file in a folder, saves it, and checks that the output is unchanged and lays out.
- `gen-edge-cases.ts <out-dir>`: the edge-case samples in `fixtures/generated/` (ScreenplayEdgeCases with IncludedScene.fountain, ManuscriptEdgeCases with its test image). Filler lines are counted so page-break cases land on chosen lines (screenplay: 54 content lines per page; manuscript: about 23).
- `gen-layout-probes.ts` and `gen-manuscript-probes.ts`: the Screenplay and Manuscript probes, in `fixtures/generated/`.
- `gen-template-probes.ts <out-dir>`: one probe per other template (M10); scripts share one Fountain text, prose templates one Markdown text.

PDFs are compared with the tool in `tools/pdf-compare`.
