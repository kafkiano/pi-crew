---
name: cdp-cli
description: Your agent browser cli. Interact with websites or localhost trough Chrome DevTools Protocol (CDP) with LLM optimized JSON output. Ideal to automate html front‑end inspection, interaction or debugging and online docs reading or website scraping.
---

# Browser Automation With Cdp‑Cli

## Instructions

Use `cdp-cli` to automate html front‑end inspection, interaction, debugging or web scraping via Chrome DevTools Protocol. Output is NDJSON (newline‑delimited JSON), ideal for parsing with `jq`.

### Quick Start

```bash
# Start Chromium with the desired url as background process
nohup /usr/bin/chromium --remote-debugging-port=9223 --headless=new --no-first-run --no-default-browser-check --disable-gpu http://YOUR_URL > chromium.log 2>&1 &

# Extract page titles
cdp-cli tabs | jq -r '.title'

# Inspect page content
cdp-cli snapshot "PAGE_TITLE" --format dom
```

### Command Reference

| Category   | Command example                                    | Purpose                   |
| ---------- | -------------------------------------------------- | ------------------------- |
| Navigation | `cdp-cli tabs`                                     | List open pages           |
|            | `cdp-cli new <url>`                                | Create new tab            |
|            | `cdp-cli go <page> <url\|back\|forward\|reload>`   | Navigate                  |
| Inspection | `cdp-cli snapshot <page> [--format ax\|text\|dom]` | Get page structure        |
|            | `cdp-cli console <page> [--verbose\|--all]`        | Retrieve console messages |
|            | `cdp-cli eval <page> "<expression>"`               | Execute JavaScript        |
| Automation | `cdp-cli click <page> <selector>`                  | Click element             |
|            | `cdp-cli fill <page> <text> <selector>`            | Fill input field          |
|            | `cdp-cli key <page> <key>`                         | Press keyboard key        |
| Capture    | `cdp-cli screenshot <page> <output>`               | Take screenshot           |
| Network    | `cdp-cli network <page> [--duration 5]`            | Monitor network requests  |

**Examples parsing with `jq`**

```bash
# Filter console errors
cdp-cli console "PAGE_TITLE" --verbose | jq -c 'select(.type == "error")'

# Run eval in chrome
cdp-cli eval "PAGE_TITLE" "javascript code here" | jq -r '.value'
```

### Troubleshooting

- Page Not Found: Use `cdp-cli tabs` to see current page titles.
- No Console Output: Ensure `--duration` is set and page has logged messages.
- Port Blocked: You have certainly forgot to kill the previous chromium instance, use `jobs` and `kill %1` to kill it.
