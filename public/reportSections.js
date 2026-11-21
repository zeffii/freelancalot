// Rich sections of the PDF report: a timeline (Gantt chart, one row per day),
// a summary card per week and per day. They use all the data imported from
// Revit journals when it is there: actions, undos, saves, dimensions, deletes
// and the share of each file worked in.
import { el, labelChip } from './dom.js';
import {
  dateKey, formatTime, formatDuration, formatHoursShort, startOfWeek, addDays,
  MONTH_NAMES, WEEKDAY_NAMES, weekdayIndex,
} from './dates.js';
import {
  getEntries, getJournalEntries, getLabelColor, noFileSlots, noFileMinutes, countsNoFileTime,
} from './store.js';
import { minutesOnDay, minutesByLabel, daySlots } from './accounting.js';
import { fileCounts, fileColors } from './activity.js';

const SVG = 'http://www.w3.org/2000/svg';
const TOP_FILES = 6;

function svg(tag, attributes = {}, text = '') {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  if (text) element.textContent = text;
  return element;
}

const shortDay = (day) => `${WEEKDAY_NAMES[weekdayIndex(day)]} ${day.getDate()} ${MONTH_NAMES[day.getMonth()].slice(0, 3)}`;
const noFileOf = (entries) => entries.reduce((sum, entry) => sum + noFileMinutes(entry), 0);

// Days with time for the chosen labels:
// [{ day, key, labels, minutes (counted), manual: [entry], journal: [entry], entries }]
// "entries" are the journal blocks that count (not excluded): the source of the
// journal figures (actions, files).
export function chosenDays(days, labels) {
  return days.map((day) => {
    const key = dateKey(day);
    const manual = getEntries(key).filter((entry) => labels.includes(entry.label));
    const journal = getJournalEntries(key).filter((entry) => labels.includes(entry.label));
    return {
      day, key, labels, manual, journal,
      minutes: minutesOnDay(key, labels),
      entries: journal.filter((entry) => !entry.excluded),
    };
  }).filter((item) => item.manual.length || item.journal.length);
}

const minutesOfItems = (items) => items.reduce((sum, item) => sum + item.minutes, 0);

// ---------- combining journal data over several blocks ----------

const ACTION_COUNTS = ['actions', 'smallActions', 'undos', 'multiUndos', 'redos', 'saves', 'dimensions'];

function combineActions(entries) {
  const list = entries.map((entry) => entry.activity?.actions).filter(Boolean);
  if (list.length === 0) return null;
  const combined = Object.fromEntries(ACTION_COUNTS.map((name) => [name, 0]));
  const deletes = new Map();
  const topActions = new Map();
  for (const actions of list) {
    for (const name of ACTION_COUNTS) combined[name] += actions[name] ?? 0;
    for (const [category, count] of actions.deletes ?? []) deletes.set(category, (deletes.get(category) ?? 0) + count);
    for (const [name, count] of actions.topActions ?? []) topActions.set(name, (topActions.get(name) ?? 0) + count);
  }
  const sorted = (map) => [...map].sort((a, b) => b[1] - a[1]);
  return { ...combined, deletes: sorted(deletes), topActions: sorted(topActions) };
}

function combineFiles(entries) {
  const totals = new Map();
  for (const entry of entries) {
    if (!entry.activity?.files?.length) continue;
    for (const [name, count] of fileCounts(entry.activity)) totals.set(name, (totals.get(name) ?? 0) + count);
  }
  const all = [...totals.values()].reduce((sum, count) => sum + count, 0);
  return [...totals].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, share: count / all }));
}

// ---------- small building blocks ----------

function metric(value, label) {
  const tile = el('div', 'report-metric');
  tile.append(el('div', 'report-metric-value', value), el('div', 'report-metric-label', label));
  return tile;
}

function metricsRow(minutes, dayCount, actions) {
  const row = el('div', 'report-metrics');
  row.append(metric(formatHoursShort(minutes), `${(minutes / 60).toFixed(2)} h`));
  if (dayCount !== null) row.append(metric(String(dayCount), dayCount === 1 ? 'day' : 'days'));
  if (actions) {
    const rate = actions.actions ? `${((actions.undos / actions.actions) * 100).toFixed(1)}%` : '–';
    row.append(
      metric(actions.actions.toLocaleString(), 'actions'),
      metric(String(actions.undos), `undos · ${rate}`),
      metric(String(actions.saves), 'saves'),
      metric(String(actions.dimensions), 'dimensions'),
    );
  }
  return row;
}

function labelLines(items) {
  const byLabel = minutesByLabel(items.map((item) => item.key), items[0]?.labels);
  const list = el('div', 'report-card-labels');
  for (const [label, minutes] of byLabel) {
    const line = el('div', 'report-card-label');
    const swatch = el('span', 'report-swatch');
    swatch.style.background = getLabelColor(label);
    line.append(swatch, labelChip(label), el('span', 'report-card-label-time', formatDuration(minutes)));
    list.append(line);
  }
  return list;
}

