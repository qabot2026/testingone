# एक ही फ़ाइल: `strings.json`

सारा Hindi / Marathi **यहीँ** edit करें।

## Format

```json
"Exact English text from chat": {
  "hi": "हिंदी",
  "mr": "मराठी"
}
```

## Sections

| Key | Use |
|-----|-----|
| (top level) | Bot messages, chips, tables — **जो English chat में दिखे** वही key |
| `_ui` | Form / button labels (internal keys जैसे `submitButton`) |
| `_chips` | Chip **value** keys (`location`, `help`) — lowercase |

## नई line

1. Chat में English copy करें  
2. `strings.json` में एक entry add करें (`hi` + `mr`)  
3. Page refresh (Ctrl+F5)

Missing entry = English ही दिखेगा.

## Load

`chat-frame.html` → `load-strings.js` → `strings.json` → `company.js`
