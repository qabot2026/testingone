/**
 * Unified bot message syntax for Web, WhatsApp, Instagram, and Facebook.
 *
 * Input (Dialogflow text):
 *   **bold**  *italic*  ***both***  ~~strike~~  `code`
 *   # H1 … ###### H6 (H6 styled on web only)
 *   * / - bullets, 1. numbered, indented nested lists
 *   \n line breaks; \u200B-only lines for extra vertical space
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.QAMessageSyntax = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function messageSyntaxFactory() {
const ZWSP = '\u200B';

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const LIST_RE = /^(\s*)([-*]|\d+\.)\s+(.+)$/;
const ZWSP_LINE_RE = /^\s*\u200B\s*$/;
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/;
const SAFE_HTTP_RE = /^https?:\/\//i;

const SOCIAL_CHANNELS = new Set(['whatsapp', 'instagram', 'facebook']);

function isSafeHttpUrl(href) {
  return SAFE_HTTP_RE.test(String(href || '').trim());
}

function trimStr(v) {
  return String(v == null ? '' : v);
}

/** Strip zero-width spacer lines while preserving break count. */
function expandZwspBreaks(text) {
  const lines = trimStr(text).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (ZWSP_LINE_RE.test(lines[i])) {
      out.push('');
      continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

function findInlineToken(src) {
  let best = null;

  function consider(idx, kind, openLen, closeStart) {
    if (idx < 0 || closeStart < 0 || closeStart < idx + openLen) return;
    if (!best || idx < best.idx) {
      best = { idx, kind, openLen, closeStart };
    }
  }

  for (let i = 0; i < src.length; i += 1) {
    if (src.startsWith('***', i)) {
      consider(i, 'boldItalic', 3, src.indexOf('***', i + 3));
    } else if (src.startsWith('**', i)) {
      consider(i, 'bold', 2, src.indexOf('**', i + 2));
    } else if (src.startsWith('~~', i)) {
      consider(i, 'strike', 2, src.indexOf('~~', i + 2));
    } else if (src[i] === '`') {
      const close = src.indexOf('`', i + 1);
      if (close > i) consider(i, 'code', 1, close);
    } else if (src[i] === '*' && src[i + 1] !== '*') {
      const close = src.indexOf('*', i + 1);
      if (close > i + 1 && src[close + 1] !== '*') consider(i, 'italic', 1, close);
    } else if (src[i] === '[') {
      const m = src.slice(i).match(LINK_RE);
      if (m) {
        const label = String(m[1] || '').trim();
        const href = String(m[2] || '').trim();
        if (label && isSafeHttpUrl(href) && (!best || i < best.idx)) {
          best = { idx: i, kind: 'link', openLen: 0, closeStart: i + m[0].length };
        }
      }
    }
  }

  return best;
}

function parseInline(text) {
  const src = trimStr(text);
  if (!src) return [];

  const token = findInlineToken(src);
  if (!token) return [{ type: 'text', text: src }];

  const spans = [];
  const before = src.slice(0, token.idx);
  if (before) spans.push({ type: 'text', text: before });

  const innerStart = token.idx + token.openLen;
  const inner = src.slice(innerStart, token.closeStart);
  const after = src.slice(
    token.kind === 'link' ? token.closeStart : token.closeStart + token.openLen
  );

  switch (token.kind) {
    case 'boldItalic':
      spans.push({ type: 'boldItalic', children: parseInline(inner) });
      break;
    case 'bold':
      spans.push({ type: 'bold', children: parseInline(inner) });
      break;
    case 'strike':
      spans.push({ type: 'strike', children: parseInline(inner) });
      break;
    case 'code':
      spans.push({ type: 'code', text: inner });
      break;
    case 'italic':
      spans.push({ type: 'italic', children: parseInline(inner) });
      break;
    case 'link': {
      const m = src.slice(token.idx).match(LINK_RE);
      spans.push({
        type: 'link',
        text: String(m[1] || '').trim(),
        href: String(m[2] || '').trim(),
      });
      break;
    }
    default:
      break;
  }

  if (after) spans.push(...parseInline(after));
  return spans;
}

function parseBlocks(raw) {
  const text = expandZwspBreaks(raw);
  const lines = text.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (ZWSP_LINE_RE.test(line)) {
      blocks.push({ type: 'spacer' });
      i += 1;
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        children: parseInline(heading[2]),
      });
      i += 1;
      continue;
    }

    const list = line.match(LIST_RE);
    if (list) {
      blocks.push({
        type: 'listItem',
        indent: Math.floor(list[1].replace(/\t/g, '  ').length / 2),
        ordered: /\d+\./.test(list[2]),
        marker: list[2],
        children: parseInline(list[3]),
      });
      i += 1;
      continue;
    }

    if (!line.trim()) {
      let size = 1;
      i += 1;
      while (i < lines.length && !lines[i].trim() && !ZWSP_LINE_RE.test(lines[i])) {
        size += 1;
        i += 1;
      }
      blocks.push({ type: 'break', size });
      continue;
    }

    let content = line;
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      if (
        !next.trim() ||
        ZWSP_LINE_RE.test(next) ||
        HEADING_RE.test(next) ||
        LIST_RE.test(next)
      ) {
        break;
      }
      content += '\n' + next;
      i += 1;
    }
    blocks.push({ type: 'paragraph', children: parseInline(content) });
  }

  return blocks;
}

