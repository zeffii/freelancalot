# Working out hours from Revit journal files

If you didn't log your time while working in Revit, Revit has logged it for you.
Every Revit session writes a journal file that records almost everything you did,
with a timestamp. Freelancalot's **Revit journals** button reads those files and
turns them into time blocks.

This page explains where the journals are, how long they're kept, how to read
them, and exactly how the hours are worked out, so you can check the figures
yourself or explain them to a client.

## 1. Find the journals

Revit keeps them per user, per Revit version:

| Product | Folder |
|---|---|
| Revit LT | `%LOCALAPPDATA%\Autodesk\Revit\Autodesk Revit LT 2027\Journals` |
| Revit | `%LOCALAPPDATA%\Autodesk\Revit\Autodesk Revit 2027\Journals` |

Change `2027` to your version. Paste the path into the Explorer address bar and
press Enter; `%LOCALAPPDATA%` is usually `C:\Users\<you>\AppData\Local`. The
`AppData` folder is hidden by default, so typing the path is easiest.

The folder holds one `journal.NNNN.txt` per Revit session. The highest number is
the most recent. Next to them you'll find `journal.NNNN.worker1.log` files and
sometimes `.dmp` crash dumps; those aren't needed.

## 2. How long they stay — copy them soon

Revit deletes old journals automatically. The setting is in
**Options → General → Journal file cleanup**:

- *When number of journals exceeds* — default **10**
- *then delete journals older than (days)* — default **10**

So with the defaults, once you have more than 10 journals, any journal older than
10 days is deleted the next time Revit cleans up. A busy fortnight can easily
wipe the first week. (Autodesk's documentation lists these as the
`JournalShelfCapacity` and `JournalShelfLife` settings in `Revit.ini`.)

What to do:

- **Copy the Journals folder somewhere safe as soon as a job ends**, or zip it —
  Freelancalot can read the zip directly.
- If you want to keep a longer history, raise both numbers in the Options dialog,
  for example to 200 journals and 365 days. Journals are plain text; a heavy day
  is around 5–10 MB.

## 3. How to read a journal

Journals are text files, written as a script that Revit could replay. Open one in
any text editor. The lines that matter start with a quote and a letter, then a
timestamp:

```
'C 18-Nov-2026 09:45:10.120;  ->desktop InitApplication
  'E 18-Nov-2026 09:45:12.345;   0:<
  Jrn.MouseMove    0 ,    836 ,    219
  'E 18-Nov-2026 09:45:13.002;   0:<
  Jrn.Command "Ribbon"  , "Save the active project , ID_REVIT_FILE_SAVE"
  'H 18-Nov-2026 09:45:13.010;   0:<
  Jrn.Data  "File Name" , "IDOK" , "…\25.109-NJD-B1-ZZ-M3-S-1000_r2027.rvt"
```

- `'E` — an **event from you**: a mouse move, click, key press, wheel, command.
  The line after it says which (`Jrn.MouseMove`, `Jrn.Key`, `Jrn.Command`, …).
- `'H` — data Revit recorded in response (a file name chosen in a dialog, etc.).
- `'C` — Revit's own comments: startup, loading, timings.

The timestamp is local time on that computer. File names appear in several
forms: full paths when opening or saving, and `[name.rvt]` when an action happens
in a view of that document — so you can tell which model you were working in.
Saves show up as `ID_REVIT_FILE_SAVE`.

## 4. How the hours are worked out

1. **Collect your input.** Every `'E` timestamp from every journal chosen, all
   sessions together. If Revit was open twice at once, the times simply merge.
2. **Group it into active periods.** Times are sorted. A new period starts when
   there's a gap of more than the *break* threshold (default **15 minutes**) since
   the previous input. A gap shorter than that counts as working (thinking,
   reading a drawing, a quick call).
3. **Drop crumbs.** Periods shorter than the *minimum* (default **5 minutes**) are
   ignored — usually Revit being opened for a moment.
4. **"Active in Revit"** is the sum of the periods, to the minute. This is the
   most exact figure.
5. **Blocks.** Each period's start and end are rounded to the **nearest**
   quarter-hour (09:52 → 09:45, 09:53 → 10:00), because the timesheet works in
   15-minute slots. Periods that touch after rounding are joined. Rounding to the
   nearest (not outward) keeps the blocks total close to the active total.
6. **Files per block.** Each block's note lists the models (`.rvt`) and families
   (`.rfa`) named in the journal during that block, one per line, most used first. Revit's
   backup copies (`name.0001.rvt`) and temporary families (long hex names) are
   left out, and you can ignore any file by part of its name.
7. **File activity.** The block also stores, per 5 minutes, how often each file
   was named in the journal. With **File activity** ticked, day and week view
   draw this as a strip on the right of each block: time runs downwards, one
   stacked bar per 15 minutes, each file's share of that quarter-hour in its
   colour (families grouped as one band). In day view, the note panel's
   **File activity** section expands to the 5-minute detail with each file's
   share of the block. A file keeps the same colour everywhere.

### Choosing the break threshold

The break threshold is the one judgement call. Trying a few values shows how
sensitive the total is — for one week of work the figures were:

| Break after | Total |
|---|---|
| 10 min | 26.5 h |
| 15 min | 29.2 h |
| 30 min | 32.7 h |

10 minutes is strict (only steady clicking counts); 30 minutes counts most short
pauses as work. 15 minutes is a fair middle and the default.

## 5. What it can't see

- **Work outside Revit** — reading the brief, emails, calls, site visits, PDFs.
  Add those by hand.
- **Thinking with Revit idle** for longer than the break threshold.
- **Revit left open while doing something else** with occasional mouse moves
  over it can count as work; skim the blocks for anything implausible.
- **Other jobs.** The journals don't know which client a model belongs to.
  Use the date range, check the file names in the notes, and trim blocks that
  belong to other work.

## 6. Using it in Freelancalot

1. Click **Revit journals**.
2. **Choose Journals folder…**, **Choose zip…** (a zip of the Journals folder, as
   you'd save it after a job), or **Choose journal files…** to pick individual
   `journal.NNNN.txt` files. Only the `journal.NNNN.txt` files are read; the
   `.log` and `.dmp` files in the folder or zip are skipped.
3. Enter the **label** for the job, check the days, rules and ignored files.
4. Check the preview: per day, the active time, the blocks and their total.
   Hover over a day to see the notes its blocks will get.
5. **Add to timesheet.** Blocks only go into empty time; anything already logged
   is left as it is, and you're told how much overlapped. To import the same
   journals again (for example after an update to this feature), tick
   **Replace this label's existing time on these days**: that label's blocks on
   those days are replaced by the new ones.

Everything runs in your browser — the journals aren't uploaded anywhere.
