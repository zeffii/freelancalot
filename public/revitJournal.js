// Reads Revit journal files (journal.0001.txt …) and works out when Revit was
// actually being used. See docs/revit-journals.md for the method.
//
// Every user input (mouse move, click, key, command) is written to the journal
// on a line like:   'E 18-Nov-2026 09:45:12.345;   0:<
// Those times are grouped into active periods: a gap longer than the break
// threshold ends a period. The journal also names the file each action happened
// in ("[25.109-…_r2027.rvt]"), which gives the files used per period, and logs
// every completed operation ("Transaction Successful", "Place Dimensions"), every
// undo, and what was selected ("SEL RESULT: Walls : Basic Wall : …"), which give
// the actions summary.

const STAMP = /^\s*'([A-Z]) (\d{2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})/;
const FILE_NAME = /([^\\/"[\]:]+\.(?:rvt|rfa))\b/gi;
const BACKUP_COPY = /\.\d{4}\.(rvt|rfa)$/i;        // project.0001.rvt
const TEMP_FAMILY = /^[0-9a-f]{32}\.rfa$/i;        // Revit's temporary family copies
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// Text around a file name ("… registered for document 'X.rvt") is cut away.
function cleanFileName(raw) {
  const name = raw.split(/['>*(]|\bto |\bdocument |\blink /).pop().trim();
  if (!name || BACKUP_COPY.test(name) || TEMP_FAMILY.test(name) || /^\.(rvt|rfa)$/i.test(name)) return null;
  return name;
}

const TRANSACTION = /"Transaction Successful"\s*,\s*"([^"]*)"/;
const SELECTION = /"SEL RESULT: (.*?)"\s*$/;

// One journal file -> { sessionId, inputTimes: [Date], fileMentions: [{ time, name }],
//   saves, events: [{ time, type, name?, selection? }] }
// sessionId is the time the journal started ("2026-11-18T08:44:58"): one Revit
// session, used to recognise journals that were imported before.
// event types: 'action' (a completed operation, with its name and, for deletes,
// what was selected), 'undo', 'multiUndo', 'redo', 'save'.
export function parseJournal(text) {
  const inputTimes = [];
  const fileMentions = [];
  const events = [];
  let saves = 0;
  let currentTime = null;
  let lastSelection = null;
  let sessionId = null;

  for (const line of text.split('\n')) {
    const stamp = STAMP.exec(line);
    if (stamp) {
      const [, kind, day, month, year, hours, minutes, seconds] = stamp;
      currentTime = new Date(+year, MONTHS[month.toLowerCase()], +day, +hours, +minutes, +seconds);
      sessionId ??= `${year}-${String(MONTHS[month.toLowerCase()] + 1).padStart(2, '0')}-${day}T${hours}:${minutes}:${seconds}`;
      if (kind === 'E') inputTimes.push(currentTime);
      continue;
    }
    if (!currentTime) continue;
    recordEvent(line, currentTime, events, (selection) => { lastSelection = selection; }, () => lastSelection);
    if (!line.includes('.r')) {
      if (line.includes('ID_REVIT_FILE_SAVE')) saves++;
      continue;
    }
    if (line.includes('ID_REVIT_FILE_SAVE')) saves++;
    for (const match of line.matchAll(FILE_NAME)) {
      const name = cleanFileName(match[1]);
      if (name) fileMentions.push({ time: currentTime, name });
    }
  }
  return { sessionId, inputTimes, fileMentions, saves, events };
}

function recordEvent(line, time, events, setSelection, getSelection) {
  const selection = SELECTION.exec(line);
  if (selection) {
    setSelection(selection[1].trim());
    return;
  }
  const transaction = TRANSACTION.exec(line);
  if (transaction) {
    const name = transaction[1];
    events.push({ time, type: 'action', name, selection: name === 'Delete Selection' ? getSelection() : undefined });
    return;
  }
  if (!line.includes('Jrn.Command')) return;
  if (line.includes('ID_EDIT_UNDO')) events.push({ time, type: 'undo' });
  else if (line.includes('ID_SIMULATE_MULTIUNDO')) events.push({ time, type: 'multiUndo' });
  else if (line.includes('ID_EDIT_REDO')) events.push({ time, type: 'redo' });
  else if (line.includes('ID_REVIT_FILE_SAVE')) events.push({ time, type: 'save' });
}

// Group input times into active periods [{ start, end }].
export function activePeriods(times, breakMinutes) {
  const sorted = [...times].sort((a, b) => a - b);
  const periods = [];
  for (const time of sorted) {
    const last = periods[periods.length - 1];
    if (last && time - last.end <= breakMinutes * 60000) last.end = time;
    else periods.push({ start: time, end: time });
  }
  return periods;
}

const minutesOfDay = (date) => date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
const roundToQuarter = (minutes) => Math.round(minutes / 15) * 15;

const localDateKey = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// The whole analysis, ready for preview and import.
// journals: parsed journals; options: { breakMinutes, minimumMinutes, fromKey, toKey,
// ignoreFileText: [text], includeFiles, label }
// Returns days: [{ key, activeMinutes, saves, blocks: [{ start, end, note }] }]
export function analyseJournals(journals, options) {
  const inRange = (date) => {
    const key = localDateKey(date);
    return (!options.fromKey || key >= options.fromKey) && (!options.toKey || key <= options.toKey);
  };
  const allInputs = journals.flatMap((journal) => journal.inputTimes).filter(inRange);
  const ignored = (name) => options.ignoreFileText.some((text) => text && name.toLowerCase().includes(text.toLowerCase()));
  const mentions = journals.flatMap((journal) => journal.fileMentions).filter((mention) => !ignored(mention.name));

  const days = new Map();
  const dayFor = (key) => {
    if (!days.has(key)) days.set(key, { key, activeMinutes: 0, blocks: [] });
    return days.get(key);
  };

  for (const period of activePeriods(allInputs, options.breakMinutes)) {
    const lengthMinutes = (period.end - period.start) / 60000;
    if (lengthMinutes < options.minimumMinutes) continue;
    const day = dayFor(localDateKey(period.start));
    day.activeMinutes += lengthMinutes;

    const start = roundToQuarter(minutesOfDay(period.start));
    const end = Math.min(roundToQuarter(minutesOfDay(period.end)), 24 * 60);
    if (end <= start) continue;
    const last = day.blocks[day.blocks.length - 1];
    if (last && start <= last.end) {
      last.end = Math.max(last.end, end);
      last.periods.push(period);
    } else {
      day.blocks.push({ start, end, periods: [period] });
    }
  }

  const byDay = (items) => {
    const map = new Map();
    for (const item of items) {
      const key = localDateKey(item.time);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  };
  const mentionsByDay = byDay(mentions);
  const eventsByDay = byDay(journals.flatMap((journal) => journal.events ?? []));

  for (const day of days.values()) {
    const dayMentions = mentionsByDay.get(day.key) ?? [];
    const dayEvents = [];
    for (const block of day.blocks) {
      block.note = blockNote(block.periods, dayMentions, options.includeFiles);
      const activity = blockActivity(block, dayMentions);
      // Events from the first period's start to the last period's end.
      const from = block.periods[0].start;
      const to = block.periods[block.periods.length - 1].end;
      const blockEvents = (eventsByDay.get(day.key) ?? []).filter((event) => event.time >= from && event.time <= to);
      dayEvents.push(...blockEvents);
      // Every imported block keeps its activity, even with no file named at
      // all (then the whole block shows as "no file loaded").
      block.activity = activity ?? emptyActivity(block);
      block.activity.actions = actionsSummary(blockEvents);
      delete block.periods;
    }
    day.actions = actionsSummary(dayEvents);
  }
  return [...days.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// "Revit (from journals)" plus the models and families worked in, most used
// first, one file name per line.
function blockNote(periods, mentions, includeFiles) {
  let note = 'Revit (from journals)';
  if (!includeFiles) return note;
  const counts = new Map();
  for (const { time, name } of mentions) {
    if (periods.some((period) => time >= period.start && time <= period.end)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const names = [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const models = names.filter((name) => /\.rvt$/i.test(name));
  const families = names.filter((name) => /\.rfa$/i.test(name));
  if (models.length) note += `\nModels:\n${models.join('\n')}`;
  if (families.length) note += `\nFamilies:\n${families.join('\n')}`;
  return note;
}

// Small moves: one arrow-key nudge or drag counts as one action, so they are
// counted separately from the real work.
const SMALL_ACTIONS = new Set(['Nudge Up', 'Nudge Down', 'Nudge Left', 'Nudge Right', 'Drag', 'Drag Text Control']);
const TOP_ACTIONS = 8;
const TOP_DELETES = 6;

// "Walls : Basic Wall : 100mm Blockwork" -> "Walls"; "14 items," -> "Several elements"
function deletedCategory(selection) {
  if (!selection || selection === '<empty>') return 'Unknown';
  if (/^\d+ items/.test(selection)) return 'Several elements';
  return selection.split(' : ')[0].replace(/^<Sketch>$/, 'Sketch lines');
}

// Counts for the events between two times:
// { actions, smallActions, undos, multiUndos, redos, saves, dimensions,
//   topActions: [[name, count]], deletes: [[category, count]] }
export function actionsSummary(events) {
  const summary = { actions: 0, smallActions: 0, undos: 0, multiUndos: 0, redos: 0, saves: 0, dimensions: 0 };
  const byName = new Map();
  const deletes = new Map();
  for (const event of events) {
    if (event.type === 'undo') summary.undos++;
    else if (event.type === 'multiUndo') summary.multiUndos++;
    else if (event.type === 'redo') summary.redos++;
    else if (event.type === 'save') summary.saves++;
    else if (event.type === 'action') {
      if (SMALL_ACTIONS.has(event.name)) {
        summary.smallActions++;
        continue;
      }
      summary.actions++;
      byName.set(event.name, (byName.get(event.name) ?? 0) + 1);
      if (event.name === 'Place Dimensions') summary.dimensions++;
      if (event.name === 'Delete Selection') {
        const category = deletedCategory(event.selection);
        deletes.set(category, (deletes.get(category) ?? 0) + 1);
      }
    }
  }
  const top = (map, count) => [...map].sort((a, b) => b[1] - a[1]).slice(0, count);
  return { ...summary, topActions: top(byName, TOP_ACTIONS), deletes: top(deletes, TOP_DELETES) };
}

const ACTIVITY_STEP_MINUTES = 5;

// Which files were named in the journal in each 5-minute step of the block:
// { start, binMinutes, files: [name], bins: [[count per file]] }, or null.
function blockActivity(block, dayMentions) {
  const stepCount = (block.end - block.start) / ACTIVITY_STEP_MINUTES;
  const fileIndex = new Map();
  const steps = Array.from({ length: stepCount }, () => new Map());
  for (const { time, name } of dayMentions) {
    const step = Math.floor((minutesOfDay(time) - block.start) / ACTIVITY_STEP_MINUTES);
    if (step < 0 || step >= stepCount) continue;
    if (!fileIndex.has(name)) fileIndex.set(name, fileIndex.size);
    const index = fileIndex.get(name);
    steps[step].set(index, (steps[step].get(index) ?? 0) + 1);
  }
  if (fileIndex.size === 0) return null;
  return {
    start: block.start,
    binMinutes: ACTIVITY_STEP_MINUTES,
    files: [...fileIndex.keys()],
    bins: steps.map((counts) => Array.from({ length: fileIndex.size }, (_, index) => counts.get(index) ?? 0)),
  };
}

function emptyActivity(block) {
  const stepCount = (block.end - block.start) / ACTIVITY_STEP_MINUTES;
  return { start: block.start, binMinutes: ACTIVITY_STEP_MINUTES, files: [], bins: Array.from({ length: stepCount }, () => []) };
}

export function journalDateRange(journals) {
  const times = journals.flatMap((journal) => journal.inputTimes);
  if (times.length === 0) return null;
  let first = times[0];
  let last = times[0];
  for (const time of times) {
    if (time < first) first = time;
    if (time > last) last = time;
  }
  return { fromKey: localDateKey(first), toKey: localDateKey(last) };
}