function groupListBlocks(blocks) {
  const out = [];
  let i = 0;
  while (i < blocks.length) {
    if (blocks[i].type !== 'listItem') {
      out.push(blocks[i]);
      i += 1;
      continue;
    }
    const items = [];
    while (i < blocks.length && blocks[i].type === 'listItem') {
      items.push(blocks[i]);
      i += 1;
    }
    out.push({ type: 'list', items });
  }
  return out;
}

function parseMessageSyntax(raw) {
  const blocks = groupListBlocks(parseBlocks(raw));
  return { blocks };
}

function flattenInline(spans) {
  return (spans || [])
    .map((s) => {
      if (s.type === 'text' || s.type === 'code') return s.text || '';
      if (s.type === 'link') return s.text || '';
      return flattenInline(s.children);
    })
    .join('');
}

function wrapSocial(type, span, channel) {
  if (type === 'link') {
    const label = span.text || '';
    const href = span.href || '';
    if (channel === 'instagram') return label + ' ' + href;
    return label + ' (' + href + ')';
  }

  const text =
    type === 'code' ? span.text || '' : flattenInline(Array.isArray(span) ? span : span.children);
  if (!text) return '';
  switch (type) {
    case 'bold':
      return '*' + text + '*';
    case 'italic':
      return '_' + text + '_';
    case 'boldItalic':
      return '*_' + text + '_*';
    case 'strike':
      return '~' + text + '~';
    case 'code':
      return '`' + text + '`';
    default:
      return text;
  }
}

function formatInlineForChannel(spans, channel) {
  const ch = String(channel || 'web').trim().toLowerCase();
  if (ch === 'web') return flattenInline(spans);
  return (spans || [])
    .map((s) => {
      if (s.type === 'text') return s.text || '';
      if (s.type === 'code') return wrapSocial('code', s, channel);
      if (s.type === 'link') return wrapSocial('link', s, channel);
      if (s.type === 'bold') return wrapSocial('bold', s, channel);
      if (s.type === 'italic') return wrapSocial('italic', s, channel);
      if (s.type === 'boldItalic') return wrapSocial('boldItalic', s, channel);
      if (s.type === 'strike') return wrapSocial('strike', s, channel);
      return flattenInline([s]);
    })
    .join('');
}

function formatListTree(items, start, channel, baseIndent) {
  const lines = [];
  let idx = start;
  while (idx < items.length) {
    const item = items[idx];
    const level = item.indent;
    if (level < baseIndent) break;
    if (level > baseIndent) {
      idx += 1;
      continue;
    }
    const prefix = item.ordered ? item.marker + ' ' : '• ';
    const pad = '  '.repeat(level);
    lines.push(pad + prefix + formatInlineForChannel(item.children, channel));
    idx += 1;
    const sub = [];
    while (idx < items.length && items[idx].indent > level) {
      sub.push(items[idx]);
      idx += 1;
    }
    if (sub.length) {
      lines.push(formatListTree(sub, 0, channel, level + 1).replace(/^/gm, '  '));
    }
  }
  return lines.filter(Boolean).join('\n');
}

