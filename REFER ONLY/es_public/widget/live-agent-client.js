/**
 * Live agent handoff — user widget talks to /api/live-agent while agents use /live-agent/ desk.
 */
(function (global) {
  'use strict';

  function liveCfg() {
    var root = global.ES_CHAT_UI_CONFIG || {};
    var c = (root.common && root.common.liveAgent) || root.liveAgent || {};
    return c;
  }

  function liveEnabled() {
    return liveCfg().enabled !== false;
  }

  function t(widget, key, fallback) {
    var lang = (widget && widget.language) || 'en';
    var pack =
      (global.ES_CHAT_LIVE_STRINGS && global.ES_CHAT_LIVE_STRINGS[lang]) ||
      (global.ES_CHAT_LIVE_STRINGS && global.ES_CHAT_LIVE_STRINGS.en) ||
      {};
    return pack[key] != null ? pack[key] : fallback;
  }

  function messageKey(m) {
    if (!m) return '';
    if (m.id) return String(m.id);
    return (
      (m.role || m.from || '') +
      '|' +
      (m.createdAt || m.at || '') +
      '|' +
      String(m.text || '').slice(0, 80)
    );
  }

  function humanChatActive_(w) {
    if (!w) return false;
    if (w._liveAgentBotCopilotActive) return false;
    return !!w._liveAgentHumanActive;
  }

  function agentConnectedFromSync_(st) {
    if (!st) return false;
    if (st.agentConnected === true) return true;
    var conv = st.conversation;
    return !!(
      conv &&
      conv.status === 'active' &&
      conv.assignedAgentEmail
    );
  }

  function waitingForAgentFromSync_(st) {
    if (!st) return false;
    if (st.waitingForAgent === true) return true;
    var conv = st.conversation;
    return !!(conv && conv.status === 'waiting');
  }

  function humanHandoffFromSync_(st) {
    return agentConnectedFromSync_(st);
  }

  function isBotHandoffMessageText_(text) {
    var t = String(text || '').trim().toLowerCase();
    return (
      t === 'live_agent_bot_active' ||
      t === 'live_agent_handoff_to_bot' ||
      t.indexOf('ai assistant is replying') >= 0 ||
      t.indexOf('the assistant is replying') >= 0 ||
      t.indexOf('stepped away') >= 0
    );
  }

  function visitorNoticeStorageKey_(sessionId) {
    return 'qa_la_notice_' + String(sessionId || '');
  }

  function shouldShowVisitorNotice_(widget, notice) {
    if (!notice || !notice.messageId) return !!notice;
    try {
      var key = visitorNoticeStorageKey_(widget.sessionId);
      var seen = sessionStorage.getItem(key) || '';
      if (seen === notice.messageId) return false;
      sessionStorage.setItem(key, notice.messageId);
      return true;
    } catch (e) {
      return true;
    }
  }

  function isHumanRejoinMessageText_(text) {
    var t = String(text || '').trim().toLowerCase();
    return t === 'live_agent_human_rejoined' || /joined again\.?$/i.test(t);
  }

  function patchWidget() {
    var C = global.ESChatWidget;
    if (!C || !C.prototype) return false;
    var p = C.prototype;
    if (p._liveAgentPatched) return true;
    p._liveAgentPatched = true;

    var origSend = p.sendMessageWithText;
    p.sendMessageWithText = function (text) {
      text = (text || '').trim();
      if (!text) return;
      if (humanChatActive_(this)) {
        if (!this.liveAgentMode) {
          this.startLiveAgentMode({});
        }
        this._liveAgentSendUser(text);
        return;
      }
      return origSend.call(this, text);
    };

    var origPostDf = p.postToDialogflow;
    p.postToDialogflow = function (body, opts) {
      if (humanChatActive_(this)) {
        return Promise.resolve();
      }
      return origPostDf.call(this, body, opts);
    };

    var origApply = p.applyDialogflowResult;
    p.applyDialogflowResult = function (result) {
      if (!result || !result.ok) {
        return origApply.call(this, result);
      }
      var data = result.data || {};
      if (data.humanActive || data.agentConnected) {
        this._liveAgentHumanActive = true;
        this._liveAgentWaiting = false;
      }
      if (data.liveAgent && liveEnabled()) {
        if (data.humanActive || data.agentConnected) {
          this._liveAgentHumanActive = true;
          this._liveAgentWaiting = false;
        } else {
          this._liveAgentHumanActive = false;
          this._liveAgentWaiting = true;
        }
        if (!this.liveAgentMode) {
          this.startLiveAgentMode(data);
        }
        return;
      }
      if (humanChatActive_(this)) {
        return;
      }
      return origApply.call(this, result);
    };

    var origWelcome = p.triggerWelcomeEvent;
    if (typeof origWelcome === 'function') {
      p.triggerWelcomeEvent = function () {
        if (humanChatActive_(this)) return;
        return origWelcome.call(this);
      };
    }

    var origEndChat = p.triggerEndChatEvent;
    if (typeof origEndChat === 'function') {
      p.triggerEndChatEvent = function (opts) {
        if (humanChatActive_(this)) return Promise.resolve();
        return origEndChat.call(this, opts);
      };
    }

    var origDfAction = p.runFormDialogflowAction;
    if (typeof origDfAction === 'function') {
      p.runFormDialogflowAction = function (action, opts) {
        if (humanChatActive_(this)) return Promise.resolve();
        return origDfAction.call(this, action, opts);
      };
    }

    p._liveAgentResolveAgentLabel_ = function (st) {
      var label =
        (st && st.assignedAgentDisplayName) ||
        (st && st.agentName) ||
        '';
      label = String(label || '').trim();
      if (!label || /^me$/i.test(label)) {
        label = 'Support Agent';
      }
      return label;
    };

    p._liveAgentAnnounceHumanRejoined_ = function (agentLabel, messageText, dedupeKey) {
      var name = (agentLabel && String(agentLabel).trim()) || '';
      if (!name || /^me$/i.test(name)) {
        name = 'Support Agent';
      }
      var text = messageText && String(messageText).trim();
      if (!text || text === 'live_agent_human_rejoined') {
        text = name + ' joined again.';
      }
      var key = dedupeKey || 'rejoin|' + text.toLowerCase();
      this.liveAgentSeen = this.liveAgentSeen || {};
      if (this.liveAgentSeen[key]) return;
      this.liveAgentSeen[key] = true;
      this._hideLiveAgentBanner();
      this.appendMessage('bot', text, {
        skipTranscriptLog: true,
        personaLabel: name,
        liveAgentHuman: true,
        messageKind: 'agent-rejoined',
      });
    };

    p._liveAgentApplyHumanRejoinFromSync_ = function (st) {
      var msgs = (st && st.messages) || [];
      var agentName = this._liveAgentResolveAgentLabel_(st);
      for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i];
        if (!m) continue;
        var role = m.role || m.from || '';
        if (role !== 'system') continue;
        if (!isHumanRejoinMessageText_(m.text)) continue;
        var mk = messageKey(m) || 'rejoin|' + String(m.text || '');
        var label =
          m.senderDisplayName ||
          agentName ||
          (String(m.text || '').match(/^(.+?)\s+joined again/i) || [])[1];
        this._liveAgentAnnounceHumanRejoined_(label, m.text, mk);
      }
    };

    p._liveAgentAnnounceConnected = function (agentLabel, messageText) {
      var name = (agentLabel && String(agentLabel).trim()) || '';
      if (!name || /^me$/i.test(name)) {
        name = 'Support Agent';
      }
      var text =
        (messageText && String(messageText).trim()) ||
        t(this, 'connectedPrefix', 'You are now chatting with') + ' ' + name + '.';
      this._hideLiveAgentBanner();
      this._liveAgentWaiting = false;
      this._liveAgentHumanActive = true;
      this._liveAgentConnectedAnnounced = true;
      this.appendMessage('bot', text, {
        skipTranscriptLog: true,
        personaLabel: name,
        liveAgentHuman: true,
        messageKind: 'agent-connected',
      });
    };

    p._liveAgentAnnounceHandoffToBot_ = function (messageText) {
      var text =
        (messageText && String(messageText).trim()) ||
        t(this, 'agentAway', 'The agent stepped away. The AI assistant is replying now.');
      this._releaseLiveAgentToBot_();
      var key = 'bot-handoff|' + text.toLowerCase();
      this.liveAgentSeen = this.liveAgentSeen || {};
      if (this.liveAgentSeen[key]) return;
      this.liveAgentSeen[key] = true;
      this.liveAgentSeen['bot-active'] = true;
      this.appendMessage('bot', text, {
        skipTranscriptLog: true,
        messageKind: 'agent-disconnected',
      });
    };

    p._liveAgentApplyVisitorNotice_ = function (st) {
      var notice = st && st.visitorNotice;
      if (!notice || !notice.type || !shouldShowVisitorNotice_(this, notice)) {
        return;
      }
      var label = this._liveAgentResolveAgentLabel_(st);
      var dedupeKey = 'notice|' + (notice.messageId || notice.type);
      this.liveAgentSeen = this.liveAgentSeen || {};
      if (this.liveAgentSeen[dedupeKey]) return;
      this.liveAgentSeen[dedupeKey] = true;
      if (notice.type === 'connected') {
        this._liveAgentAnnounceConnected(label, notice.text);
        return;
      }
      if (notice.type === 'rejoined') {
        this._liveAgentAnnounceHumanRejoined_(label, notice.text, dedupeKey);
        return;
      }
      if (notice.type === 'bot_active') {
        this._liveAgentAnnounceHandoffToBot_(notice.text);
      }
    };

    p._releaseLiveAgentToBot_ = function () {
      this.liveAgentMode = false;
      this._liveAgentHumanActive = false;
      this._liveAgentWaiting = false;
      this._liveAgentBotCopilotActive = true;
      this._liveAgentLastAgentTyping = '';
      this._liveAgentSetAgentTypingIndicator('');
      this._hideLiveAgentBanner();
    };

    p._liveAgentShowBotActiveMessage_ = function (messageText) {
      this._liveAgentAnnounceHandoffToBot_(
        messageText || t(this, 'botActive', 'AI assistant is replying now.')
      );
    };

    p._liveAgentApplyBotHandoffFromSync_ = function (st) {
      this._liveAgentBotCopilotActive = true;
      this._liveAgentHumanActive = false;
      this.liveAgentMode = false;
      var msgs = (st && st.messages) || [];
      var found = false;
      for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i];
        if (!m) continue;
        var role = m.role || m.from || '';
        if (role !== 'system') continue;
        if (!isBotHandoffMessageText_(m.text)) continue;
        var mk = messageKey(m) || 'bot-active';
        this.liveAgentSeen = this.liveAgentSeen || {};
        if (this.liveAgentSeen[mk]) {
          found = true;
          continue;
        }
        this.liveAgentSeen[mk] = true;
        this.liveAgentSeen['bot-active'] = true;
        this.appendMessage(
          'bot',
          t(this, 'botActive', 'AI assistant is replying now.'),
          { skipTranscriptLog: true }
        );
        found = true;
      }
      if (!found && st && (st.botMode || st.aiCopilot)) {
        this._liveAgentShowBotActiveMessage_();
      }
    };

    p._applyLiveAgentQueueTimeout_ = function (st) {
      var reply =
        (st.queueTimeoutReply && String(st.queueTimeoutReply).trim()) ||
        t(
          this,
          'queueTimeout',
          'All our agents are busy at the moment. Please continue with the assistant below.'
        );
      this._liveAgentStopStream();
      this._hideLiveAgentBanner();
      this.liveAgentMode = false;
      this._liveAgentHumanActive = false;
      this._liveAgentWaiting = false;
      this._liveAgentHandoffRequested = false;
      this._liveAgentConnectedAnnounced = false;
      this._liveAgentIngestMessages(
        { ok: true, messages: st.messages || [] },
        ''
      );
      var key = 'queue-timeout|' + reply.toLowerCase();
      this.liveAgentSeen = this.liveAgentSeen || {};
      if (!this.liveAgentSeen[key]) {
        this.liveAgentSeen[key] = true;
        this.appendMessage('bot', reply, { skipTranscriptLog: true });
      }
    };

    p._applyLiveAgentSyncState = function (st) {
      if (!st || !st.ok) return;
      if (st.revision) this._liveAgentRev = st.revision;
      var self = this;
      if (st.queueTimedOut) {
        this._applyLiveAgentQueueTimeout_(st);
        return;
      }
      var agentConnected = agentConnectedFromSync_(st);
      var waitingForAgent = waitingForAgentFromSync_(st) && !agentConnected;
      if (waitingForAgent) {
        this._liveAgentBotCopilotActive = false;
        this._liveAgentHumanActive = false;
        this._liveAgentWaiting = true;
        this.liveAgentMode = true;
        if (!this._liveAgentHandoffRequested) {
          this._liveAgentHandoffRequested = true;
        }
        if (!this._liveAgentPollTimer) {
          this._liveAgentStartStream();
        }
        this._liveAgentApplyVisitorNotice_(st);
        if (
          !(st.visitorNotice && st.visitorNotice.type === 'connected')
        ) {
          this._showLiveAgentBanner(
            t(this, 'waiting', 'Waiting for an agent…')
          );
        }
        return;
      }
      var handoff = agentConnected;
      if (st.conversation && st.conversation.status === 'closed') {
        if (st.conversation.closedReason === 'queue_timeout') {
          this._applyLiveAgentQueueTimeout_(st);
          return;
        }
        this.stopLiveAgentMode(true);
        this._liveAgentHandoffRequested = false;
        return;
      }
      if (!handoff) {
        this._liveAgentApplyVisitorNotice_(st);
        if (!st.visitorNotice) {
          this._liveAgentApplyBotHandoffFromSync_(st);
        }
        if (
          st.sessionOpen ||
          (st.conversation &&
            (st.conversation.status === 'waiting' ||
              st.conversation.status === 'active'))
        ) {
          this._releaseLiveAgentToBot_();
        } else {
          this._liveAgentHumanActive = false;
          this._hideLiveAgentBanner();
        }
        return;
      }
      this._liveAgentBotCopilotActive = false;
      this._liveAgentHumanActive = true;
      this._liveAgentWaiting = false;
      if (!this.liveAgentMode) {
        this.startLiveAgentMode({ skipHandoffRequest: true, agentConnected: true });
      } else if (!this._liveAgentPollTimer) {
        this._liveAgentStartStream();
      }
      this._liveAgentApplyVisitorNotice_(st);
      this._hideLiveAgentBanner();
      var skipNoticeId =
        st.visitorNotice && st.visitorNotice.messageId
          ? st.visitorNotice.messageId
          : '';
      this._liveAgentIngestMessages(
        {
          ok: true,
          messages: st.messages || [],
          agentName: this._liveAgentResolveAgentLabel_(st),
        },
        skipNoticeId
      );
      if (st.lastMessageId) {
        this._liveAgentLastMessageId = st.lastMessageId;
      }
    };

    p.startLiveAgentMode = function (data) {
      data = data || {};
      var self = this;
      if (!liveEnabled() || !this.apiBase) return;
      var cfg = liveCfg();
      var starting = !this.liveAgentMode;
      this.liveAgentMode = true;
      this._liveAgentHumanActive = !!(data.agentConnected || data.humanActive);
      this._liveAgentWaiting = !this._liveAgentHumanActive;
      if (starting && !data.skipHandoffRequest && !this._liveAgentHandoffRequested) {
        this._liveAgentHandoffRequested = true;
        this.liveAgentSeen = this.liveAgentSeen || {};
        this._liveAgentConnectedAnnounced = false;
        this._showLiveAgentBanner(
          t(this, 'waiting', 'Waiting for an agent…')
        );
        var waitingMsg =
          (data.liveAgentMessage && String(data.liveAgentMessage).trim()) ||
          (data.reply && String(data.reply).trim()) ||
          t(this, 'handoffReply', 'Connecting you to our team. Please wait.');
        if (waitingMsg) {
          this.appendMessage('bot', waitingMsg);
        }
        var dept =
          (data.liveAgentDepartment && String(data.liveAgentDepartment).trim()) ||
          (data.department && String(data.department).trim()) ||
          '';
        var reqBody = {
          clientSessionId: this.sessionId,
          sessionId: this.sessionId,
          userLanguage: this.language || 'en',
        };
        if (dept) {
          reqBody.department = dept;
        }
        fetch(this.apiBase + '/api/live-agent/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody),
        })
          .then(function (r) {
            return r.json();
          })
          .then(function (body) {
            if (body && body.outsideHours) {
              self.liveAgentMode = false;
              self._liveAgentHumanActive = false;
              self._liveAgentHandoffRequested = false;
              self._liveAgentStopStream();
              self._hideLiveAgentBanner();
              var closedMsg =
                (body.message && String(body.message).trim()) ||
                t(
                  self,
                  'outsideHours',
                  'Our live support team is currently unavailable. Please try again during business hours.'
                );
              self.appendMessage('bot', closedMsg);
              return;
            }
            if (body && body.dismissed) {
              self.stopLiveAgentMode(true);
              return;
            }
            var conv = body && body.conversation;
            if (conv && conv.status === 'closed') {
              self.stopLiveAgentMode(true);
            }
          })
          .catch(function () {
            self.appendMessage(
              'bot',
              t(self, 'handoffError', 'Could not reach support. Try again.')
            );
          });
      }
      this._liveAgentBindTyping();
      this._liveAgentStartStream();
    };

    p.stopLiveAgentMode = function (endedByAgent) {
      this.liveAgentMode = false;
      this._liveAgentHumanActive = false;
      this._liveAgentWaiting = false;
      this._liveAgentBotCopilotActive = false;
      this._liveAgentHandoffRequested = false;
      this._liveAgentConnectedAnnounced = false;
      this._liveAgentStopStream();
      this._hideLiveAgentBanner();
      this._liveAgentSetAgentTypingIndicator('');
      if (endedByAgent) {
        this.appendMessage(
          'bot',
          t(
            this,
            'ended',
            'Chat with agent ended. You can continue with the assistant.'
          )
        );
      }
    };

    p._showLiveAgentBanner = function (text) {
      if (!this.els || !this.els.panel) return;
      var el = this.els.panel.querySelector('.qa-live-agent-banner');
      if (!el) {
        el = document.createElement('div');
        el.className = 'qa-live-agent-banner';
        var scroll = this.els.panel.querySelector('.qa-panel__scroll');
        if (scroll && scroll.parentNode) {
          scroll.parentNode.insertBefore(el, scroll);
        } else {
          this.els.panel.insertBefore(el, this.els.panel.firstChild);
        }
      }
      el.textContent = text;
      el.hidden = false;
    };

    p._hideLiveAgentBanner = function () {
      if (!this.els || !this.els.panel) return;
      var el = this.els.panel.querySelector('.qa-live-agent-banner');
      if (el) el.hidden = true;
    };

    p._liveAgentSendUser = function (text) {
      var self = this;
      text = (text || '').trim();
      if (!text) return;
      this.markUserInteracted();
      this.noteUserActivity();
      this.appendMessage('user', text, { skipTranscriptLog: true });
      fetch(this.apiBase + '/api/live-agent/visitor-typing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientSessionId: this.sessionId,
          sessionId: this.sessionId,
          text: '',
          active: false,
        }),
      }).catch(function () {});
      fetch(this.apiBase + '/api/live-agent/visitor-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientSessionId: this.sessionId,
          sessionId: this.sessionId,
          text: text,
        }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (body) {
          if (!body || !body.ok) {
            throw new Error((body && body.error) || 'Send failed');
          }
          if (body.revision) self._liveAgentRev = body.revision;
          if (body.visitorNotice) {
            self._liveAgentApplyVisitorNotice_(body);
          } else if (body.agentConnected) {
            self._liveAgentAnnounceConnected(
              self._liveAgentResolveAgentLabel_(body),
              body.connectedMessage || ''
            );
          }
          if (body.messages && body.messages.length) {
            var skipId =
              body.visitorNotice && body.visitorNotice.messageId
                ? body.visitorNotice.messageId
                : '';
            self._liveAgentIngestMessages(
              {
                ok: true,
                messages: body.messages,
                agentName: self._liveAgentResolveAgentLabel_(body),
              },
              skipId
            );
          }
          if (body.lastMessageId) {
            self._liveAgentLastMessageId = body.lastMessageId;
          }
          self._liveAgentPollTick();
        })
        .catch(function () {
          self.showError('Could not send message to agent.');
        });
    };

    p._liveAgentIngestMessages = function (data, skipNoticeId) {
      if (!data || !data.ok) return;
      var self = this;
      var agentName = data.agentName || 'Support';
      if (!this.liveAgentSeen) {
        this.liveAgentSeen = {};
      }
      (data.messages || []).forEach(function (m) {
        var key = messageKey(m);
        if (!key || self.liveAgentSeen[key]) return;
        if (skipNoticeId && m.id === skipNoticeId) return;
        self.liveAgentSeen[key] = true;
        var role = m.role || '';
        var from =
          m.from ||
          (role === 'agent' || role === 'staff'
            ? 'agent'
            : role === 'system'
              ? 'system'
              : '');
        if (from === 'agent' && m.text) {
          self._liveAgentRemoveTypingDraft_();
          self.appendMessage('bot', m.text, {
            personaLabel: m.senderDisplayName || agentName,
            skipTranscriptLog: true,
          });
        } else if (from === 'system') {
          if (
            isBotHandoffMessageText_(m.text) ||
            isHumanRejoinMessageText_(m.text) ||
            /you are now chatting with/i.test(m.text || '') ||
            m.text === 'live_agent_human_connected'
          ) {
            return;
          }
          if (m.text) {
            self.appendMessage('bot', m.text);
          }
        }
      });
    };

    p._liveAgentRemoveTypingDraft_ = function () {
      if (!this.els || !this.els.messages) return;
      var el = this.els.messages.querySelector('[data-typing-draft-agent]');
      if (el) el.remove();
    };

    /** Visitors see "Typing..." only — not the agent's unsent message text. */
    p._liveAgentSetAgentTypingIndicator = function (text) {
      if (!this.els || !this.els.messages) return;
      var on = !!String(text || '').trim();
      if (!on) {
        this._liveAgentRemoveTypingDraft_();
        return;
      }
      var el = this.els.messages.querySelector('[data-typing-draft-agent]');
      if (!el) {
        el = document.createElement('div');
        el.className = 'qa-msg qa-msg--bot qa-msg--typing-draft';
        el.dataset.typingDraftAgent = '1';
        this.els.messages.appendChild(el);
      }
      var label = t(this, 'agentTyping', 'Typing...');
      el.innerHTML =
        '<div class="qa-msg__body"><div class="qa-msg__bubble">' +
        escapeHtmlWidget(label) +
        '</div></div>';
      this.els.messages.scrollTop = this.els.messages.scrollHeight;
    };

    function escapeHtmlWidget(s) {
      return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    p._liveAgentBindTyping = function () {
      var self = this;
      if (!this.els || !this.els.input || this._liveAgentTypingBound) return;
      this._liveAgentTypingBound = true;
      var typingTimer = null;
      var lastTypingSendMs = 0;
      var postTyping = function (text, active) {
        if (!self.apiBase || !self.sessionId) return;
        fetch(self.apiBase + '/api/live-agent/visitor-typing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientSessionId: self.sessionId,
            sessionId: self.sessionId,
            text: text || '',
            active: active !== false,
          }),
        }).catch(function () {});
      };
      this.els.input.addEventListener('input', function () {
        if (
          !self.liveAgentMode &&
          !self._liveAgentHumanActive &&
          !self._liveAgentWaiting
        ) {
          return;
        }
        var val = self.els.input.value || '';
        var now = Date.now();
        if (now - lastTypingSendMs > 35) {
          lastTypingSendMs = now;
          postTyping(val, true);
        } else {
          clearTimeout(typingTimer);
          typingTimer = setTimeout(function () {
            lastTypingSendMs = Date.now();
            postTyping(val, true);
          }, 35);
        }
      });
      this.els.input.addEventListener('blur', function () {
        clearTimeout(typingTimer);
        var val = self.els.input.value || '';
        if (val.trim()) {
          postTyping(val, false);
        }
      });
    };

    p._liveAgentStopTypingPulse = function () {
      if (this._liveAgentTypingPulseTimer) {
        clearInterval(this._liveAgentTypingPulseTimer);
        this._liveAgentTypingPulseTimer = null;
      }
    };

    p._liveAgentTypingPulseTick = function () {
      var self = this;
      if (!this.apiBase || !this.sessionId) return;
      if (
        !this.liveAgentMode &&
        !this._liveAgentHumanActive &&
        !this._liveAgentWaiting &&
        !this._liveAgentHandoffRequested
      ) {
        return;
      }
      if (this._liveAgentTypingPulseInFlight) return;
      this._liveAgentTypingPulseInFlight = true;
      var rev = this._liveAgentRev || 0;
      var msgId = encodeURIComponent(this._liveAgentLastMessageId || '');
      var prevTyping = encodeURIComponent(this._liveAgentLastAgentTyping || '');
      fetch(
        this.apiBase +
          '/api/live-agent/typing-pulse?clientSessionId=' +
          encodeURIComponent(this.sessionId) +
          '&rev=' +
          rev +
          '&lastMessageId=' +
          msgId +
          '&agentTyping=' +
          prevTyping
      )
        .then(function (r) {
          return r.json();
        })
        .then(function (st) {
          if (!st || !st.ok) return;
          if (st.revision) self._liveAgentRev = Math.max(rev, st.revision);
          self._liveAgentLastAgentTyping = st.agentTyping || '';
          self._liveAgentSetAgentTypingIndicator(self._liveAgentLastAgentTyping);
          if (st.newMessage) {
            self._liveAgentPollTick();
          }
        })
        .catch(function () {})
        .finally(function () {
          self._liveAgentTypingPulseInFlight = false;
        });
    };

    p._liveAgentStartTypingPulse = function () {
      var self = this;
      this._liveAgentStopTypingPulse();
      this._liveAgentTypingPulseTick();
      this._liveAgentTypingPulseTimer = setInterval(function () {
        self._liveAgentTypingPulseTick();
      }, 100);
    };

    p._liveAgentStopStream = function () {
      this._liveAgentStopTypingPulse();
      if (this._liveAgentPollTimer) {
        clearInterval(this._liveAgentPollTimer);
        this._liveAgentPollTimer = null;
      }
      if (this._liveAgentEventSource) {
        try {
          this._liveAgentEventSource.close();
        } catch (e) {}
        this._liveAgentEventSource = null;
      }
    };

    p._liveAgentStartStream = function () {
      var self = this;
      this._liveAgentStopStream();
      if (!this.apiBase || !this.sessionId) return;
      this._liveAgentStartTypingPulse();
      this._liveAgentPollTick();
      this._liveAgentPollTimer = setInterval(function () {
        self._liveAgentPollTick();
      }, 80);
    };

    p._liveAgentPollTick = function () {
      var self = this;
      if (!this.apiBase || !this.sessionId) return;
      if (
        !this.liveAgentMode &&
        !this._liveAgentHumanActive &&
        !this._liveAgentWaiting &&
        !this._liveAgentHandoffRequested
      ) {
        return;
      }
      if (this._liveAgentPollInFlight) return;
      this._liveAgentPollInFlight = true;
      var rev = this._liveAgentRev || 0;
      var msgId = encodeURIComponent(this._liveAgentLastMessageId || '');
      var syncUrl =
        this.apiBase +
        '/api/live-agent/sync?clientSessionId=' +
        encodeURIComponent(this.sessionId) +
        '&rev=' +
        rev +
        '&waitMs=900&lastMessageId=' +
        msgId;
      fetch(syncUrl)
        .then(function (r) {
          return r.json();
        })
        .then(function (st) {
          if (!st) return;
          if (st.revision) self._liveAgentRev = st.revision;
          self._liveAgentLastAgentTyping = st.agentTyping || '';
          self._liveAgentSetAgentTypingIndicator(self._liveAgentLastAgentTyping);
          if (st.unchanged) return;
          self._applyLiveAgentSyncState(st);
        })
        .catch(function () {})
        .finally(function () {
          self._liveAgentPollInFlight = false;
        });
    };

    p._liveAgentResumeIfNeeded = function () {
      var self = this;
      if (!liveEnabled() || !this.apiBase || !this.sessionId) {
        return;
      }
      if (this.liveAgentMode) {
        this._liveAgentPollTick();
        return;
      }
      fetch(
        this.apiBase +
          '/api/live-agent/sync?clientSessionId=' +
          encodeURIComponent(this.sessionId)
      )
        .then(function (r) {
          return r.json();
        })
        .then(function (st) {
          if (!st || !st.ok) return;
          if (!humanHandoffFromSync_(st)) {
            if (waitingForAgentFromSync_(st)) {
              self._liveAgentHandoffRequested = true;
              self._applyLiveAgentSyncState(st);
              return;
            }
            if (st.sessionOpen) self._releaseLiveAgentToBot_();
            return;
          }
          self._liveAgentHandoffRequested = true;
          self._applyLiveAgentSyncState(st);
        })
        .catch(function () {});
    };

    return true;
  }

  global.ES_LIVE_AGENT_PATCH = patchWidget;

  global.ES_CHAT_LIVE_STRINGS = {
    en: {
      waiting: 'Waiting for an agent…',
      agentTyping: 'Typing...',
      connectedPrefix: 'You are now chatting with',
      handoffReply: 'Connecting you to our team. Please wait.',
      outsideHours:
        'Our live support team is currently unavailable. Please try again during business hours.',
      queueTimeout:
        'All our agents are busy at the moment. Please continue with the assistant below.',
      handoffError: 'Could not reach support. Try again.',
      ended: 'Chat with agent ended. You can continue with the assistant.',
      agentRejoined: 'An agent joined again.',
      agentAway: 'The agent stepped away. The AI assistant is replying now.',
      botActive: 'AI assistant is replying now.',
    },
    hi: {
      waiting: 'एजेंट का इंतज़ार…',
      connectedPrefix: 'अब आप बात कर रहे हैं',
      handoffReply: 'हम आपको टीम से जोड़ रहे हैं। कृपया प्रतीक्षा करें।',
      handoffError: 'सपोर्ट से कनेक्ट नहीं हो सका।',
      ended: 'एजेंट चैट समाप्त। आप असिस्टेंट से जारी रख सकते हैं।',
    },
    mr: {
      waiting: 'एजंटची वाट पाहत आहोत…',
      connectedPrefix: 'आता तुम्ही बोलत आहात',
      handoffReply: 'आम्ही तुम्हाला टीमशी जोडत आहोत. कृपया थांबा.',
      handoffError: 'सपोर्टशी कनेक्ट होऊ शकले नाही.',
      ended: 'एजंट चॅट संपली. तुम्ही असिस्टंटसह पुढे चालू ठेवू शकता.',
    },
  };

  patchWidget();

  if (!global.ESChatWidget) {
    var n = 0;
    var iv = setInterval(function () {
      n += 1;
      if (patchWidget() || n > 80) clearInterval(iv);
    }, 100);
  }
})(typeof window !== 'undefined' ? window : globalThis);
