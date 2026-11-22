# fast-csv-reader

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/tanacoustic05/fast-csv-reader/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/tanacoustic05/fast-csv-reader/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's csv-reader 1.0.0: reads broken CSV text in one
left-to-right pass, locating each field with a single native regex jump instead
of per-character stepping, and materializing values with `String.slice` (pieces
joined only when a field needs rebuilding). Answers are byte-identical to the
reference on every case: BOM drop, LF/CRLF records, stray_cr, quoted fields
with doubled quotes, quote_junk after a closing quote, unterminated_quote
re-read, short_row/long_row padding and cutting, and the exact error records.
Verified differentially against the reference (36 edge cases + 20k fuzz cases
+ the practice set, all exact) and deterministic across runs.

## Run it

```sh
node main.ts
```

Expects `/input/cases.json` (or `MAKEFUN_INPUT_DIR`) and writes
`/output/answers.json` (or `MAKEFUN_OUTPUT_DIR`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