function formatForChannel(raw, channel) {
  const ch = String(channel || 'web').trim().toLowerCase();
  const parsed = parseMessageSyntax(raw);
  const parts = [];

  parsed.blocks.forEach((block) => {
    switch (block.type) {
      case 'heading': {
        const content = formatInlineForChannel(block.children, ch);
        if (ch === 'web') {
          parts.push(content);
        } else if (block.level <= 5) {
          parts.push('*' + flattenInline(block.children) + '*');
        } else {
          parts.push(flattenInline(block.children));
        }
        break;
      }
      case 'paragraph':
        parts.push(formatInlineForChannel(block.children, ch));
        break;
      case 'break':
        parts.push('\n'.repeat(Math.max(1, block.size)));
        break;
      case 'spacer':
        parts.push('\n\u200B \n');
        break;
      case 'list':
        if (ch === 'web') {
          parts.push(
            block.items
              .map((item) => {
                const p = item.ordered ? item.marker + ' ' : '• ';
                return p + formatInlineForChannel(item.children, 'web');
              })
              .join('\n')
          );
        } else {
          parts.push(formatListTree(block.items, 0, ch, 0));
        }
        break;
      default:
        break;
    }
  });

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInlineHtml(spans) {
  return (spans || [])
    .map((s) => {
      switch (s.type) {
        case 'text':
          return escapeHtml(s.text).replace(/\n/g, '<br class="qa-md-br" />');
        case 'code':
          return '<code class="qa-md-code">' + escapeHtml(s.text) + '</code>';
        case 'link':
          return (
            '<a class="qa-msg__link qa-md-link" href="' +
            escapeHtml(s.href) +
            '" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(s.text) +
            '</a>'
          );
        case 'bold':
          return '<strong>' + renderInlineHtml(s.children) + '</strong>';
        case 'italic':
          return '<em>' + renderInlineHtml(s.children) + '</em>';
        case 'boldItalic':
          return '<strong><em>' + renderInlineHtml(s.children) + '</em></strong>';
        case 'strike':
          return '<del>' + renderInlineHtml(s.children) + '</del>';
        default:
          return escapeHtml(flattenInline([s]));
      }
    })
    .join('');
}

function renderListLevel(items, startIdx, indent) {
  if (startIdx >= items.length || items[startIdx].indent < indent) {
    return { html: '', end: startIdx };
  }

  const ordered = items[startIdx].ordered;
  let html = ordered ? '<ol class="qa-md-list">' : '<ul class="qa-md-list">';
  let i = startIdx;

  while (i < items.length && items[i].indent === indent) {
    html += '<li>' + renderInlineHtml(items[i].children);
    i += 1;
    if (i < items.length && items[i].indent > indent) {
      const nested = renderListLevel(items, i, indent + 1);
      html += nested.html;
      i = nested.end;
    }
    html += '</li>';
  }

  html += ordered ? '</ol>' : '</ul>';
  return { html, end: i };
}

function renderListHtml(items) {
  return renderListLevel(items, 0, items[0] ? items[0].indent : 0).html;
}

function renderHtml(raw) {
  const parsed = parseMessageSyntax(raw);
  const chunks = [];

  parsed.blocks.forEach((block) => {
    switch (block.type) {
      case 'heading':
        chunks.push(
          '<h' +
            block.level +
            ' class="qa-md-h qa-md-h' +
            block.level +
            '">' +
            renderInlineHtml(block.children) +
            '</h' +
            block.level +
            '>'
        );
        break;
      case 'paragraph':
        chunks.push('<p class="qa-md-p">' + renderInlineHtml(block.children) + '</p>');
        break;
      case 'break':
        chunks.push('<br class="qa-md-br" />'.repeat(Math.max(1, block.size)));
        break;
      case 'spacer':
        chunks.push('<div class="qa-md-spacer" aria-hidden="true"></div>');
        break;
      case 'list':
        chunks.push(renderListHtml(block.items));
        break;
      default:
        break;
    }
  });

  return chunks.join('');
}

function stripToPlainText(raw) {
  const parsed = parseMessageSyntax(raw);
  const lines = [];
  parsed.blocks.forEach((block) => {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        lines.push(flattenInline(block.children));
        break;
      case 'break':
        lines.push('\n'.repeat(Math.max(1, block.size)));
        break;
      case 'spacer':
        lines.push('');
        break;
      case 'list':
        block.items.forEach((item) => {
          const pad = '  '.repeat(item.indent || 0);
          const prefix = item.ordered ? item.marker + ' ' : '- ';
          lines.push(pad + prefix + flattenInline(item.children));
        });
        break;
      default:
        break;
    }
  });
  return lines.join('\n').replace(/\u200B/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function hasMessageSyntax(raw) {
  const s = trimStr(raw);
  if (!s) return false;
  return (
    /\*\*\*[^*]+\*\*\*/.test(s) ||
    /\*\*[^*]+\*\*/.test(s) ||
    /(?<!\*)\*(?!\*)[^*\n]+\*(?!\*)/.test(s) ||
    /~~[^~]+~~/.test(s) ||
    /`[^`\n]+`/.test(s) ||
    /^#{1,6}\s/m.test(s) ||
    /^\s*[-*]\s/m.test(s) ||
    /^\s*\d+\.\s/m.test(s) ||
    ZWSP_LINE_RE.test(s) ||
    /\[([^\]]+)\]\(([^)]+)\)/.test(s)
  );
}

function applyFormattedReplyFields(result, channel) {
  if (!result || typeof result !== 'object') return result;
  const ch = String(channel || 'web').trim().toLowerCase();
  const src = trimStr(result.reply);
  if (!src) return result;

  if (hasMessageSyntax(src)) {
    result.replyHtml = renderHtml(src);
    result.replyFormatted = {
      web: result.replyHtml,
      whatsapp: formatForChannel(src, 'whatsapp'),
      instagram: formatForChannel(src, 'instagram'),
      facebook: formatForChannel(src, 'facebook'),
    };
  } else {
    delete result.replyHtml;
    delete result.replyFormatted;
  }

  if (SOCIAL_CHANNELS.has(ch) || ch === 'web') {
    result.replyChannel = formatForChannel(src, ch === 'web' ? 'web' : ch);
  }

  return result;
}

return {
  ZWSP,
  parseMessageSyntax,
  parseInline,
  formatForChannel,
  renderHtml,
  stripToPlainText,
  hasMessageSyntax,
  applyFormattedReplyFields,
  isSafeHttpUrl,
};
});
