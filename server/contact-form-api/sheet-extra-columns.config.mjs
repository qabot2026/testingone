/**
 * Extra Google Sheet cells written after the standard lead row batch (same row).
 *
 * Rules:
 * - `tab` = **sheet tab name** (the bottom tab in Google Sheets, e.g. Sheet1, Leads, Data).
 *   - Use the exact name, e.g. `tab: "Sheet1"`.
 *   - `tab: ""` means: use the same tab as in env `SHEETS_RANGE` (the part before `!`).
 *     Example: if `SHEETS_RANGE` is `Sheet1!A:Q`, then `""` → Sheet1.
 * - `startColumn`: Excel-style letter(s), e.g. "C", "AA".
 * - `valueFrom`: dot path into a merged object built from the contact POST:
 *     { ...client_context, fields: { ...form fields... } }
 *   Examples:
 *     - "session_params.coursename"  → needs client_context.session_params.coursename in JSON
 *     - "fields.customfieldid"       → form field value
 * - `shiftIfOccupied` (default true): if that column is already used by a standard field
 *   (name, mobile, …) or by an earlier extra rule, the value moves to the next column (D, E,
 *   F, …) until a free slot is found, up to the full Google Sheets row width. If there is no
 *   free column left, the value is skipped and a warning is logged on the server.
 *
 * Dialogflow CX `$session.params.x` is **not** expanded here. Put the resolved string into
 * `client_context` on the client (or webhook) under the path you configure (e.g. session_params).
 *
 * Optional override: set env `SHEETS_EXTRA_COLUMN_MAPPINGS_JSON` to a JSON array of the same
 * shape as this file’s export (handy on Railway without editing the file).
 */

/** @type {Array<{ tab?: string, entries: Array<{ startColumn: string, valueFrom: string, shiftIfOccupied?: boolean }> }>} */
export const sheetExtraColumnMappings = [
    // Example (uncomment and adjust `tab` to your sheet’s tab name):
    // {
    //     tab: "Sheet1",
    //     entries: [
    //         { startColumn: "R", valueFrom: "session_params.coursename", shiftIfOccupied: true }
    //     ]
    // },
    // Same but “follow whatever tab SHEETS_RANGE uses” — leave tab empty:
    // { tab: "", entries: [{ startColumn: "R", valueFrom: "session_params.coursename" }] }
];
