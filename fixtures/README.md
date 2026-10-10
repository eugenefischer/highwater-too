# Fixtures

- `generated/`: samples written by `tools/scripts/gen_samples.py` (ScreenplayEdgeCases, ManuscriptEdgeCases) and `tools/scripts/gen-layout-probes.ts` (FirstLineTests, StartTest1–3), opened in Highland 2 and exported to PDF by Highland (2026-10-10 and -11). Safe to commit: they contain only test text.
- Private references (EJ's own scripts and manuscripts, the per-template minimal and maximal samples) stay **outside the repo**. Tests that need them read the folder named in `HIGHWATER_PRIVATE_FIXTURES` and are skipped when it is unset, so CI runs only the generated fixtures.

```sh
export HIGHWATER_PRIVATE_FIXTURES="$HOME/SynologyDrive/Highland2Replacement/Example Highland Files"
npm test
```
