// Week, month and year views. Clicking a day opens it in day view.
import { el, labelChip, noteMarker } from './dom.js';
import {
  MONTH_NAMES, WEEKDAY_NAMES, dateKey, addDays, startOfWeek, daysInMonth, weekdayIndex,
  isSameDay, today, formatHoursShort, formatTime,
} from './dates.js';
import {
  SLOT_MINUTES, getEntries, getJournalEntries, getLabelColor, countsNoFileTime,
} from './store.js';
import { minutesOnDay, minutesByLabel } from './accounting.js';
import { renderSummary } from './summary.js';
import { expandFileLists } from './notePanel.js';
import { activityStrip, fileColors } from './activity.js';

// ---------- week ----------

const WEEK_ROW_HEIGHT = 13;     // pixels per 15-minute slot (same as the day view)
const TIME_TICK_HOURS = 2;      // a time label every 2nd hour on the left
const PARTIAL_NOTE_MINUTES = 60; // blocks this long show as much of a long note as fits

// Notes as plain text for the small week blocks: [text](url) shows as text.
const plainNote = (note) => note.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

// Builds a week block's note: one file name per line under its heading, and
// long names may wrap only after a delimiter (- _ . space), continuing on the
// next row. Older one-line file lists are split up the same way.
const looksLikeFileName = (text) => /\.(rvt|rfa|rte|rft|dwg|ifc|pdf)$/i.test(text.trim());

function weekNote(note) {
  const container = el('div', 'week-note');
  for (const line of expandFileLists(plainNote(note)).split('\n')) {
    if (looksLikeFileName(line)) container.append(fileNameLine(line.trim()));
    else container.append(el('div', /:$/.test(line.trim()) ? 'week-note-heading' : '', line));
  }
  return container;
}

function fileNameLine(name) {
  const line = el('div', 'week-note-file');
  for (const part of name.split(/(?<=[-_. ])/)) {
    line.append(part, document.createElement('wbr'));
  }
  return line;
}

