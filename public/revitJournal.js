// Reads Revit journal files (journal.0001.txt …) and works out when Revit was
// actually being used. See docs/revit-journals.md for the method.
//
// Every user input (mouse move, click, key, command) is written to the journal
// on a line like:   'E 18-Nov-2026 09:45:12.345;   0:<
// Those times are grouped into active periods: a gap longer than the break
// threshold ends a period. The journal also names the file each action happened
// in ("[25.109-…_r2027.rvt]"), which gives the files used per period.

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

// One journal file -> { inputTimes: [Date], fileMentions: [{ time, name }], saves }
export function parseJournal(text) {
  const inputTimes = [];
  const fileMentions = [];
  let saves = 0;
  let currentTime = null;

  for (const line of text.split('\n')) {
    const stamp = STAMP.exec(line);
    if (stamp) {
      const [, kind, day, month, year, hours, minutes, seconds] = stamp;
      currentTime = new Date(+year, MONTHS[month.toLowerCase()], +day, +hours, +minutes, +seconds);
      if (kind === 'E') inputTimes.push(currentTime);
      continue;
    }
    if (!currentTime || !line.includes('.r')) {
      if (currentTime && line.includes('ID_REVIT_FILE_SAVE')) saves++;
      continue;
    }
    if (line.includes('ID_REVIT_FILE_SAVE')) saves++;
    for (const match of line.matchAll(FILE_NAME)) {
      const name = cleanFileName(match[1]);
      if (name) fileMentions.push({ time: currentTime, name });
    }
  }
  return { inputTimes, fileMentions, saves };
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

  for (const day of days.values()) {
    for (const block of day.blocks) {
      block.note = blockNote(block.periods, mentions, options.includeFiles);
      delete block.periods;
    }
  }
  return [...days.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// "Revit (from journals)" plus the models and families worked in, most used first.
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
  if (models.length) note += `\nModels: ${models.join(', ')}`;
  if (families.length) note += `\nFamilies: ${families.join(', ')}`;
  return note;
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
