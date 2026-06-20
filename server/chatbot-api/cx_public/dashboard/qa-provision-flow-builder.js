/**
 * Flow builder UI — rich blocks (chips, gallery, forms, etc.) for Q&A provision.
 */
(function (global) {
  'use strict';

  var BLOCK_LABELS = {
    chips: 'Chips / quick replies',
    dropdown: 'Dropdown select',
    gallery: 'Image gallery',
    carousel: 'Card carousel',
    infoCard: 'Info card',
    downloads: 'Download links',
    form: 'Open form',
    liveAgent: 'Live agent handoff',
  };

  var FORM_IDS = [
    'contact',
    'appointment',
    'otp',
    'upload',
    'feedback',
    'nearest-branch',
    'birthform',
  ];

  var CHANNELS = [
    { id: 'web', label: 'Web' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'instagram', label: 'Instagram' },
    { id: 'facebook', label: 'Facebook' },
  ];

  function renderChannelPicker(block) {
    var selected = Array.isArray(block.channels) ? block.channels : [];
    var all = !selected.length || selected.length >= CHANNELS.length;
    return (
      '<div class="qap-fb-channels">' +
      '<span class="qap-fb-channels-label">Show on channels</span>' +
      CHANNELS.map(function (ch) {
        var checked = all || selected.indexOf(ch.id) >= 0 ? ' checked' : '';
        return (
          '<label class="qap-fb-channel-label">' +
          '<input type="checkbox" class="qap-fb-channel" data-channel="' +
          ch.id +
          '"' +
          checked +
          ' /> ' +
          esc(ch.label) +
          '</label>'
        );
      }).join('') +
      '</div>'
    );
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cloneBlocks(blocks) {
    try {
      return JSON.parse(JSON.stringify(blocks || []));
    } catch (_e) {
      return [];
    }
  }

  function defaultBlock(type) {
    switch (type) {
      case 'chips':
        return { type: 'chips', heading: '', items: [{ label: '', message: '' }] };
      case 'dropdown':
        return {
          type: 'dropdown',
          message: '',
          placeholder: 'Choose…',
          options: [{ value: '', label: '' }],
        };
      case 'gallery':
        return { type: 'gallery', message: '', images: [{ url: '', name: 'Image' }] };
      case 'carousel':
        return {
          type: 'carousel',
          message: '',
          cards: [{ title: '', subtitle: '', imageUrl: '', buttons: [{ label: '', message: '' }] }],
        };
      case 'infoCard':
        return {
          type: 'infoCard',
          title: '',
          subtitle: '',
          body: '',
          imageUrl: '',
          actionLink: '',
          buttons: [{ label: '', message: '', href: '' }],
        };
      case 'downloads':
        return { type: 'downloads', items: [{ label: 'Download', href: '', fileName: '' }] };
      case 'form':
        return {
          type: 'form',
          formId: 'contact',
          message: '',
          onSubmit: '',
          onCancel: '',
          onResend: '',
          tag: '',
          nextFormId: '',
        };
      case 'liveAgent':
        return { type: 'liveAgent', message: '', department: '' };
      default:
        return { type: type, items: [] };
    }
  }

  function renderBlock(block, index) {
    var type = block.type;
    var title = BLOCK_LABELS[type] || type;
    if (block.dfPayloadName) {
      title = block.dfPayloadName + ' (' + title + ')';
    }
    var body = '';

    if (type === 'chips') {
      body +=
        '<label>Chip heading (optional)<input class="qap-fb-input" data-field="heading" value="' +
        esc(block.heading) +
        '" placeholder="Choose an option" /></label>';
      body += '<div class="qap-fb-repeat" data-repeat="items">';
      (block.items || []).forEach(function (item, i) {
        body +=
          '<div class="qap-fb-repeat-row" data-index="' +
          i +
          '">' +
          '<input class="qap-fb-input" data-sub="label" value="' +
          esc(item.label) +
          '" placeholder="Label" />' +
          '<input class="qap-fb-input" data-sub="message" value="' +
          esc(item.message) +
          '" placeholder="Sends to bot" />' +
          '<input class="qap-fb-input qap-fb-input--wide" data-sub="href" value="' +
          esc(item.href) +
          '" placeholder="Optional https link" />' +
          '<button type="button" class="qap-fb-rm-row" title="Remove">×</button></div>';
      });
      body +=
        '</div><button type="button" class="dash-btn dash-btn--ghost qap-fb-add-row" data-add="items">+ Add chip</button>';
    } else if (type === 'dropdown') {
      body +=
        '<label>Message<input class="qap-fb-input qap-fb-input--wide" data-field="message" value="' +
        esc(block.message) +
        '" /></label>' +
        '<label>Placeholder<input class="qap-fb-input" data-field="placeholder" value="' +
        esc(block.placeholder || 'Choose…') +
        '" /></label>';
      body += '<div class="qap-fb-repeat" data-repeat="options">';
      (block.options || []).forEach(function (opt, i) {
        body +=
          '<div class="qap-fb-repeat-row" data-index="' +
          i +
          '">' +
          '<input class="qap-fb-input" data-sub="label" value="' +
          esc(opt.label) +
          '" placeholder="Label" />' +
          '<input class="qap-fb-input" data-sub="value" value="' +
          esc(opt.value) +
          '" placeholder="Value sent" />' +
          '<button type="button" class="qap-fb-rm-row" title="Remove">×</button></div>';
      });
      body +=
        '</div><button type="button" class="dash-btn dash-btn--ghost qap-fb-add-row" data-add="options">+ Add option</button>';
    } else if (type === 'gallery') {
      body +=
        '<label>Message<input class="qap-fb-input qap-fb-input--wide" data-field="message" value="' +
        esc(block.message) +
        '" /></label>';
      body += '<div class="qap-fb-repeat" data-repeat="images">';
      (block.images || []).forEach(function (img, i) {
        body +=
          '<div class="qap-fb-repeat-row" data-index="' +
          i +
          '">' +
          '<input class="qap-fb-input qap-fb-input--wide" data-sub="url" value="' +
          esc(img.url) +
          '" placeholder="https:// image URL" />' +
          '<input class="qap-fb-input" data-sub="name" value="' +
          esc(img.name) +
          '" placeholder="Caption" />' +
          '<button type="button" class="qap-fb-rm-row" title="Remove">×</button></div>';
      });
      body +=
        '</div><button type="button" class="dash-btn dash-btn--ghost qap-fb-add-row" data-add="images">+ Add image</button>';
    } else if (type === 'carousel') {
      body +=
        '<label>Message<input class="qap-fb-input qap-fb-input--wide" data-field="message" value="' +
        esc(block.message) +
        '" /></label>';
      (block.cards || []).forEach(function (card, ci) {
        body +=
          '<div class="qap-fb-card" data-card-index="' +
          ci +
          '"><div class="qap-fb-card-head">Card ' +
          (ci + 1) +
          '<button type="button" class="qap-fb-rm-card" title="Remove card">×</button></div>' +
          '<input class="qap-fb-input" data-card="title" value="' +
          esc(card.title) +
          '" placeholder="Title" />' +
          '<input class="qap-fb-input" data-card="subtitle" value="' +
          esc(card.subtitle) +
          '" placeholder="Subtitle" />' +
          '<input class="qap-fb-input qap-fb-input--wide" data-card="imageUrl" value="' +
          esc(card.imageUrl) +
          '" placeholder="Image URL" />' +
          '<div class="qap-fb-repeat" data-repeat="buttons">';
        (card.buttons || []).forEach(function (btn, bi) {
          body +=
            '<div class="qap-fb-repeat-row" data-index="' +
            bi +
            '">' +
            '<input class="qap-fb-input" data-sub="label" value="' +
            esc(btn.label) +
            '" placeholder="Button label" />' +
            '<input class="qap-fb-input" data-sub="message" value="' +
            esc(btn.message) +
            '" placeholder="Sends to bot" />' +
            '<button type="button" class="qap-fb-rm-row" title="Remove">×</button></div>';
        });
        body +=
          '</div><button type="button" class="dash-btn dash-btn--ghost qap-fb-add-btn" data-card-index="' +
          ci +
          '">+ Add button</button></div>';
      });
      body += '<button type="button" class="dash-btn dash-btn--ghost qap-fb-add-card">+ Add card</button>';
    } else if (type === 'infoCard') {
      body +=
        '<input class="qap-fb-input" data-field="title" value="' +
        esc(block.title) +
        '" placeholder="Title" />' +
        '<input class="qap-fb-input" data-field="subtitle" value="' +
        esc(block.subtitle) +
        '" placeholder="Subtitle" />' +
        '<textarea class="qap-fb-textarea" data-field="body" placeholder="Body text">' +
        esc(block.body) +
        '</textarea>' +
        '<input class="qap-fb-input qap-fb-input--wide" data-field="imageUrl" value="' +
        esc(block.imageUrl) +
        '" placeholder="Image URL" />' +
        '<input class="qap-fb-input qap-fb-input--wide" data-field="actionLink" value="' +
        esc(block.actionLink) +
        '" placeholder="Action link URL" />';
      body += '<div class="qap-fb-repeat" data-repeat="buttons">';
      (block.buttons || []).forEach(function (btn, i) {
        body +=
          '<div class="qap-fb-repeat-row" data-index="' +
          i +
          '">' +
          '<input class="qap-fb-input" data-sub="label" value="' +
          esc(btn.label) +
          '" placeholder="Label" />' +
          '<input class="qap-fb-input" data-sub="message" value="' +
          esc(btn.message) +
          '" placeholder="Sends to bot" />' +
          '<input class="qap-fb-input" data-sub="href" value="' +
          esc(btn.href) +
          '" placeholder="Optional link" />' +
          '<button type="button" class="qap-fb-rm-row" title="Remove">×</button></div>';
      });
      body +=
        '</div><button type="button" class="dash-btn dash-btn--ghost qap-fb-add-row" data-add="buttons">+ Add button</button>';
    } else if (type === 'downloads') {
      body += '<div class="qap-fb-repeat" data-repeat="items">';
      (block.items || []).forEach(function (item, i) {
        body +=
          '<div class="qap-fb-repeat-row" data-index="' +
          i +
          '">' +
          '<input class="qap-fb-input" data-sub="label" value="' +
          esc(item.label) +
          '" placeholder="Label" />' +
          '<input class="qap-fb-input qap-fb-input--wide" data-sub="href" value="' +
          esc(item.href) +
          '" placeholder="https:// file URL" />' +
          '<button type="button" class="qap-fb-rm-row" title="Remove">×</button></div>';
      });
      body +=
        '</div><button type="button" class="dash-btn dash-btn--ghost qap-fb-add-row" data-add="items">+ Add download</button>';
    } else if (type === 'form') {
      body +=
        '<label>Form<select class="qap-fb-input" data-field="formId">' +
        FORM_IDS.map(function (id) {
          return (
            '<option value="' +
            esc(id) +
            '"' +
            (block.formId === id ? ' selected' : '') +
            '>' +
            esc(id) +
            '</option>'
          );
        }).join('') +
        '</select></label>' +
        '<label>Message<input class="qap-fb-input qap-fb-input--wide" data-field="message" value="' +
        esc(block.message) +
        '" /></label>' +
        '<label>On submit<input class="qap-fb-input" data-field="onSubmit" value="' +
        esc(block.onSubmit) +
        '" placeholder="query:Intent name" /></label>' +
        '<label>On cancel<input class="qap-fb-input" data-field="onCancel" value="' +
        esc(block.onCancel) +
        '" placeholder="event:CANCEL" /></label>' +
        '<label>Next form ID<input class="qap-fb-input" data-field="nextFormId" value="' +
        esc(block.nextFormId) +
        '" /></label>';
    } else if (type === 'liveAgent') {
      body +=
        '<label>Message<input class="qap-fb-input qap-fb-input--wide" data-field="message" value="' +
        esc(block.message) +
        '" /></label>' +
        '<label>Department<input class="qap-fb-input" data-field="department" value="' +
        esc(block.department) +
        '" placeholder="Sales" /></label>';
    } else if (type === 'custom') {
      body +=
        '<input type="hidden" class="qap-fb-df-name" value="' +
        esc(block.dfPayloadName || '') +
        '" />' +
        '<input type="hidden" class="qap-fb-raw-payload" value="' +
        esc(JSON.stringify(block.rawPayload || {})) +
        '" />' +
        '<p class="qap-fb-custom-hint">Payload from Dialogflow (read-only). Edit in Dialogflow or replace with a flow block.</p>' +
        '<pre class="qap-fb-custom-json">' +
        esc(JSON.stringify(block.rawPayload || {}, null, 2)) +
        '</pre>';
    }

    return (
      '<div class="qap-fb-block" data-block-index="' +
      index +
      '" data-block-type="' +
      esc(type) +
      '">' +
      '<div class="qap-fb-block-head"><strong>' +
      esc(title) +
      '</strong>' +
      '<button type="button" class="qap-fb-rm-block" title="Remove block">Remove</button></div>' +
      renderChannelPicker(block) +
      '<div class="qap-fb-block-body">' +
      body +
      '</div></div>'
    );
  }

  function readBlockFromEl(el) {
    var type = el.getAttribute('data-block-type');
    var block = { type: type };

    el.querySelectorAll('[data-field]').forEach(function (input) {
      var field = input.getAttribute('data-field');
      block[field] = input.value.trim();
    });

    var repeat = el.querySelector('[data-repeat]');
    if (repeat) {
      var key = repeat.getAttribute('data-repeat');
      block[key] = [];
      repeat.querySelectorAll('.qap-fb-repeat-row').forEach(function (row) {
        var item = {};
        row.querySelectorAll('[data-sub]').forEach(function (input) {
          item[input.getAttribute('data-sub')] = input.value.trim();
        });
        block[key].push(item);
      });
    }

    if (type === 'carousel') {
      block.cards = [];
      el.querySelectorAll('.qap-fb-card').forEach(function (cardEl) {
        var card = { buttons: [] };
        cardEl.querySelectorAll('[data-card]').forEach(function (input) {
          card[input.getAttribute('data-card')] = input.value.trim();
        });
        cardEl.querySelectorAll('.qap-fb-repeat-row').forEach(function (row) {
          var btn = {};
          row.querySelectorAll('[data-sub]').forEach(function (input) {
            btn[input.getAttribute('data-sub')] = input.value.trim();
          });
          card.buttons.push(btn);
        });
        block.cards.push(card);
      });
    }

    var selectedChannels = [];
    el.querySelectorAll('.qap-fb-channel:checked').forEach(function (input) {
      selectedChannels.push(input.getAttribute('data-channel'));
    });
    if (selectedChannels.length && selectedChannels.length < CHANNELS.length) {
      block.channels = selectedChannels;
    }

    if (type === 'custom') {
      var nameEl = el.querySelector('.qap-fb-df-name');
      var rawEl = el.querySelector('.qap-fb-raw-payload');
      if (nameEl) block.dfPayloadName = nameEl.value.trim();
      if (rawEl) {
        try {
          block.rawPayload = JSON.parse(rawEl.value || '{}');
        } catch (_e) {
          block.rawPayload = {};
        }
      }
    }

    return block;
  }

  function readBlocksFromHost(host) {
    if (!host) return [];
    var blocksEl = host.querySelector('.qap-fb-blocks');
    if (!blocksEl) return [];
    var blocks = [];
    blocksEl.querySelectorAll('.qap-fb-block').forEach(function (el) {
      blocks.push(readBlockFromEl(el));
    });
    return cloneBlocks(blocks);
  }

  function mount(host, initialBlocks) {
    var blocks = cloneBlocks(initialBlocks);
    var root = document.createElement('div');
    root.className = 'qap-flow-builder';

    var toolbar =
      '<div class="qap-fb-toolbar">' +
      '<label>Rich response type <select class="qap-fb-add-type">' +
      Object.keys(BLOCK_LABELS)
        .map(function (key) {
          return '<option value="' + key + '">' + esc(BLOCK_LABELS[key]) + '</option>';
        })
        .join('') +
      '</select></label>' +
      '<button type="button" class="dash-btn dash-btn--ghost qap-fb-add-block">+ Add rich response</button>' +
      '</div>' +
      '<div class="qap-fb-blocks"></div>';

    root.innerHTML = toolbar;
    host.innerHTML = '';
    host.appendChild(root);

    var blocksEl = root.querySelector('.qap-fb-blocks');

    function render() {
      blocksEl.innerHTML = blocks
        .map(function (block, index) {
          return renderBlock(block, index);
        })
        .join('');
    }

    function readFromDom() {
      blocks = [];
      blocksEl.querySelectorAll('.qap-fb-block').forEach(function (el) {
        blocks.push(readBlockFromEl(el));
      });
    }

    root.addEventListener('click', function (e) {
      var t = e.target;
      if (t.classList.contains('qap-fb-add-block')) {
        var type = root.querySelector('.qap-fb-add-type').value;
        readFromDom();
        blocks.push(defaultBlock(type));
        render();
        return;
      }
      if (t.classList.contains('qap-fb-rm-block')) {
        readFromDom();
        var blockEl = t.closest('.qap-fb-block');
        var idx = Number(blockEl.getAttribute('data-block-index'));
        blocks.splice(idx, 1);
        render();
        return;
      }
      if (t.classList.contains('qap-fb-add-row')) {
        readFromDom();
        var blockIdx = Number(t.closest('.qap-fb-block').getAttribute('data-block-index'));
        var addKey = t.getAttribute('data-add');
        if (!blocks[blockIdx][addKey]) blocks[blockIdx][addKey] = [];
        if (addKey === 'options') blocks[blockIdx][addKey].push({ value: '', label: '' });
        else if (addKey === 'images') blocks[blockIdx][addKey].push({ url: '', name: 'Image' });
        else blocks[blockIdx][addKey].push({ label: '', message: '' });
        render();
        return;
      }
      if (t.classList.contains('qap-fb-rm-row')) {
        readFromDom();
        var bIdx = Number(t.closest('.qap-fb-block').getAttribute('data-block-index'));
        var row = t.closest('.qap-fb-repeat-row');
        var rIdx = Number(row.getAttribute('data-index'));
        var rep = t.closest('[data-repeat]');
        var repKey = rep.getAttribute('data-repeat');
        blocks[bIdx][repKey].splice(rIdx, 1);
        render();
        return;
      }
      if (t.classList.contains('qap-fb-add-card')) {
        readFromDom();
        var cIdx = Number(t.closest('.qap-fb-block').getAttribute('data-block-index'));
        blocks[cIdx].cards.push({
          title: '',
          subtitle: '',
          imageUrl: '',
          buttons: [{ label: '', message: '' }],
        });
        render();
        return;
      }
      if (t.classList.contains('qap-fb-rm-card')) {
        readFromDom();
        var carIdx = Number(t.closest('.qap-fb-block').getAttribute('data-block-index'));
        var cardIndex = Number(t.closest('.qap-fb-card').getAttribute('data-card-index'));
        blocks[carIdx].cards.splice(cardIndex, 1);
        render();
        return;
      }
      if (t.classList.contains('qap-fb-add-btn')) {
        readFromDom();
        var carBlockIdx = Number(t.closest('.qap-fb-block').getAttribute('data-block-index'));
        var cardIdx = Number(t.getAttribute('data-card-index'));
        blocks[carBlockIdx].cards[cardIdx].buttons.push({ label: '', message: '' });
        render();
      }
    });

    render();

    return {
      getValue: function () {
        readFromDom();
        return cloneBlocks(blocks);
      },
    };
  }

  global.QaProvisionFlowBuilder = {
    mount: mount,
    readBlocksFromHost: readBlocksFromHost,
    blockLabels: BLOCK_LABELS,
  };
})(typeof window !== 'undefined' ? window : global);
