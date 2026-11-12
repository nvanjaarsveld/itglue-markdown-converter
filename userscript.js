// Patched build of "ITGlue Markdown Converter" 1.1 (Edge add-on khpbmbijnofcgpnoplhdhojpccagnckj).
// See README.md for what changed compared to the original and why.
(function () {
    'use strict';

    // Current IT Glue uses an AlloyEditor/CKEditor 4 inline editor (div.alloy.cke_editable).
    // .ae-editable is what older AlloyEditor versions used; the original 1.1 only matched that.
    const EDITOR_SELECTOR = [
        '.cke_editable[contenteditable="true"]',
        '.ae-editable[contenteditable="true"]',
    ].join(', ');
    const DEBOUNCE_MS = 300;
    // DOM changes only count as user edits when they land this soon after an input event.
    // This keeps content that IT Glue loads into the editor itself from being converted.
    const INPUT_WINDOW_MS = 1000;

    const BLOCK_RULES = [
        { prefix: '### ', tag: 'h3' },
        { prefix: '## ', tag: 'h2' },
        { prefix: '# ', tag: 'h1' },
        { prefix: '> ', tag: 'blockquote' },
    ];
    // Only plain lines get block conversion; existing headings, lists, tables etc. are left alone.
    const PLAIN_LINE_TAGS = new Set(['DIV', 'P']);
    // Text inside these is never rewritten.
    const SKIP_INLINE_SELECTOR = 'a, code, pre';
    // ``` or ```lang on a line of its own.
    const FENCE_RE = /^```[\w+-]*$/;

    // editor element -> { dirty: Set<line node>, observer, lastInputAt }
    const editors = new Map();

    const debounce = (func, wait) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    };

    const escapeHtml = text => text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    // ---------------------------------------------------------------------------------------
    // Inline markdown
    // ---------------------------------------------------------------------------------------

    // Returns HTML for one text node's content, or null if there is nothing to convert.
    // The text is HTML-escaped first, so only tags generated here can end up in the editor.
    function inlineMarkdownToHtml(text) {
        if (!/[*_~`[]/.test(text)) return null;

        const escaped = escapeHtml(text);
        const tokens = [];
        // Finished fragments are swapped for \0N\0 placeholders so later rules can't touch them
        // (e.g. underscores inside a URL or a code span).
        const stash = html => `\u0000${tokens.push(html) - 1}\u0000`;
        const restore = s => s.replace(/\u0000(\d+)\u0000/g, (_, i) => restore(tokens[i]));

        let out = escaped;
        out = out.replace(/`([^`]+)`/g, (_, code) => stash(`<code>${code}</code>`));
        out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) =>
            stash(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`));

        // Emphasis markers must sit on a word boundary, so snake_case_names and 2*3*4 stay as
        // they are. Single * and _ additionally need a letter/digit (or code span) right inside
        // both markers, so globs and paths like "*.pkg ... /Library/*/foo" aren't italicised.
        out = out.replace(/(?<![\w*])\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*(?![\w*])/g, '<strong><em>$1</em></strong>');
        out = out.replace(/(?<![\w*])\*\*(?=\S)(.+?)(?<=\S)\*\*(?![\w*])/g, '<strong>$1</strong>');
        out = out.replace(/(?<![\w*])\*(?=[\p{L}\p{N}\u0000])(.+?)(?<=[\p{L}\p{N}\u0000])\*(?![\w*])/gu, '<em>$1</em>');
        out = out.replace(/(?<![\w_])__(?=\S)(.+?)(?<=\S)__(?![\w_])/g, '<u>$1</u>');
        out = out.replace(/(?<![\w_])_(?=[\p{L}\p{N}\u0000])(.+?)(?<=[\p{L}\p{N}\u0000])_(?![\w_])/gu, '<em>$1</em>');
        out = out.replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '<s>$1</s>');

        return out === escaped ? null : restore(out);
    }

    // Converts inline markdown in every text node of a line, leaving existing elements
    // (toolbar formatting, links, code) in place.
    function applyInlineRules(line) {
        const textNodes = [];
        if (line.nodeType === Node.TEXT_NODE) {
            textNodes.push(line);
        } else {
            const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, {
                acceptNode: node => node.parentElement.closest(SKIP_INLINE_SELECTOR)
                    ? NodeFilter.FILTER_REJECT
                    : NodeFilter.FILTER_ACCEPT,
            });
            while (walker.nextNode()) textNodes.push(walker.currentNode);
        }

        for (const node of textNodes) {
            const html = inlineMarkdownToHtml(node.data);
            if (html === null) continue;
            const template = document.createElement('template');
            template.innerHTML = html;
            node.replaceWith(template.content);
        }
    }

    // ---------------------------------------------------------------------------------------
    // Block markdown
    // ---------------------------------------------------------------------------------------

    function firstTextNode(line) {
        if (line.nodeType === Node.TEXT_NODE) return line.data.trim() ? line : null;
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            if (walker.currentNode.data.trim()) return walker.currentNode;
        }
        return null;
    }

    // Turns "# x", "## x", "### x" and "> x" lines into headings/quotes. Returns the
    // resulting line node (the same node if nothing changed).
    function applyBlockRule(line) {
        const isPlain = line.nodeType === Node.TEXT_NODE || PLAIN_LINE_TAGS.has(line.tagName);
        if (!isPlain) return line;

        const first = firstTextNode(line);
        if (!first) return line;

        // Contenteditable often stores the space after "#" as a non-breaking space.
        const lead = first.data.replace(/^[\s ]+/, '');
        const normalised = lead.replace(/ /g, ' ');
        const rule = BLOCK_RULES.find(r =>
            normalised.startsWith(r.prefix) && normalised.length > r.prefix.length);
        if (!rule) return line;

        first.data = lead.slice(rule.prefix.length);
        const el = document.createElement(rule.tag);
        if (line.nodeType === Node.TEXT_NODE) {
            line.replaceWith(el);
            el.appendChild(line);
        } else {
            el.append(...line.childNodes);
            line.replaceWith(el);
        }
        return el;
    }

    const lineText = line => line.textContent.replace(/ /g, ' ');
    const isFence = line => line.nodeName !== 'PRE' && FENCE_RE.test(lineText(line).trim());

    // Replaces lines start..end (both fences included) with a single <pre>.
    // Indentation inside the block is kept.
    function convertCodeBlock(lines, start, end) {
        const pre = document.createElement('pre');
        pre.textContent = lines.slice(start + 1, end).map(lineText).join('\n');
        lines[start].replaceWith(pre);
        for (let i = start + 1; i <= end; i++) lines[i].remove();
    }

    // ---------------------------------------------------------------------------------------
    // Tables (GitHub-flavoured: header row, separator row, body rows)
    // ---------------------------------------------------------------------------------------

    // Unescaped pipe; "\|" is a literal pipe inside a cell.
    const PIPE_RE = /(?<!\\)\|/;
    // "|---|:--:|--:|" — at least one pipe, so a lone "---" is never taken for a separator.
    const TABLE_SEPARATOR_RE = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;

    function splitTableRow(text) {
        let row = text.trim();
        if (row.startsWith('|')) row = row.slice(1);
        if (/(?<!\\)\|$/.test(row)) row = row.slice(0, -1);
        return row.split(PIPE_RE).map(cell => cell.trim().replace(/\\\|/g, '|'));
    }

    // Finds tables in a list of line texts. Returns [{ start, end, align }] with end inclusive.
    // A table is a line with a pipe, followed by a separator row with the same number of
    // columns, followed by every next line that still contains a pipe. Unlike strict GFM a
    // pipe-less line ends the table, so a paragraph pasted directly under it isn't swallowed.
    function findTables(texts) {
        const tables = [];
        for (let i = 0; i + 1 < texts.length; i++) {
            const header = texts[i].trim();
            const separator = texts[i + 1].trim();
            if (!PIPE_RE.test(header) || !separator.includes('|')) continue;
            if (!TABLE_SEPARATOR_RE.test(separator)) continue;

            const columns = splitTableRow(header).length;
            const align = splitTableRow(separator).map(cell => {
                const left = cell.startsWith(':');
                const right = cell.endsWith(':');
                if (left && right) return 'center';
                if (right) return 'right';
                return left ? 'left' : null;
            });
            if (align.length !== columns) continue;

            let end = i + 1;
            while (end + 1 < texts.length && PIPE_RE.test(texts[end + 1].trim())) end++;
            tables.push({ start: i, end, align });
            i = end;
        }
        return tables;
    }

    function buildTableCell(tag, text, align) {
        const cell = document.createElement(tag);
        if (align) cell.style.textAlign = align;
        const html = inlineMarkdownToHtml(text);
        if (html === null) {
            cell.textContent = text;
        } else {
            const template = document.createElement('template');
            template.innerHTML = html;
            cell.append(template.content);
        }
        return cell;
    }

    // Builds a <table> from the row texts of one table found by findTables. Rows with too
    // few cells are padded and extra cells dropped, as in GFM.
    function buildTable(rowTexts, align) {
        const table = document.createElement('table');
        // Same attributes CKEditor's own table dialog uses, so IT Glue keeps and borders them.
        table.setAttribute('border', '1');
        table.setAttribute('cellpadding', '4');
        table.setAttribute('cellspacing', '0');

        const addRow = (section, tag, text) => {
            const cells = splitTableRow(text);
            const tr = section.insertRow();
            align.forEach((a, i) => tr.append(buildTableCell(tag, cells[i] ?? '', a)));
        };

        addRow(table.createTHead(), 'th', rowTexts[0]);
        if (rowTexts.length > 2) {
            const body = table.createTBody();
            rowTexts.slice(2).forEach(text => addRow(body, 'td', text));
        }
        return table;
    }

    // Splits a block's children at its <br>s. Pasted text arrives as one <p> per paragraph
    // with a <br> per line, so a whole table usually sits inside one block.
    function splitAtBreaks(block) {
        const segments = [[]];
        for (const node of Array.from(block.childNodes)) {
            if (node.nodeName === 'BR') segments.push([]);
            else segments[segments.length - 1].push(node);
        }
        return segments;
    }

    const segmentText = nodes => nodes.map(n => n.textContent).join('').replace(/ /g, ' ');

    // Converts tables inside one <br>-separated block. The block is split around each table;
    // the text before and after stays in blocks of the same type. Returns the remaining
    // (non-table) blocks so inline rules can run on them, or [block] if there was no table.
    function convertTablesInBlock(block) {
        if (block.nodeType !== Node.ELEMENT_NODE || !PLAIN_LINE_TAGS.has(block.tagName)) return [block];
        const segments = splitAtBreaks(block);
        if (segments.length < 2) return [block];
        const texts = segments.map(segmentText);
        const tables = findTables(texts);
        if (!tables.length) return [block];

        const output = document.createDocumentFragment();
        const remaining = [];
        const flushText = (from, to) => {
            const run = segments.slice(from, to);
            // Drop blank lines at the edges, e.g. CKEditor's trailing filler <br>.
            while (run.length && !segmentText(run[0]).trim()) run.shift();
            while (run.length && !segmentText(run[run.length - 1]).trim()) run.pop();
            if (!run.length) return;
            const part = block.cloneNode(false);
            run.forEach((nodes, i) => {
                if (i) part.append(document.createElement('br'));
                part.append(...nodes);
            });
            output.append(part);
            remaining.push(part);
        };

        let next = 0;
        for (const { start, end, align } of tables) {
            flushText(next, start);
            output.append(buildTable(texts.slice(start, end + 1), align));
            next = end + 1;
        }
        flushText(next, segments.length);
        block.replaceWith(output);
        return remaining;
    }

    // Text of a top-level line for table detection across lines, or '' when the line can't
    // be a table row (headings, lists, code, or a block that contains line breaks itself).
    function rowCandidateText(line) {
        if (line.nodeType === Node.TEXT_NODE) return lineText(line);
        if (!PLAIN_LINE_TAGS.has(line.tagName)) return '';
        const brs = line.querySelectorAll('br');
        if (brs.length > 1 || (brs.length === 1 && line.lastChild !== brs[0])) return '';
        return lineText(line);
    }

    // ---------------------------------------------------------------------------------------
    // Editor tracking
    // ---------------------------------------------------------------------------------------

    // The direct child of the editor that contains node, or null.
    function topLevelLine(editor, node) {
        while (node && node.parentNode !== editor) node = node.parentNode;
        return node;
    }

    function caretLine(editor) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return null;
        return topLevelLine(editor, selection.getRangeAt(0).startContainer);
    }

    // Converts the lines the user has edited. The line holding the caret is left alone until
    // the caret moves off it (or the editor loses focus), so half-typed markdown isn't
    // converted early and the caret never jumps.
    function processEditor(editor, includeCaretLine) {
        const state = editors.get(editor);
        if (!state || !state.dirty.size) return;

        const caret = includeCaretLine ? null : caretLine(editor);
        const lines = Array.from(editor.childNodes);
        const dirty = state.dirty;
        for (const line of dirty) {
            if (line.parentNode !== editor) dirty.delete(line);
        }

        // Pair up code fences. Lines inside an unclosed fence are never converted, so code
        // being typed doesn't get italicised before the closing ``` is there.
        const codeBlocks = [];
        const inCode = new Set();
        let openFence = null;
        lines.forEach((line, i) => {
            if (isFence(line)) {
                if (openFence === null) {
                    openFence = i;
                } else {
                    codeBlocks.push([openFence, i]);
                    openFence = null;
                }
                inCode.add(line);
            } else if (openFence !== null) {
                inCode.add(line);
            }
        });

        for (const [start, end] of codeBlocks) {
            const block = lines.slice(start, end + 1);
            if (!block.some(line => dirty.has(line))) continue;
            if (block.includes(caret)) continue;
            convertCodeBlock(lines, start, end);
            block.forEach(line => dirty.delete(line));
        }

        // Tables typed one row per line (Enter after each row).
        const rows = Array.from(editor.childNodes);
        const rowTexts = rows.map(line => (inCode.has(line) ? '' : rowCandidateText(line)));
        for (const { start, end, align } of findTables(rowTexts)) {
            const block = rows.slice(start, end + 1);
            if (!block.some(line => dirty.has(line))) continue;
            if (block.includes(caret)) continue;
            block[0].replaceWith(buildTable(rowTexts.slice(start, end + 1), align));
            block.slice(1).forEach(line => line.remove());
            block.forEach(line => dirty.delete(line));
        }

        for (const line of Array.from(dirty)) {
            if (line === caret || inCode.has(line)) continue;
            dirty.delete(line);
            if (line.nodeName === 'PRE') continue;
            // Pasted tables: several rows inside one block, separated by <br>.
            for (const part of convertTablesInBlock(line)) {
                applyInlineRules(applyBlockRule(part));
            }
        }

        // Drop the mutation records caused by our own changes.
        state.observer.takeRecords();
    }

    function attach(editor) {
        if (editors.has(editor)) return;

        const state = { dirty: new Set(), lastInputAt: 0, observer: null };
        const scheduleProcess = debounce(() => processEditor(editor, false), DEBOUNCE_MS);

        state.observer = new MutationObserver(records => {
            if (Date.now() - state.lastInputAt > INPUT_WINDOW_MS) return;
            for (const record of records) {
                if (record.target === editor) {
                    record.addedNodes.forEach(node => state.dirty.add(node));
                } else {
                    const line = topLevelLine(editor, record.target);
                    if (line) state.dirty.add(line);
                }
            }
            if (state.dirty.size) scheduleProcess();
        });
        state.observer.observe(editor, { childList: true, subtree: true, characterData: true });

        const markInput = () => { state.lastInputAt = Date.now(); };
        ['beforeinput', 'input', 'paste', 'drop'].forEach(type =>
            editor.addEventListener(type, markInput, true));
        editor.addEventListener('blur', () => processEditor(editor, true), true);

        editors.set(editor, state);
    }

    function scanForEditors() {
        for (const [editor, state] of editors) {
            if (!editor.isConnected) {
                state.observer.disconnect();
                editors.delete(editor);
            }
        }
        document.querySelectorAll(EDITOR_SELECTOR).forEach(attach);
    }

    // document_idle means the DOM is ready; scan now instead of waiting for window.load,
    // which may already have fired by the time this script runs.
    scanForEditors();
    new MutationObserver(debounce(scanForEditors, 500)).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['contenteditable', 'class'],
    });

    // Moving the caret to another line converts the line it left.
    document.addEventListener('selectionchange', debounce(() => {
        editors.forEach((_, editor) => processEditor(editor, false));
    }, DEBOUNCE_MS));
})();