// A horizontal bar split by file share, with a legend of the biggest files.
function fileShareBar(shares, colors) {
  const wrapper = el('div', 'report-files');
  if (shares.length === 0) return wrapper;
  const bar = el('div', 'report-file-bar');
  for (const { name, share } of shares) {
    const part = el('div');
    part.style.width = `${share * 100}%`;
    part.style.background = colors.get(name) ?? '#888780';
    bar.append(part);
  }
  const legend = el('div', 'report-file-legend');
  const shown = shares.slice(0, TOP_FILES);
  for (const { name, share } of shown) {
    const item = el('span', 'report-file-item');
    const swatch = el('span', 'report-swatch');
    swatch.style.background = colors.get(name) ?? '#888780';
    item.append(swatch, `${name} ${share < 0.005 ? '<1' : Math.round(share * 100)}%`);
    legend.append(item);
  }
  if (shares.length > shown.length) legend.append(el('span', 'report-file-item muted', `+${shares.length - shown.length} more`));
  wrapper.append(el('div', 'report-subheading', 'Files worked in'), bar, legend);
  return wrapper;
}

function countList(title, items, limit) {
  if (!items?.length) return null;
  const text = items.slice(0, limit).map(([name, count]) => `${name} ${count}`).join(' · ');
  const block = el('div', 'report-count-list');
  block.append(el('span', 'report-subheading', `${title}: `), text);
  return block;
}

// ---------- timeline ----------

