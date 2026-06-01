# Fixed translations (Hindi / Marathi)

Runtime **Google Translate** was removed. All copy is served from these files.

## Files

| File | Purpose |
|------|---------|
| `ui-hi.js` / `ui-mr.js` | Forms, buttons, status, header, composer placeholder |
| `bot-hi.js` / `bot-mr.js` | Bot messages, chips, table headers, rich text (English key → translation) |
| `chips-hi.js` / `chips-mr.js` | Gallery / inline option chips (`data-dfchat-opt-key`) |

Loaded in `chat-frame.html` **before** `company.js`.

## Adding bot lines

When Dialogflow shows new English text, add the **exact** string (as users see it, trimmed) to `bot-hi.js` and `bot-mr.js`:

```javascript
"My new agent line": "मेरा नया हिंदी वाक्य",
```

If a line is missing, the chat keeps the English text until you add it.

## Forms

In-chat forms still use `titleByLanguage` / `placeholderByLanguage` in `forms/*.js`.