export function renderWeekView(container, date, { fullDay, showNotes, showActivity, openDay }) {
  const firstMinute = fullDay ? 0 : 7 * 60;
  const endMinute = fullDay ? 24 * 60 : 23 * 60;
  const pixelsPerMinute = WEEK_ROW_HEIGHT / SLOT_MINUTES;
  const bodyHeight = `${(endMinute - firstMinute) * pixelsPerMinute}px`;
  const days = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date), i));

  const week = el('div', 'week-grid');
  week.append(timeGutter(firstMinute, endMinute, pixelsPerMinute, bodyHeight));
  const notesToCheck = [];
  const colors = showActivity ? fileColors() : null;

  for (const day of days) {
    const key = dateKey(day);
    const column = el('div', 'week-day');
    column.addEventListener('click', () => openDay(day));

    const header = el('div', isSameDay(day, today()) ? 'week-header is-today' : 'week-header');
    header.append(el('span', '', `${WEEKDAY_NAMES[weekdayIndex(day)]} ${day.getDate()}`));
    const total = minutesOnDay(key);
    header.append(el('span', 'muted', total ? formatHoursShort(total) : ''));

    const body = el('div', 'week-body');
    body.style.height = bodyHeight;
    for (let hour = firstMinute / 60; hour < endMinute / 60; hour++) {
      const line = el('div', 'slot-line hour');
      line.style.top = `${(hour * 60 - firstMinute) * pixelsPerMinute}px`;
      body.append(line);
    }
    // Two lanes, as in the day view: your blocks left, Revit journal blocks right.
    const drawBlock = (entry, layer) => {
      const start = Math.max(entry.start, firstMinute);
      const end = Math.min(entry.end, endMinute);
      if (end <= start) return;
      const classes = ['week-block', layer === 'journal' ? 'journal-block' : 'manual-block'];
      if (entry.excluded) classes.push('excluded');
      const block = el('div', classes.join(' '));
      block.style.top = `${(start - firstMinute) * pixelsPerMinute}px`;
      block.style.height = `${(end - start) * pixelsPerMinute - 1}px`;
      block.style.background = getLabelColor(entry.label);
      const note = layer === 'journal' ? [entry.userNote, entry.note].filter(Boolean).join('\n') : entry.note;
      block.title = note ? `${entry.label}\n${note}` : entry.label;
      if (end - start >= 30) block.append(labelChip(entry.label));
      // File activity, when shown, takes the place of the note text (the bubble stays).
      const withActivity = Boolean(colors && entry.activity);
      if (withActivity) {
        block.append(activityStrip(entry.activity, {
          visibleStart: start,
          visibleEnd: end,
          top: (minute) => (minute - start) * pixelsPerMinute,
          rowHeight: WEEK_ROW_HEIGHT,
          rowMinutes: SLOT_MINUTES,
          colors,
          excludeNoFile: !countsNoFileTime(),
        }));
      }
      if (note) {
        const marker = noteMarker();
        block.append(marker);
        if (showNotes && !withActivity) {
          const noteText = weekNote(note);
          block.append(noteText);
          const allowPartial = entry.end - entry.start >= PARTIAL_NOTE_MINUTES;
          notesToCheck.push({ noteText, marker, lines: [...noteText.children], allowPartial });
        }
      }
      body.append(block);
    };
    for (const entry of getEntries(key)) drawBlock(entry, 'manual');
    for (const entry of getJournalEntries(key)) drawBlock(entry, 'journal');
    if (getEntries(key).length && getJournalEntries(key).length) body.classList.add('two-lanes');

    column.append(header, body, dayLabelTotals(key));
    week.append(column);
  }

  container.append(week);

  container.append(renderSummary(days.map(dateKey), 'Hours this week'));

  // A note that fits its block is shown and the bubble hidden. A note that
  // doesn't fit is hidden and the bubble stays, except in blocks of an hour or
  // more: those show as many whole lines as fit, then "… N more lines", and keep
  // the bubble (hover shows everything). Checked again whenever the columns
  // change width (window resized, scrollbar appearing), as names then wrap differently.
  const overflows = (noteText) => noteText.scrollHeight > noteText.clientHeight + 1;
  const fitNotes = () => {
    for (const { noteText, marker, lines, allowPartial } of notesToCheck) {
      noteText.replaceChildren(...lines);
      noteText.style.display = '';
      const roomy = noteText.clientHeight >= 12;
      if (roomy && !overflows(noteText)) {
        marker.style.display = 'none';
        continue;
      }
      marker.style.display = '';
      if (!roomy || !allowPartial) {
        noteText.style.display = 'none';
        continue;
      }
      const more = el('div', 'week-note-more');
      let shown = lines.length;
      do {
        shown--;
        more.textContent = `… ${lines.length - shown} more line${lines.length - shown === 1 ? '' : 's'}`;
        noteText.replaceChildren(...lines.slice(0, shown), more);
      } while (shown > 0 && overflows(noteText));
      if (shown === 0) noteText.style.display = 'none';
    }
  };
  fitNotes();
  if (notesToCheck.length) {
    let lastWidth = week.clientWidth;
    const observer = new ResizeObserver(() => {
      if (!week.isConnected) {
        observer.disconnect();
        return;
      }
      if (week.clientWidth !== lastWidth) {
        lastWidth = week.clientWidth;
        fitNotes();
      }
    });
    observer.observe(week);
  }
}

// Under each day: time per label, one line per label (usually just one).
function dayLabelTotals(key) {
  const list = el('div', 'week-day-totals');
  for (const [label, minutes] of minutesByLabel([key])) {
    const line = el('div', 'week-day-total');
    const swatch = el('span', 'week-day-swatch');
    swatch.style.background = getLabelColor(label);
    const name = el('span', 'week-day-label', label);
    name.title = label;
    line.append(swatch, name, el('span', 'week-day-time', formatHoursShort(minutes)));
    list.append(line);
  }
  return list;
}

