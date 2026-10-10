# Design-phase scripts (Python)

Run with `python3 -I`. The two PDF scripts need PyMuPDF (`pip install pymupdf`).

- `gen_samples.py <out-dir>`: writes the edge-case `.highland` samples in `fixtures/generated/`. Filler lines are counted so page-break cases land on chosen lines (screenplay: 54 content lines per page; manuscript: about 23).
- `pdf_dump_lines.py <file.pdf>`: prints every line with y, x-start, x-end and font.
- `pdf_line_extents.py <file.pdf>`: line counts and first/last y for pages 2–6.

The TypeScript comparison tool in `tools/pdf-compare` supersedes the PDF scripts for tests.
