/**
 * Rich text toolbar for Agent training — uses QAMessageSyntax markdown.
 */
(function () {
  'use strict';

  var ms = typeof window !== 'undefined' ? window.QAMessageSyntax : null;

  function wrapSelection(textarea, before, after) {
    if (!textarea) return;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var val = textarea.value;
    var selected = val.substring(start, end);
    var insert = before + selected + after;
    textarea.value = val.substring(0, start) + insert + val.substring(end);
    textarea.focus();
    var cursor = start + insert.length;
    textarea.setSelectionRange(cursor, cursor);
  }

  function getSelectedBlock(textarea) {
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var val = textarea.value;
    var blockStart = val.lastIndexOf('\n', start - 1) + 1;
    var blockEnd = val.indexOf('\n', end);
    if (blockEnd === -1) blockEnd = val.length;
    return { val: val, blockStart: blockStart, blockEnd: blockEnd, block: val.substring(blockStart, blockEnd) };
  }

  function replaceBlock(textarea, blockStart, blockEnd, next, selectLen) {
    var val = textarea.value;
    textarea.value = val.substring(0, blockStart) + next + val.substring(blockEnd);
    textarea.focus();
    textarea.setSelectionRange(blockStart, blockStart + (selectLen != null ? selectLen : next.length));
  }

  function prefixLines(textarea, makePrefix) {
    if (!textarea) return;
    var sel = getSelectedBlock(textarea);
    var lines = sel.block.split('\n');
    var numbered = 0;
    var next = lines
      .map(function (line) {
        if (!line.trim()) return line;
        numbered += 1;
        var prefix = makePrefix(numbered, line);
        var lead = line.match(/^(\s*)/);
        var spaces = lead ? lead[1] : '';
        var trimmed = line.slice(spaces.length);
        if (/^#{1,6}\s/.test(trimmed)) trimmed = trimmed.replace(/^#{1,6}\s+/, '');
        if (/^[-*]\s/.test(trimmed)) trimmed = trimmed.replace(/^[-*]\s+/, '');
        if (/^\d+\.\s/.test(trimmed)) trimmed = trimmed.replace(/^\d+\.\s+/, '');
        return spaces + prefix + trimmed;
      })
      .join('\n');
    replaceBlock(textarea, sel.blockStart, sel.blockEnd, next, next.length);
  }

  function indentLines(textarea, spaces) {
    if (!textarea) return;
    var sel = getSelectedBlock(textarea);
    var pad = ' '.repeat(Math.max(1, spaces || 2));
    var next = sel.block
      .split('\n')
      .map(function (line) {
        if (!line.trim()) return line;
        return pad + line;
      })
      .join('\n');
    replaceBlock(textarea, sel.blockStart, sel.blockEnd, next, next.length);
  }

  function renderPreview(text) {
    var raw = String(text || '');
    if (!raw.trim()) return '<span class="dash-muted">—</span>';
    if (ms && typeof ms.renderHtml === 'function' && ms.hasMessageSyntax(raw)) {
      return ms.renderHtml(raw);
    }
    return escHtml(raw).replace(/\n/g, '<br />');
  }

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toolbarHtml() {
    var headings = [1, 2, 3, 4, 5, 6]
      .map(function (n) {
        return (
          '<button type="button" class="qap-rich-btn" data-cmd="h' +
          n +
          '" title="Heading ' +
          n +
          ' (#' +
          '#'.repeat(n - 1) +
          ' text)">H' +
          n +
          '</button>'
        );
      })
      .join('');

    return (
      '<div class="qap-rich-toolbar" role="toolbar" aria-label="Formatting">' +
      '<div class="qap-rich-toolbar-row">' +
      '<button type="button" class="qap-rich-btn" data-cmd="bold" title="Bold (**text**)"><b>B</b></button>' +
      '<button type="button" class="qap-rich-btn" data-cmd="italic" title="Italic (*text*)"><i>I</i></button>' +
      '<button type="button" class="qap-rich-btn" data-cmd="strike" title="Strikethrough (~~text~~)"><s>S</s></button>' +
      '<button type="button" class="qap-rich-btn" data-cmd="code" title="Inline code (`text`)"><code>&lt;/&gt;</code></button>' +
      '</div>' +
      '<div class="qap-rich-toolbar-row">' +
      headings +
      '</div>' +
      '<div class="qap-rich-toolbar-row">' +
      '<button type="button" class="qap-rich-btn" data-cmd="bulletStar" title="Bullet list (* item)">★ List</button>' +
      '<button type="button" class="qap-rich-btn" data-cmd="bullet" title="Bullet list (- item)">• List</button>' +
      '<button type="button" class="qap-rich-btn" data-cmd="number" title="Numbered list (1. item)">1. List</button>' +
      '<button type="button" class="qap-rich-btn" data-cmd="nested" title="Nested list (indent 2 spaces)">↳ Nested</button>' +
      '</div>' +
      '</div>'
    );
  }

  function runCmd(textarea, cmd, syncPreview) {
    switch (cmd) {
      case 'bold':
        wrapSelection(textarea, '**', '**');
        break;
      case 'italic':
        wrapSelection(textarea, '*', '*');
        break;
      case 'strike':
        wrapSelection(textarea, '~~', '~~');
        break;
      case 'code':
        wrapSelection(textarea, '`', '`');
        break;
      case 'h1':
        prefixLines(textarea, function () {
          return '# ';
        });
        break;
      case 'h2':
        prefixLines(textarea, function () {
          return '## ';
        });
        break;
      case 'h3':
        prefixLines(textarea, function () {
          return '### ';
        });
        break;
      case 'h4':
        prefixLines(textarea, function () {
          return '#### ';
        });
        break;
      case 'h5':
        prefixLines(textarea, function () {
          return '##### ';
        });
        break;
      case 'h6':
        prefixLines(textarea, function () {
          return '###### ';
        });
        break;
      case 'bulletStar':
        prefixLines(textarea, function () {
          return '* ';
        });
        break;
      case 'bullet':
        prefixLines(textarea, function () {
          return '- ';
        });
        break;
      case 'number':
        prefixLines(textarea, function (n) {
          return n + '. ';
        });
        break;
      case 'nested':
        indentLines(textarea, 2);
        break;
      default:
        break;
    }
    if (typeof syncPreview === 'function') syncPreview();
  }

  function attach(root, options) {
    if (!root) return null;
    var textarea = root.querySelector('.qap-rich-textarea');
    if (!textarea) return null;

    function syncPreview() {
      if (options && typeof options.onChange === 'function') {
        options.onChange(textarea.value);
      }
    }

    textarea.addEventListener('input', syncPreview);

    root.querySelectorAll('.qap-rich-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        runCmd(textarea, btn.getAttribute('data-cmd'), syncPreview);
      });
    });

    return {
      getValue: function () {
        return textarea.value;
      },
      setValue: function (v) {
        textarea.value = String(v || '');
        syncPreview();
      },
      focus: function () {
        textarea.focus();
      },
    };
  }

  function mount(container, initialValue, options) {
    if (!container) return null;
    var compact = options && options.compact;
    container.innerHTML =
      toolbarHtml() +
      '<textarea class="qap-rich-textarea' +
      (compact ? ' qap-rich-textarea--compact' : '') +
      '" rows="' +
      (compact ? '8' : '10') +
      '" placeholder="Type response. Use toolbar for bold, headings, lists…"></textarea>';
    var editor = attach(container, options);
    if (editor) editor.setValue(initialValue || '');
    return editor;
  }

  window.QaProvisionRichEditor = {
    mount: mount,
    attach: attach,
    renderPreview: renderPreview,
    toolbarHtml: toolbarHtml,
    runCmd: runCmd,
  };
})();