function timeGutter(firstMinute, endMinute, pixelsPerMinute, bodyHeight) {
  const gutter = el('div', 'week-gutter');
  gutter.append(el('div', 'week-header'));
  const times = el('div', 'week-gutter-times');
  times.style.height = bodyHeight;
  for (let hour = Math.ceil(firstMinute / 60); hour * 60 <= endMinute; hour++) {
    if (hour % TIME_TICK_HOURS !== 0) continue;
    const tick = el('div', 'gutter-time', formatTime(hour * 60));
    tick.style.top = `${(hour * 60 - firstMinute) * pixelsPerMinute}px`;
    times.append(tick);
  }
  gutter.append(times);
  return gutter;
}

// ---------- month ----------

export function renderMonthView(container, date, { openDay }) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const dayCount = daysInMonth(year, month);
  const keys = [];

  const grid = el('div', 'month-grid');
  for (const name of WEEKDAY_NAMES) grid.append(el('div', 'month-weekday', name));
  const leadingBlanks = weekdayIndex(new Date(year, month, 1));
  for (let i = 0; i < leadingBlanks; i++) grid.append(el('div'));

  for (let dayNumber = 1; dayNumber <= dayCount; dayNumber++) {
    const day = new Date(year, month, dayNumber);
    const key = dateKey(day);
    keys.push(key);

    const cell = el('div', isSameDay(day, today()) ? 'month-cell is-today' : 'month-cell');
    cell.addEventListener('click', () => openDay(day));

    const top = el('div', 'month-cell-top');
    const total = minutesOnDay(key);
    top.append(el('span', '', String(dayNumber)), el('span', 'muted', total ? formatHoursShort(total) : ''));
    cell.append(top);

    const perLabel = minutesByLabel([key]);
    if (perLabel.size) {
      const labelList = el('div', 'month-labels');
      for (const [label] of [...perLabel].slice(0, 2)) labelList.append(labelChip(label));
      if (perLabel.size > 2) labelList.append(el('span', 'muted', `+${perLabel.size - 2}`));

      const bar = el('div', 'month-bar');
      for (const [label, minutes] of perLabel) {
        const segment = el('div');
        segment.style.flex = String(minutes);
        segment.style.background = getLabelColor(label);
        bar.append(segment);
      }
      cell.append(labelList, bar);
    }
    grid.append(cell);
  }

  container.append(grid);
  container.append(renderSummary(keys, `Hours in ${MONTH_NAMES[month]}`));
}

// ---------- year ----------

const HEAT_FULL_DAY_MINUTES = 8 * 60; // a day with this much time gets the darkest shade

export function renderYearView(container, date, { openDay, openMonth }) {
  const year = date.getFullYear();
  const keys = [];
  const grid = el('div', 'year-grid');

  for (let month = 0; month < 12; month++) {
    const monthBox = el('div', 'year-month');
    const dayCount = daysInMonth(year, month);
    let monthMinutes = 0;

    const days = el('div', 'year-days');
    const leadingBlanks = weekdayIndex(new Date(year, month, 1));
    for (let i = 0; i < leadingBlanks; i++) days.append(el('div'));

    for (let dayNumber = 1; dayNumber <= dayCount; dayNumber++) {
      const day = new Date(year, month, dayNumber);
      const key = dateKey(day);
      keys.push(key);
      const minutes = minutesOnDay(key);
      monthMinutes += minutes;

      const cell = el('div', isSameDay(day, today()) ? 'year-day is-today' : 'year-day');
      if (minutes) {
        const strength = Math.round(25 + 75 * Math.min(1, minutes / HEAT_FULL_DAY_MINUTES));
        cell.style.background = `color-mix(in srgb, var(--heat) ${strength}%, var(--surface-muted))`;
      }
      cell.title = `${dayNumber} ${MONTH_NAMES[month]}${minutes ? ` · ${formatHoursShort(minutes)}` : ''}`;
      cell.addEventListener('click', () => openDay(day));
      days.append(cell);
    }

    const title = el('button', 'year-month-title');
    title.append(el('span', '', MONTH_NAMES[month]), el('span', 'muted', monthMinutes ? formatHoursShort(monthMinutes) : ''));
    title.addEventListener('click', () => openMonth(new Date(year, month, 1)));

    monthBox.append(title, days);
    grid.append(monthBox);
  }

  container.append(grid);
  container.append(renderSummary(keys, `Hours in ${year}`));
}
