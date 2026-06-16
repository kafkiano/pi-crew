---
name: cdp-cli
description: Your agent browser cli. Interact with websites or localhost through Chrome DevTools Protocol (CDP) with LLM optimized JSON output. Ideal for browser automation, form interaction, JS evaluation, pair browsing, and debugging. For read-only content extraction, prefer url-to-md.
---

# Browser Automation With cdp-cli

## When to Use cdp-cli vs url-to-md

| Capability | cdp-cli | url-to-md |
|-----------|---------|-----------|
| Content extraction (read-only) | ⚠️ DOM snapshot unreliable | ✅ Clean markdown, tag filtering |
| Click, fill forms, press keys | ✅ Full automation | ❌ Read-only |
| JavaScript evaluation | ✅ `eval` command | ❌ |
| Screenshots | ✅ | ❌ |
| Network monitoring | ✅ (browser requests only) | ❌ |
| Console messages | ✅ | ❌ |
| Pair browsing (visible session) | ✅ `--cdp-url` | ❌ |
| File download/egress | ❌ No built-in support | ❌ |
| Cookie consent handling | ⚠️ Manual JSF link navigation | ✅ Automatic |
| Multi-step interaction workflows | ✅ | ❌ |

**Rule of thumb**: If you only need to read/extract content → `url-to-md`. If you need to interact (click, type, evaluate JS) → `cdp-cli`. For hybrid workflows, use `url-to-md` for extraction steps and `cdp-cli` for interaction steps.

## Instructions

Use `cdp-cli` to automate html front-end inspection, interaction, debugging or web scraping via Chrome DevTools Protocol. Output is NDJSON (newline-delimited JSON), ideal for parsing with `jq`.

### Starting Chromium

**Linux (manual)**:
```bash
# Headless mode — may need --no-sandbox if AppArmor blocks user namespaces
# AppArmor fix: load a profile for ungoogled-chromium, or use --no-sandbox
/usr/bin/ungoogled-chromium --remote-debugging-port=9223 --headless=new \
  --no-first-run --no-default-browser-check --disable-gpu URL > /tmp/chromium.log 2>&1 &

# Visible mode (pair browsing) — user starts this themselves:
# ungoogled-chromium --remote-debugging-port=9223
```

**Note**: `cdp-cli launch` is macOS-only. On Linux, manage the browser process manually.

### Pair Browsing — Connect to User's Visible Session

When the user has Chromium running visibly, connect to their session:

```bash
# Default connects to http://localhost:9223 (IPv4)
# If both headless (IPv4) and visible (IPv6) are running, specify:
cdp-cli --cdp-url 'http://[::1]:9223' tabs

# Use --cdp-url for all subsequent commands:
cdp-cli --cdp-url 'http://[::1]:9223' snapshot "PAGE_TITLE" --format text
cdp-cli --cdp-url 'http://[::1]:9223' eval "PAGE_TITLE" "document.title"
```

**Port conflict note**: Two Chromium instances can share port 9223 if one binds IPv4 (127.0.0.1) and the other IPv6 ([::1]). Check with `ss -tlnp | grep 9223` to see who owns which.

### Quick Start

```bash
# List open tabs
cdp-cli tabs | jq -r '.title'

# Inspect page content (prefer --format text over dom — dom can produce empty output)
cdp-cli snapshot "PAGE_TITLE" --format text

# Extract structured data with JavaScript (MUST use IIFE to avoid context persistence errors)
cdp-cli eval "PAGE_TITLE" "(function() { return document.title; })()" | jq -r '.value'
```

### Command Reference

| Category   | Command example                                    | Purpose                   |
| ---------- | -------------------------------------------------- | ------------------------- |
| Navigation | `cdp-cli tabs`                                     | List open pages           |
|            | `cdp-cli new <url>`                                | Create new tab            |
|            | `cdp-cli go <page> <url\|back\|forward\|reload>`   | Navigate                  |
|            | `cdp-cli close <idOrTitle>`                        | Close a tab               |
| Inspection | `cdp-cli snapshot <page> [--format ax\|text\|dom]` | Get page structure        |
|            | `cdp-cli console <page> [--verbose\|--all]`        | Retrieve console messages |
|            | `cdp-cli eval <page> "<expression>"`               | Execute JavaScript        |
| Automation | `cdp-cli click <page> <selector>`                  | Click element             |
|            | `cdp-cli fill <page> <text> <selector>`            | Fill input field          |
|            | `cdp-cli key <page> <key>`                         | Press keyboard key        |
| Capture    | `cdp-cli screenshot <page> <output>`               | Take screenshot           |
| Network    | `cdp-cli network <page> [--duration 5]`            | Monitor network requests  |

