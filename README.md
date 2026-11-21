# Freelancalot

A local calendar for logging consulting hours in 15-minute slots.

## Run

Needs Node.js (any recent version, no `npm install` needed).

- Windows: double-click `start.bat`. It opens the browser and starts the server.
- Or: `node server.js`, then open http://localhost:3210

Leave the console window open while you use it. Closing it stops the server.

## Use

- **Day view**: drag across slots to select them, then type a label. Existing labels
  are suggested as you type: ↑/↓ to choose, Tab to fill in, Enter to assign, Escape to cancel.
  Select already-labelled slots to relabel them, or use "Clear slots" to empty them.
  Shows 07:00–23:00. Tick "Show 24 h" for the whole day.
- **Notes**: after labelling, a note panel opens on the right. Click any block to see or
  edit its note, change its label or delete it. Each block has its own note, so blocks with
  the same label can have different notes. Paste a URL or write `[text](https://…)` for links.
  Ctrl+Enter or clicking away saves.
- **Week / Month / Year**: overview. Click a day to open it, click a month name in year view to open that month.
- Every view lists hours per label underneath. Click a label's colour square to change its colour, or its name to rename it (renaming to an existing name merges the two).
- ← / → step back and forward.

## Online copy

https://zeffii.github.io/freelancalot/ runs the same app without the server. There it saves
in the browser (localStorage) instead of `timesheet.json`. Use Export / Import to move data
between the two.

## Data

Everything is saved to `timesheet.json` next to `server.js`, shortly after each change.
The previous version is kept as `timesheet.json.bak`. Back up or sync `timesheet.json` as you like. Export downloads the same file; Import replaces all data with one.

## Files

- `server.js`: serves the app and reads and writes `timesheet.json`
- `public/store.js`: the data and every change to it
- `public/dayView.js`, `public/labelPopover.js`, `public/notePanel.js`: day view, the label box and the note panel
- `public/calendarViews.js`: week, month and year views
- `public/summary.js`: the hours per label list
- `public/app.js`: toolbar and switching between views
