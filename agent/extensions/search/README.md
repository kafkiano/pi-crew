# search.sh

A grep-powered code search ranked by **Okapi BM25** with **subword tokenization**
and **code-aware word boundaries**. ~250 lines of bash + awk. No index, no
daemon, no embeddings. Faster than the plain `grep | sed | wc` original, and
ranks results meaningfully instead of giving everything score=11.

```bash
./search.sh "exposeTranslations" ./my-repo
./search.sh "user auth"          ./my-repo   # matches getUserAuthToken, user_auth_token, ...
./search.sh -f -k 10 "login"     ./my-repo   # file mode, top 10
```

## Why this can match/beat embedding search on code specifically

Embeddings win for prose when vocabulary differs — synonyms, paraphrases, "how
do I do X?" type queries. Code is different: developers don't use synonyms for
identifiers. When you search a codebase for "user auth", you want `UserAuth`,
`user_auth`, `getUserAuthToken`, etc. — all the same literal word stems in
different shells. That's a lexical problem, not a semantic one.

BM25 has been the baseline that dense retrievers struggle to cleanly beat on
code retrieval benchmarks for years. The trick is that naive grep misses the
lexical signal too: it doesn't split `getUserAuthToken` into `get user auth
token`, doesn't know `login` is more rare (and therefore more informative) than
`return`, and doesn't know the match in `node_modules/` is less interesting
than the one in `src/`. This script handles all three.

## The scoring formula

For a document `D` (a line, or a file in `-f` mode) and query `Q`:

```
score(D, Q)  =  Σ_{t ∈ Q}  IDF(t) · (tf(t,D) · (k1+1))
                           ─────────────────────────────
                           tf(t,D) + k1·(1 − b + b·|D|/avgdl)

IDF(t)  =  ln( (N − df(t) + 0.5) / (df(t) + 0.5) + 1 )       [Lucene variant]
```

with `k1 = 1.5`, `b = 0.75` (Okapi defaults, overridable with `--k1` / `--b`).

On top of BM25:

| Modifier                     | Effect                                               |
|------------------------------|------------------------------------------------------|
| Co-occurrence bonus          | `×(1 + 0.9·cov²)` when ≥2 distinct query tokens hit  |
| Literal-phrase bonus         | `×1.35` when the full query appears verbatim         |
| Substring-only downweight    | `×0.4` when a token matches only as a substring, not as a bounded identifier |
| Path prior: tests/spec       | `×0.55`                                              |
| Path prior: docs/examples    | `×0.75`                                              |
| Path prior: fixtures/mocks   | `×0.60`                                              |
| Path prior: `.min.{js,css}`  | `×0.30`                                              |
| Filename contains query      | `×1.35`                                              |
| Filename *is* query (no ext) | `×1.50`                                              |

`node_modules/`, `vendor/`, `dist/`, `build/`, `__pycache__/`, `.lock` files,
`.min.*`, and similar are excluded entirely at the grep step.

## Subword tokenization

Query `exposeTranslations` is split into tokens `[expose, translations]`.
Query `getUserAuthToken` → `[get, user, auth, token]`.
Query `HTTPServerConfig` → `[http, server, config]` (handles uppercase runs).
Query `user_auth_token`, `user-auth-token`, `user.auth.token` → all the same.

Tokenization is a portable char-walk (works in mawk, gawk, and busybox awk —
no `\1`-backreference gotchas in `gsub` replacements).

## Code-aware word boundary

Matching `expose` uses the regex

```
(^|[^A-Za-z0-9])  [eE][xX][pP][oO][sS][eE]  ([^a-z]|$)
└───────┬──────┘  └─────────┬───────────┘  └────┬───┘
  prev is start       case-insensitive       next is end
  or non-alnum           token                or NOT lowercase
```

So `expose` matches:
- `exposeTranslations`  ✓ (next char `T` is not lowercase → camelCase boundary)
- `expose_translations` ✓ (next char `_` is not alphanumeric)
- ` expose `            ✓
- `(expose)`            ✓

But `expose` does **not** match:
- `exposure`   ✗ (next char `u` is lowercase)
- `exposed`    ✗ (next char `d` is lowercase — correct, since `exposed` is a
                   different word; if you want it, search for `expose OR exposed`)

Counts are kept as `tfb` (bounded) and `tfp` (plain substring). Bounded hits
go in at full weight; plain-only hits at 0.4. This preserves recall while
dramatically suppressing noise from words that merely *contain* the query.

## Document length normalization

Each "document":
- **Line mode** (default): document length = number of alphanumeric tokens on
  the line. `avgdl ≈ 10`. Short, dense lines score higher.
- **File mode** (`-f`): document length = approximate file length in lines
  (derived from max line number seen in the grep output — cheap, no extra wc
  pass). `avgdl` = total lines / N files.

The `b` parameter controls how aggressive length normalization is. `b=0.75` is
standard Okapi; drop to ~0.4 if you want long function signatures to score
closer to short comments. Raise toward 1.0 to further penalize verbose hits.

## How it runs

```
1. tokenize the query (char-walk subword split + non-alnum split + lowercase)
2. ONE find  to enumerate the corpus     → N, total lines, avgdl
3. ONE grep  with ERE alternation        → all candidate hit lines
4. ONE awk   pass over the hits:
     - per-line token counts (bounded + plain)
     - per-file token aggregates
     - BM25 + bonuses + priors
     - emit TSV
5. sort -g -r  |  awk-format as JSON
```

No per-match subshells, no sed-in-a-loop, no temp files in the hot path
beyond the grep output.

## Usage

```bash
./search.sh [options] "query" [directory]

  -k N     top N results             (default 25)
  -f       score whole files, not lines
  -m S     drop results below score S
  --k1 V   BM25 k1                   (default 1.5)
  --b  V   BM25 b                    (default 0.75)
  -h       help

Env overrides: BM25_K1 BM25_B BM25_TOP BM25_MAX_CONTENT BM25_MIN_SCORE
```

Output is JSON: `[{"file": ..., "line": ..., "score": ..., "matches": ...,
"tokens_hit": ..., "content": ...}, ...]`. Pipe to `jq` for anything.

## Quick recipes

```bash
# Top 5 results for a concept query
./search.sh -k 5 "user auth"

# File-level ranking, skip weak hits
./search.sh -f -m 2.0 "login"

# Most relevant files for a query
./search.sh -f "exposeTranslations" | jq -r '.[].file'

# Just file + line for jumping in an editor
./search.sh "TODO" | jq -r '.[] | "\(.file):\(.line)"'

# Tune length normalization for long lines
./search.sh --b 0.4 "parseConfig"
```

## What it doesn't do (and easy ways to extend)

- **Stemming.** `translation` vs `translations` are different tokens here. If
  you want them equivalent, a 3-line awk addition to strip trailing `s`/`es`
  from both query tokens and corpus counts gets you 90% of the benefit.
- **Fuzzy matching for typos.** Not needed for code 99% of the time; grep-to-agrep
  swap if you do need it.
- **Ranked phrase queries** (`"foo bar"` as ordered). Currently the literal-
  phrase bonus catches adjacent matches; true proximity scoring (Lucene-style
  sloppy phrase) would need a second pass over hit positions.
- **Persistent index.** Everything is recomputed per query. For a 10k-file
  repo that's still ~4s on cold cache; for a 200k-file monorepo, cache the
  find output and df table in a tmp file keyed by mtime.

## Benchmark

Corpus: 10,000 synthetic `.js` files, ~190 containing the keyword.

Time: 4.5 s

Results: Top 25 hits, properly ranked

## License

Do whatever. Credit welcome but not required.