### Eval Gotchas

**Context persistence** — variables survive across `eval` calls. Always wrap in IIFE:
```bash
# ❌ BROKEN — second call fails with "Identifier already declared"
cdp-cli eval "PAGE" "const links = document.querySelectorAll('a')"
cdp-cli eval "PAGE" "const links = document.querySelectorAll('a')"  # SyntaxError!

# ✅ CORRECT — IIFE isolates scope
cdp-cli eval "PAGE" "(function() { const links = document.querySelectorAll('a'); return links.length; })()"
```

**No jQuery selectors** — `:has()`, `:text()`, `:contains()` are jQuery extensions, not CSS. Use plain JS filtering:
```bash
# ❌ BROKEN — DOMException: not a valid selector
cdp-cli eval "PAGE" "document.querySelector('a:has(span)')"

# ✅ CORRECT — filter with JS
cdp-cli eval "PAGE" "(function() { return Array.from(document.querySelectorAll('a')).filter(a => a.textContent.includes('ZIP')); })()"
```

**HttpOnly cookies** — `document.cookie` returns empty for HttpOnly cookies. Can't extract session cookies from eval.

### Click Limitations

- **Modals in headless mode**: Click may fail with "Could not compute box model." Workaround: navigate directly to the element's `href` (common with JSF action links).
- **Download attributes**: `click` on `<a download>` doesn't trigger file download in headless Chrome. Use `eval` with `fetch()` to retrieve file contents as base64 (chunked retrieval for large files).

### Cookie Consent Walls

Many sites (especially JSF-based) use modal dialogs for cookie consent. In headless mode, clicking the accept button often fails. Workaround:

```bash
# 1. Find the accept button's href via eval
cdp-cli eval "PAGE" "(function() {
  const btns = Array.from(document.querySelectorAll('button, a'));
  return JSON.stringify(btns.filter(b => b.textContent.includes('kzept') || b.textContent.includes('OK')));
})()"

# 2. Navigate directly to the JSF action link
cdp-cli go "PAGE" 'https://site.com/page.html?0-1.-html-body-infoModal-...-link&cookieCheck'
```

### File Download Workaround (No Built-in Egress)

cdp-cli has no `download` or `save` command. For small files, use chunked base64 transfer:

```bash
# 1. Fetch file in-browser, store as base64
cdp-cli eval "PAGE" "(async function() {
  const resp = await fetch(downloadUrl, {credentials: 'include'});
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode.apply(null, bytes.slice(i, i+8192));
  window.__b64 = btoa(binary);
  return window.__b64.length;
})()"

# 2. Retrieve in chunks (500K chars each)
for i in $(seq 0 $((CHUNKS-1))); do
  cdp-cli eval "PAGE" "window.__b64.substring($((i*500000)), $(((i+1)*500000)))" | jq -r '.value' > chunk_$i.b64
done

# 3. Reassemble and decode
cat chunk_*.b64 | tr -d '\n' | base64 -d > output.file
```

**Note**: This is fragile — jq adds newlines, large files are slow. For production download workflows, consider the ChromeDevTools MCP server or raw CDP `Page.setDownloadBehavior`.

### Network Monitoring Limitations

`cdp-cli network` only captures browser-initiated requests. `fetch()` calls made via `eval` are NOT captured. To capture a request for replay with curl, trigger it via navigation or click, not eval.

### Troubleshooting

- **Page Not Found**: Use `cdp-cli tabs` to see current page titles.
- **No Console Output**: Ensure `--duration` is set and page has logged messages.
- **Port Blocked**: Kill previous Chromium: `pkill -f ungoogled-chromium`
- **AppArmor DENIED sys_admin**: Chromium sandbox blocked. Either load an AppArmor profile for ungoogled-chromium or add `--no-sandbox`.
- **DOM snapshot empty**: Use `--format text` instead. DOM format can produce empty output on complex pages.
- **Click "Could not compute box model"**: Element not in viewport (common with modals in headless). Navigate to the element's href directly.
- **Eval "Identifier already declared"**: Use IIFE to isolate scope between eval calls.
- **Two Chromiums on port 9223**: One on IPv4, one on IPv6. Use `--cdp-url 'http://[::1]:9223'` for the IPv6 instance.