export function buildTimeline(items) {
  const section = el('section', 'report-section report-timeline');
  section.append(el('h2', '', 'Timeline'));

  let first = 24 * 60;
  let last = 0;
  for (const item of items) {
    for (const entry of [...item.manual, ...item.journal]) {
      first = Math.min(first, entry.start);
      last = Math.max(last, entry.end);
    }
  }
  first = Math.floor(first / 60) * 60;
  last = Math.ceil(last / 60) * 60;
  const hours = Math.max(1, (last - first) / 60);

  const width = 700;
  const left = 78;
  const right = 640;
  const rowHeight = 22;
  const top = 18;
  const height = top + items.length * rowHeight + 4;
  const x = (minute) => left + ((minute - first) / (last - first)) * (right - left);
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'report-timeline-chart', role: 'img' });
  const pattern = svg('pattern', { id: 'no-file-hatch', width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pattern.append(svg('rect', { width: 4, height: 4, fill: '#fff' }), svg('line', { x1: 0, y1: 0, x2: 0, y2: 4, stroke: '#000', 'stroke-width': 0.8 }));
  const defs = svg('defs');
  defs.append(pattern);
  chart.append(defs);

  const tickEvery = hours > 12 ? 2 : 1;
  for (let minute = first; minute <= last; minute += 60) {
    const isTick = ((minute - first) / 60) % tickEvery === 0;
    chart.append(svg('line', { x1: x(minute), x2: x(minute), y1: top - 4, y2: height - 2, stroke: isTick ? '#cfcfcf' : '#ececec', 'stroke-width': 0.6 }));
    if (isTick) chart.append(svg('text', { x: x(minute), y: 10, 'text-anchor': 'middle', class: 'report-chart-text' }, formatTime(minute % (24 * 60))));
  }

  // Each row has two tracks: your blocks (thin, top) and the Revit journal
  // blocks (below). Time that doesn't count is hatched; journal quarter-hours
  // with no file loaded are outlined.
  items.forEach((item, index) => {
    const y = top + index * rowHeight;
    chart.append(svg('rect', { x: left, y: y + 2, width: right - left, height: rowHeight - 6, fill: '#f3f2ee', rx: 2 }));
    chart.append(svg('text', { x: 0, y: y + rowHeight / 2 + 3, class: 'report-chart-text' }, shortDay(item.day)));
    const hasManual = item.manual.length > 0;
    const journalTop = hasManual ? y + 8 : y + 3;
    const journalHeight = hasManual ? rowHeight - 13 : rowHeight - 8;
    const bar = (entry, barTop, barHeight, hatched) => {
      const rect = svg('rect', {
        x: x(entry.start), y: barTop, width: Math.max(1.5, x(entry.end) - x(entry.start)), height: barHeight,
        fill: hatched ? 'url(#no-file-hatch)' : getLabelColor(entry.label), rx: 1.5,
        stroke: hatched ? getLabelColor(entry.label) : 'none', 'stroke-width': 0.8,
      });
      rect.append(svg('title', {}, `${entry.label} ${formatTime(entry.start)}–${formatTime(entry.end)}`));
      chart.append(rect);
    };
    for (const entry of item.journal) {
      bar(entry, journalTop, journalHeight, Boolean(entry.excluded));
      if (entry.excluded) continue;
      for (const slotStart of noFileSlots(entry)) {
        chart.append(svg('rect', {
          x: x(slotStart) + 0.5, y: journalTop + 0.5, width: Math.max(1, x(slotStart + 15) - x(slotStart) - 1), height: journalHeight - 1,
          fill: countsNoFileTime() ? '#fff' : 'url(#no-file-hatch)', stroke: '#000', 'stroke-width': 0.7,
        }));
      }
    }
    if (hasManual) {
      const slots = daySlots(item.key);
      for (const entry of item.manual) {
        bar(entry, y + 3, 4, false);
        for (let minute = entry.start; minute < entry.end; minute += 15) {
          const cell = slots[minute / 15];
          if (cell?.kind === 'extra' && !cell.counted) {
            chart.append(svg('rect', { x: x(minute), y: y + 3, width: x(minute + 15) - x(minute), height: 4, fill: 'url(#no-file-hatch)' }));
          }
        }
      }
    }
    chart.append(svg('text', { x: width, y: y + rowHeight / 2 + 3, 'text-anchor': 'end', class: 'report-chart-text strong' }, formatHoursShort(item.minutes)));
  });

  section.append(chart);
  const legend = el('div', 'report-timeline-legend');
  if (items.some((item) => item.manual.length)) {
    legend.append(el('span', 'report-track-key manual'), 'Logged by hand (top)', el('span', 'report-track-key journal'), 'Revit journals');
  }
  const noFile = items.reduce((sum, item) => sum + noFileOf(item.entries), 0);
  if (noFile) {
    legend.append(el('span', `report-no-file-swatch${countsNoFileTime() ? '' : ' excluded'}`),
      `No file loaded: ${formatDuration(noFile)}${countsNoFileTime() ? ' (counted)' : ' (not counted)'}`);
  }
  if (legend.childNodes.length) section.append(legend);
  return section;
}

// ---------- week and day cards ----------

export function buildWeekSummaries(items) {
  const section = el('section', 'report-section');
  section.append(el('h2', '', 'Weeks'));
  const colors = fileColors();
  const weeks = new Map();
  for (const item of items) {
    const key = dateKey(startOfWeek(item.day));
    if (!weeks.has(key)) weeks.set(key, { monday: startOfWeek(item.day), items: [] });
    weeks.get(key).items.push(item);
  }
  for (const { monday, items: weekItems } of weeks.values()) {
    const entries = weekItems.flatMap((item) => item.entries);
    const weekMinutes = minutesOfItems(weekItems);
    const card = el('div', 'report-card');
    const sunday = addDays(monday, 6);
    card.append(el('div', 'report-card-title', `Week of ${monday.getDate()} ${MONTH_NAMES[monday.getMonth()]} – ${sunday.getDate()} ${MONTH_NAMES[sunday.getMonth()]} ${sunday.getFullYear()}`));
    const actions = combineActions(entries);
    card.append(metricsRow(weekMinutes, weekItems.length, actions), labelLines(weekItems));
    card.append(fileShareBar(combineFiles(entries), colors));
    const noFile = noFileOf(entries);
    if (noFile) card.append(el('div', 'report-count-list', `No file loaded: ${formatDuration(noFile)}${countsNoFileTime() ? '' : ' (not counted)'}`));
    for (const part of [countList('Deleted', actions?.deletes, 6), countList('Most frequent', actions?.topActions, 6)]) {
      if (part) card.append(part);
    }
    section.append(card);
  }
  return section;
}

export function buildDaySummaries(items) {
  const section = el('section', 'report-section');
  section.append(el('h2', '', 'Days'));
  const colors = fileColors();
  for (const item of items) {
    const { day, entries } = item;
    const card = el('div', 'report-card report-day-card');
    const minutes = item.minutes;
    const title = el('div', 'report-card-title');
    title.append(`${WEEKDAY_NAMES[weekdayIndex(day)]} ${day.getDate()} ${MONTH_NAMES[day.getMonth()]}`, el('span', 'report-card-title-time', formatDuration(minutes)));
    card.append(title);
    const ranges = (list) => list.map((entry) => `${formatTime(entry.start)}–${formatTime(entry.end)}`).join(' · ');
    if (item.journal.length) card.append(el('div', 'report-day-blocks', `Revit: ${ranges(item.journal)}`));
    if (item.manual.length) card.append(el('div', 'report-day-blocks', `Logged: ${ranges(item.manual)}`));
    const actions = combineActions(entries);
    if (actions) {
      const rate = actions.actions ? ` (${((actions.undos / actions.actions) * 100).toFixed(1)}%)` : '';
      card.append(el('div', 'report-day-stats',
        `${actions.actions.toLocaleString()} actions · ${actions.undos} undos${rate} · ${actions.saves} saves · ${actions.dimensions} dimensions`));
    }
    if (minutesByLabel([item.key], item.labels).size > 1) card.append(labelLines([item]));
    card.append(fileShareBar(combineFiles(entries), colors));
    const noFile = noFileOf(entries);
    if (noFile) card.append(el('div', 'report-count-list', `No file loaded: ${formatDuration(noFile)}${countsNoFileTime() ? '' : ' (not counted)'}`));
    const deleted = countList('Deleted', actions?.deletes, 5);
    if (deleted) card.append(deleted);
    section.append(card);
  }
  return section;
}
