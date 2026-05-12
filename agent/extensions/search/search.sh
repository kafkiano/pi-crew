#!/usr/bin/env bash
# search.sh — BM25-scored code search with subword tokenization.
#
# score(D, Q) = Σ_{t in Q}  IDF(t) · ( tf(t,D) · (k1+1) ) /
#                           ( tf(t,D) + k1 · (1 - b + b · |D|/avgdl) )
#
#   IDF(t) = ln( (N - df(t) + 0.5) / (df(t) + 0.5) + 1 )   [Lucene variant]
#   k1=1.5, b=0.75 by default (Okapi)
#
# Plus: subword tokenization (camelCase/snake_case/kebab/dot), code-word
# boundary matching, co-occurrence bonus, path priors, filename match
# bonus, and literal-phrase bonus.
#
# Usage: ./search.sh [options] "query" [directory]
#   -k N     top N results (default 25)
#   -f       score whole files, not lines
#   -m S     drop results below score S
#   -c N     context lines before/after each match (default 0)
#   --k1 V   BM25 k1 (default 1.5)
#   --b  V   BM25 b (default 0.75)
#   -h       help
#
# Output: JSON array of {file, line, score, matches, tokens_hit, content}
# With -c: adds context_before[] and context_after[] arrays.
# With -f: content contains top 3 representative lines, US-separated.
#
# Env: BM25_K1 BM25_B BM25_TOP BM25_MAX_CONTENT BM25_MIN_SCORE

set -u

K1=${BM25_K1:-1.5}
B=${BM25_B:-0.75}
TOP=${BM25_TOP:-25}
MAX_CONTENT=${BM25_MAX_CONTENT:-300}
MIN_SCORE=${BM25_MIN_SCORE:-0}
MODE=lines
CTX=0

usage() { sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)    usage; exit 0 ;;
    -k|--top)     TOP="$2"; shift 2 ;;
    -m|--min)     MIN_SCORE="$2"; shift 2 ;;
    -f|--files)   MODE=files; shift ;;
    -c|--context) CTX="$2"; shift 2 ;;
    --k1)         K1="$2"; shift 2 ;;
    --b)          B="$2"; shift 2 ;;
    --)           shift; break ;;
    -*)           echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
    *)            break ;;
  esac
done

QUERY="${1:-}"
ROOT="${2:-.}"
[[ -z "$QUERY" ]] && { usage >&2; exit 2; }
[[ ! -d "$ROOT" ]] && { echo "not a directory: $ROOT" >&2; exit 2; }

# ---------- file type configuration (single source of truth) ----------
EXTENSIONS=(
  js jsx ts tsx mjs cjs vue svelte
  py rb php java kt scala go rs
  c h cpp hpp cc cs swift
  sh bash
  md rst txt
  json yaml yml toml
  xml html htm
  css scss sass less
  sql graphql proto
)
NAMED_FILES=(Dockerfile Makefile)

EXCLUDE_DIRS=(.git .hg svn node_modules bower_components vendor dist build target __pycache__ .venv venv .next .nuxt coverage .cache)
EXCLUDE_FILES=('*.min.js' '*.min.css' '*.map' '*.lock')

# Build grep args from config
INCLUDES=()
for ext in "${EXTENSIONS[@]}"; do INCLUDES+=(--include="*.$ext"); done
for name in "${NAMED_FILES[@]}"; do INCLUDES+=(--include="$name"); done

EXCLUDES=()
for d in "${EXCLUDE_DIRS[@]}"; do EXCLUDES+=(--exclude-dir="$d"); done
for f in "${EXCLUDE_FILES[@]}"; do EXCLUDES+=(--exclude="$f"); done

# Build find name predicates from same config
FIND_PREDICATES=()
first=1
for ext in "${EXTENSIONS[@]}"; do
  if [[ $first -eq 1 ]]; then FIND_PREDICATES+=(-name "*.$ext"); first=0
  else FIND_PREDICATES+=(-o -name "*.$ext"); fi
done
for name in "${NAMED_FILES[@]}"; do FIND_PREDICATES+=(-o -name "$name"); done

# Find path exclusions (mirror grep's --exclude-dir)
FIND_EXCLUDES=()
for d in "${EXCLUDE_DIRS[@]}"; do FIND_EXCLUDES+=(-not -path "*/$d/*"); done
for f in "${EXCLUDE_FILES[@]}"; do
  # Convert glob to find -not -name (works for simple patterns)
  FIND_EXCLUDES+=(-not -name "$f")
