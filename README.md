# ITGlue Markdown Converter (patched)

Patched build of the Edge add-on
[ITGlue Markdown Converter 1.1](https://microsoftedge.microsoft.com/addons/detail/itglue-markdown-converter/khpbmbijnofcgpnoplhdhojpccagnckj)
(`khpbmbijnofcgpnoplhdhojpccagnckj`), for use in Dia or any other Chromium browser.

It converts markdown typed into IT Glue's rich-text editor into formatted HTML. Current IT Glue
uses an AlloyEditor/CKEditor 4 inline editor (`div.alloy.cke_editable`); the original 1.1 only
looked for `.ae-editable` and therefore did nothing there. Both are matched.
No permissions, no network calls; it only runs on `https://*.itglue.com/*`.

## Install (Dia / Chrome / Arc / Edge)

1. Open `dia://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder (the one with `manifest.json`).
4. Remove the original Edge add-on if it's installed in the same browser, so they don't both run.

The browser loads the extension from this folder on every start — don't move or delete it.
After changing `userscript.js`, click the reload icon on the extension card.

## Supported markdown

| Type | Result |
|---|---|
| `# `, `## `, `### ` at line start | Heading 1–3 |
| `> ` at line start | Blockquote |
| ```` ``` ```` … ```` ``` ```` (optional language, e.g. ```` ```bash ````) | Code block (`<pre>`) |
| `` `code` `` | Inline code |
| `***text***` | Bold + italic |
| `**text**` | Bold |
| `*text*`, `_text_` | Italic |
| `__text__` | Underline (not bold, unlike standard markdown) |
| `~~text~~` | Strikethrough |
| `[label](https://…)` | Link (http/https only, opens in new tab) |
| `\| a \| b \|` + `\|---\|---\|` + rows | Table (header row, `:--`/`:-:`/`--:` alignment, inline markdown in cells, `\\|` for a literal pipe) |

A line converts when the caret leaves it (Enter, arrow keys, clicking elsewhere) or when the
editor loses focus. Tables work both when pasted (rows arrive as `<br>`-separated lines in one
paragraph) and when typed row by row. A table ends at the first line without a `|`, so text
directly under it stays a paragraph (stricter than GFM, which would make it a row). Escape something from conversion by wrapping it in backticks.

## Changes from the original 1.1

| # | Original behaviour | Patched behaviour |
|---|---|---|
| 1 | `_x_` matched anywhere, so `com_apple_mdm` became `com<em>apple</em>mdm` | Emphasis markers must sit on word boundaries; identifiers, paths, globs (`*.pkg`, `/Library/*/foo`) and `2*3*4` are left alone |
| 2 | Every line in the editor was re-converted on blur, including untouched existing content | Only lines you edited are converted; content IT Glue loads into the editor itself is ignored |
| 3 | A converted line was flattened to plain text, losing links/bold added with the toolbar | Works per text node; existing formatting and links are preserved |
| 4 | Code block lines were trimmed (indentation lost); inline rules ran inside unclosed fences | Indentation (incl. non-breaking spaces) is kept; nothing inside an open fence is touched |
| 5 | `__underline__` never worked (italic rule consumed it first) | Works |
| 6 | Text was inserted via `innerHTML` unescaped, and link URLs could break out of `href` | Text is HTML-escaped before conversion; URLs can't inject attributes; links get `rel="noopener noreferrer"` |
| 7 | Started on `window.load`, which may already have fired at `document_idle` → sometimes did nothing | Scans immediately, and also picks up editors that become editable later |
| 8 | Converted while you typed, jumping the caret to the end of the line | The line with the caret is converted only once you leave it — no caret jumps |
| – | Inline code only when it was the whole line | Inline code anywhere in a line |

Manifest: dropped the unneeded `host_permissions` (content-script `matches` is enough) and the
Edge `update_url`. Icons are unchanged from the original.

## Known limitations

- No lists (`- item`, `1. item`), no `####`+ headings — same as the original.
- Pasted headings, quotes and code fences only convert when they land in their own paragraph
  (blank line around them in the source); tables are also detected inside a pasted paragraph.
- `__init__`-style dunder names become underlined; wrap them in backticks.
- Single `*`/`_` emphasis needs a letter or digit right inside the markers, so `*"quoted"*` or
  `*Note:*` stay literal (`**Note:**` works).
- Markdown split across existing formatting (e.g. `**bo` + toolbar-bold `ld**`) isn't matched.
- Undo (⌘Z) doesn't undo a conversion; the editor's undo stack doesn't know about it.
- Tested against a local mock of the editor (`test/harness.html`), **not yet against live IT Glue**.
  IT Glue's editor could re-render or sanitise content differently.

## Testing

`test/harness-cke.html` mimics current IT Glue's editor markup (`div.alloy.cke_editable`);
`test/harness.html` uses the older `.ae-editable` class. Serve this folder over HTTP
(`python3 -m http.server 8765`) and open `http://localhost:8765/test/harness-cke.html`.

## Licence

The original add-on doesn't state a licence. This is a private patch for internal use; check with
the original author before redistributing it publicly.
