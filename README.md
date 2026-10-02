# Traceboard

A small personal bug tracker for the issues you debug each day. It works entirely in the browser and stores entries on your device.

## Start it

1. Open `index.html` in any modern browser.
2. Select **Log a bug**.
3. Describe the problem, add repeatable steps, and record what you tried.
4. Use the `···` button on a bug to move it through **Open**, **Investigating**, and **Fixed**.

## A useful bug note

- **What happened:** State the broken behavior, not just the feature name.
- **How can you repeat it?:** Include the smallest reliable sequence of actions.
- **What have you tried?:** Include tests, files changed, errors, and hypotheses—even failed attempts are valuable context.

## Files

- `index.html` — page structure and bug-entry form
- `styles.css` — visual design and responsive layout
- `app.js` — saving, filtering, and updating bugs

Data is saved with browser local storage. Clearing browser site data for this page will also clear the tracked bugs.

## Historical workbook and charts

When the app first opens through `http://localhost:8000`, it imports the 2026 records from `Complete Bug Analysis.xlsx` automatically. The **Bug insights** section then shows category and release-type charts. The spreadsheet has no start/end times, so imported bugs are marked **Not timed**; only bugs started in Traceboard get an exact duration.