done

TMPDIR=$(mktemp -d); trap 'rm -rf "$TMPDIR"' EXIT

# ---------- tokenize the query ----------
# Portable across mawk/gawk/busybox awk (no backreferences in replacements).
mapfile -t TOKENS < <(
  printf '%s\n' "$QUERY" | awk '
    function subword_split(s,   i, n, ch, prev, nxt, out) {
      out = ""; n = length(s)
      for (i=1; i<=n; i++) {
        ch = substr(s, i, 1)
        if (i > 1) {
          prev = substr(s, i-1, 1)
          # lower/digit -> Upper : fooBar -> foo Bar
          if (ch ~ /[A-Z]/ && prev ~ /[a-z0-9]/) out = out " "
          # Upper -> Upper+lower : HTTPServer -> HTTP Server
          else if (ch ~ /[A-Z]/ && prev ~ /[A-Z]/ && i < n) {
            nxt = substr(s, i+1, 1)
            if (nxt ~ /[a-z]/) out = out " "
          }
        }
        out = out ch
      }
      return out
    }
    {
      s = subword_split($0)
      gsub(/[^A-Za-z0-9]+/, " ", s)
      n = split(tolower(s), a, " ")
      for (i=1;i<=n;i++) if (length(a[i]) >= 2) print a[i]
    }' | sort -u
)
NUM_TOKENS=${#TOKENS[@]}
[[ $NUM_TOKENS -eq 0 ]] && { echo "[]"; exit 0; }
LITERAL_Q=$(printf '%s' "$QUERY" | tr '[:upper:]' '[:lower:]')

# ---------- corpus stats (N files, total lines for avgdl) ----------
find "$ROOT" -type f \( "${FIND_PREDICATES[@]}" \) \
  "${FIND_EXCLUDES[@]}" \
  -print0 2>/dev/null > "$TMPDIR/files0"

N_FILES=$(tr -cd '\0' <"$TMPDIR/files0" | wc -c | tr -d ' ')
[[ $N_FILES -eq 0 ]] && { echo "[]"; exit 0; }

TOTAL_LINES=$(xargs -0 -a "$TMPDIR/files0" wc -l 2>/dev/null \
              | awk '{s+=$1} END{print s+0}')

# ---------- ONE grep pass for all tokens (ERE alternation) ----------
PATTERN=$(IFS='|'; printf '%s' "${TOKENS[*]}")
GREP_CTX=()
if [[ "$CTX" -gt 0 ]]; then GREP_CTX=(-B "$CTX" -A "$CTX"); fi
grep -rIHnZ -E "${GREP_CTX[@]}" "${INCLUDES[@]}" "${EXCLUDES[@]}" -- "$PATTERN" "$ROOT" \
     2>/dev/null > "$TMPDIR/hits" || true
[[ ! -s "$TMPDIR/hits" ]] && { echo "[]"; exit 0; }

# ---------- score in awk, emit TSV ----------
TOKENS_STR=$(IFS='|'; printf '%s' "${TOKENS[*]}")

awk -v TOKENS_STR="$TOKENS_STR" \
    -v LITERAL_Q="$LITERAL_Q" \
    -v N_FILES="$N_FILES" \
    -v TOTAL_LINES="$TOTAL_LINES" \
    -v K1="$K1" -v B="$B" \
    -v MAX_CONTENT="$MAX_CONTENT" \
    -v MODE="$MODE" \
    -v CTX="$CTX" '
function re_escape(s,   out,i,ch) {
  out = ""
  for (i=1; i<=length(s); i++) {
    ch = substr(s, i, 1)
    if (ch ~ /[[\.^$|()*+?{\\]/) out = out "\\" ch
    else out = out ch
  }
  return out
}
function ci_pattern(tok,   i,ch,lo,up,out) {
  out=""
  for (i=1;i<=length(tok);i++) {
    ch=substr(tok,i,1); lo=tolower(ch); up=toupper(ch)
    if (lo==up) out=out ch; else out=out "[" lo up "]"
  }
  return out
}
function code_word_regex(tok) {
  return "(^|[^A-Za-z0-9])" ci_pattern(tok) "([^a-z]|$)"
}
function count_bounded(c, re,   cp, n) { cp=c; n=gsub(re,"",cp); return n }
function count_plain(c, tok,    cp, n) { cp=tolower(c); n=gsub(tok,"",cp); return n }
function bm25_term(tf, df, N, dl, avgdl, k1, b,   idf,num,den) {
  if (tf<=0) return 0
  idf = log((N - df + 0.5) / (df + 0.5) + 1.0)
  num = tf * (k1 + 1.0)
  den = tf + k1 * (1.0 - b + b * (dl / avgdl))
  return idf * (num / den)
}
function path_prior(f,   p,m) {
  m=1.0; p=tolower(f)
  if (p ~ /(^|\/)(tests?|__tests__|spec|specs)\//) m*=0.55
  if (p ~ /\.(test|spec)\.[a-z]+$/)                m*=0.55
  if (p ~ /(^|\/)(docs?|examples?|samples?)\//)    m*=0.75
  if (p ~ /(^|\/)(fixtures?|mocks?)\//)            m*=0.60
  if (p ~ /\.min\.(js|css)$/)                      m*=0.30
  return m
}
function filename_prior(f, lq, tarr, nt,   base,noext,m,i) {
  base=f; sub(/.*\//,"",base); noext=base; sub(/\.[A-Za-z0-9]+$/,"",noext)
  m=1.0
  if (lq != "" && index(tolower(base),  lq))  m*=1.35
  if (lq != "" && tolower(noext) == lq)       m*=1.50
  for (i=1;i<=nt;i++) if (index(tolower(noext), tarr[i])) m*=1.10
  return m
}
function trim(c, lq, tarr, nt,   lc,pos,i,lt,start,end,pref,suf) {
  if (length(c) <= MAX_CONTENT) return c
  lc = tolower(c); pos = 0
  if (lq != "") pos = index(lc, lq)
  if (pos == 0) {
    for (i=1;i<=nt;i++) { lt=index(lc,tarr[i]); if (lt>0 && (pos==0 || lt<pos)) pos=lt }
  }
  if (pos == 0) pos = 1
  start = pos - int(MAX_CONTENT/2); if (start<1) start=1
  end   = start + MAX_CONTENT; if (end>length(c)) end=length(c)
  pref = (start>1)           ? "[...] " : ""
  suf  = (end<length(c))     ? " [...]" : ""
  return pref substr(c, start, end-start+1) suf
}
function json_escape(s) {
  gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s)
  gsub(/\t/, "\\t", s); gsub(/\r/, "\\r", s); gsub(/\n/, "\\n", s)
  return s
}
function field_escape(s) {
  gsub(/\\/, "\\\\", s)
  gsub(/\r/, "\\r", s); gsub(/\n/, "\\n", s)
  gsub(/\x1e/, "\\u001e", s); gsub(/\x1f/, "\\u001f", s)
  return s
}
function parse_grep_line(line,    nul,rest,sep) {
  # Grep --null -nH output:
  #   match:   filepath\0lineno:content
  #   context: filepath\0lineno-content
  # Null byte unambiguously separates filepath from the rest.
  nul = index(line, "\0")
  if (!nul) return 0
  PARSE_FILE = substr(line, 1, nul-1)
  rest = substr(line, nul+1)
  # find the separator between lineno and content
  # it is the FIRST : or - in rest
  sep = substr(rest, 1, 1)
  # actually the separator is after the line number digits
  # find the first non-digit to get the separator position
  # but simpler: find the first : or - in rest
  # line number is digits, separator is : or -, content follows
  # just split on the first : or -
  # but what if content starts with : or -? We need digits first.
  # The format is: digits + separator + content
  # find end of digits
  p = 0
  for (i=1; i<=length(rest); i++) {
    if (substr(rest, i, 1) !~ /[0-9]/) { p = i; break }
  }
  if (p == 0) return 0
  PARSE_LINENO = substr(rest, 1, p-1) + 0
  sep = substr(rest, p, 1)
  PARSE_CONTENT = substr(rest, p+1)
  PARSE_IS_MATCH = (sep == ":") ? 1 : 0
  return 1
}
BEGIN {
  NT = split(TOKENS_STR, T, "|")
  for (i=1;i<=NT;i++) { RE[i] = code_word_regex(T[i]); LOW[i] = T[i] }
  AVGDL = (N_FILES>0 && TOTAL_LINES>0) ? TOTAL_LINES / N_FILES : 100.0
  # context tracking state
  delete bef_buf; bef_n = 0
  aft_remaining = 0
  last_file = ""; last_lineno = 0
}
/^(--)$/ {
  delete bef_buf; bef_n = 0
  aft_remaining = 0
  next
}
{
  if (!parse_grep_line($0)) next
  file = PARSE_FILE; lineno = PARSE_LINENO; content = PARSE_CONTENT
  is_match = PARSE_IS_MATCH
  if (!is_match) {
    # context line — buffer it
    if (aft_remaining > 0) {
      K = last_file SUBSEP last_lineno
      n = AFT_N[K] + 1
      AFT_K[K, n] = content
      AFT_N[K] = n
      aft_remaining--
    } else {
      bef_n++
      bef_buf[bef_n] = content
    }
    next
  }
  # process as match
  matched_any = 0
  for (i=1;i<=NT;i++) {
    cb = count_bounded(content, RE[i])
    cp = count_plain(content, LOW[i])
    if (cb>0 || cp>0) {
      matched_any = 1
      K = file SUBSEP lineno
      TFB[K,i] += cb; TFP[K,i] += cp
      LC[K] = content
      LINES_SEEN[K] = 1
      FILES_SEEN[file] = 1
      FTFB[file,i] += cb; FTFP[file,i] += cp
    }
  }
  if (matched_any) {
    K = file SUBSEP lineno
    for (j=1; j<=bef_n; j++) {
      BEF_K[K, j] = bef_buf[j]
    }
    BEF_N[K] = bef_n
    delete bef_buf; bef_n = 0
    aft_remaining = CTX
    last_file = file; last_lineno = lineno
    if (lineno > FLEN[file]) FLEN[file] = lineno
  }
}
END {
  # df(t): unique files containing token (prefer bounded, fall back to plain)
  for (i=1;i<=NT;i++) {
    db=0; dp=0
    for (f in FILES_SEEN) {
      if (FTFB[f,i] > 0) db++
      if (FTFP[f,i] > 0) dp++
    }
    DF[i] = (db>0) ? db : dp
    if (DF[i] < 1) DF[i] = 1
  }
  for (f in FILES_SEEN) if (FLEN[f] < 1) FLEN[f] = AVGDL

  if (MODE == "lines") {
    line_avgdl = 10.0
    for (K in LINES_SEEN) {
      split(K, kp, SUBSEP); f = kp[1]; ln = kp[2]+0
      c = LC[K]
      cp = c; gsub(/[^A-Za-z0-9]+/, " ", cp)
      dl = 0; n = split(cp, ws, " "); for (w=1;w<=n;w++) if (length(ws[w])>0) dl++
      if (dl<1) dl=1

      s = 0.0; distinct_b = 0; total_b = 0
      for (i=1;i<=NT;i++) {
        tfb = TFB[K,i]+0; tfp = TFP[K,i]+0
        tf_use = (tfb>0) ? tfb : tfp * 0.4
        if (tf_use > 0) {
          s += bm25_term(tf_use, DF[i], N_FILES, dl, line_avgdl, K1, B)
          if (tfb>0) { distinct_b++; total_b += tfb }
        }
      }
      if (s <= 0) continue
      if (NT > 1 && distinct_b > 1) {
        cov = distinct_b / NT
        s *= (1.0 + 0.9 * cov * cov)
      }
      if (LITERAL_Q != "" && index(tolower(c), LITERAL_Q) > 0) s *= 1.35
      s *= path_prior(f) * filename_prior(f, LITERAL_Q, LOW, NT)

      # emit score, file, line, matches, tokens_hit, content, then context arrays
      # using RS (0x1E) as field separator — never appears in code
      printf "%.6f\x1e%s\x1e%d\x1e%d\x1e%d\x1e%s\x1e", s, f, ln, total_b, distinct_b, field_escape(trim(c, LITERAL_Q, LOW, NT))
      # before-context
      bn = BEF_N[K]+0
      for (j=1; j<=bn; j++) {
        if (j>1) printf "\x1f"
        printf "%s", field_escape(BEF_K[K, j])
      }
      printf "\x1e"
      # after-context
      an = AFT_N[K]+0
      for (j=1; j<=an; j++) {
        if (j>1) printf "\x1f"
        printf "%s", field_escape(AFT_K[K, j])
      }
      printf "\n"
    }
  } else {
    # file mode — top 3 representative lines per file
    TOP_LINES = 3
    for (f in FILES_SEEN) {
      dl = FLEN[f]; if (dl<1) dl = AVGDL
      s = 0.0; distinct_b = 0; total_b = 0
      for (i=1;i<=NT;i++) {
        tfb = FTFB[f,i]+0; tfp = FTFP[f,i]+0
        tf_use = (tfb>0) ? tfb : tfp * 0.4
        if (tf_use > 0) {
          s += bm25_term(tf_use, DF[i], N_FILES, dl, AVGDL, K1, B)
          if (tfb>0) { distinct_b++; total_b += tfb }
        }
      }
      if (s <= 0) continue
      if (NT>1 && distinct_b>1) {
        cov = distinct_b / NT
        s *= (1.0 + 0.9 * cov * cov)
      }
      s *= path_prior(f) * filename_prior(f, LITERAL_Q, LOW, NT)

      # find top N representative lines
      delete best_lns; delete best_scores; delete best_cs
      best_count = 0
      for (K in LINES_SEEN) {
        split(K, kp, SUBSEP); if (kp[1] != f) continue
        ln = kp[2]+0; ds=0; ts=0
        for (i=1;i<=NT;i++) { tb = TFB[K,i]+0; if (tb>0) { ds++; ts += tb } }
        lscore = ds*100 + ts
        # insert into sorted top-N
        pos = best_count + 1
        for (j=1; j<=best_count; j++) {
          if (lscore > best_scores[j]) { pos = j; break }
        }
        if (pos <= TOP_LINES) {
          shift_from = (best_count < TOP_LINES) ? best_count : TOP_LINES - 1
          for (j=shift_from; j>=pos; j--) {
            best_lns[j+1] = best_lns[j]; best_scores[j+1] = best_scores[j]; best_cs[j+1] = best_cs[j]
          }
          best_lns[pos] = ln; best_scores[pos] = lscore; best_cs[pos] = LC[K]
          if (best_count < TOP_LINES) best_count++
        }
      }

      printf "%.6f\x1e%s\x1e%s\x1e%d\x1e%d\x1e", s, f, best_lns[1], total_b, distinct_b
      # emit best lines as tuples: lineno:content
      for (j=1; j<=best_count; j++) {
        if (j>1) printf "\x1f"
        printf "%d:%s", best_lns[j], field_escape(trim(best_cs[j], LITERAL_Q, LOW, NT))
      }
      printf "\n"
    }
  }
}
' "$TMPDIR/hits" 2>/dev/null > "$TMPDIR/tsv"

[[ ! -s "$TMPDIR/tsv" ]] && { echo "[]"; exit 0; }

# ---------- sort + JSON ----------
# Sort by first field (score), using RS (0x1E) as field separator
LC_ALL=C sort -t$'\x1e' -k1,1 -g -r "$TMPDIR/tsv" \
| awk -F'\x1e' -v MIN="$MIN_SCORE" -v TOP="$TOP" -v CTX="$CTX" '
function json_escape(s) {
  gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s)
  gsub(/\t/, "\\t", s); gsub(/\r/, "\\r", s); gsub(/\n/, "\\n", s)
  gsub(/\x1f/, "\\u001f", s); gsub(/\x1e/, "\\u001e", s)
  return s
}
BEGIN { print "["; n=0 }
($1+0) >= (MIN+0) {
  if (n >= TOP+0) next
  n++
  file=$2; content=$6
  file = json_escape(file)
  content = json_escape(content)
  if (n>1) printf(",\n")
  if (CTX+0 > 0) {
    # line mode with context: $7=before-ctx (US-separated), $8=after-ctx (US-separated)
    printf "  {\"file\": \"%s\", \"line\": %s, \"score\": %.4f, \"matches\": %s, \"tokens_hit\": %s, \"content\": \"%s\",\n   \"context_before\": [", file, $3, $1, $4, $5, content
    if ($7 != "") {
      nbf = split($7, bf, "\x1f")
      for (i=1; i<=nbf; i++) {
        if (i>1) printf ", "
        printf "\"%s\"", json_escape(bf[i])
      }
    }
    printf "], \"context_after\": ["
    if ($8 != "") {
      naf = split($8, af, "\x1f")
      for (i=1; i<=naf; i++) {
        if (i>1) printf ", "
        printf "\"%s\"", json_escape(af[i])
      }
    }
    printf "]}"
  } else {
    # original format (no context)
    printf "  {\"file\": \"%s\", \"line\": %s, \"score\": %.4f, \"matches\": %s, \"tokens_hit\": %s, \"content\": \"%s\"}", file, $3, $1, $4, $5, content
  }
}
END { if (n>0) printf("\n"); print "]" }
'
