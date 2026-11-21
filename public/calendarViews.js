// Week, month and year views. Clicking a day opens it in day view.
import { el, labelChip } from './dom.js';
import {
  MONTH_NAMES, WEEKDAY_NAMES, dateKey, addDays, startOfWeek, daysInMonth, weekdayIndex,
  isSameDay, today, formatHoursShort,
} from './dates.js';
import { SLOT_MINUTES, getEntries, getLabelColor, minutesOnDay, minutesByLabel } from './store.js';
import { renderSummary } from './summary.js';

// ---------- week ----------

const WEEK_ROW_HEIGHT = 10; // pixels per 15-minute slot

export function renderWeekView(container, date, { fullDay, openDay }) {
  const firstMinute = fullDay ? 0 : 7 * 60;
  const endMinute = fullDay ? 24 * 60 : 23 * 60;
  const pixelsPerMinute = WEEK_ROW_HEIGHT / SLOT_MINUTES;
  const days = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date), i));

  const week = el('div', 'week-grid');
  for (const day of days) {
    const key = dateKey(day);
    const column = el('div', 'week-day');
    column.addEventListener('click', () => openDay(day));

    const header = el('div', isSameDay(day, today()) ? 'week-header is-today' : 'week-header');
    header.append(el('span', '', `${WEEKDAY_NAMES[weekdayIndex(day)]} ${day.getDate()}`));
    const total = minutesOnDay(key);
    header.append(el('span', 'muted', total ? formatHoursShort(total) : ''));

    const body = el('div', 'week-body');
    body.style.height = `${(endMinute - firstMinute) * pixelsPerMinute}px`;
    for (let hour = firstMinute / 60; hour < endMinute / 60; hour++) {
      const line = el('div', 'slot-line hour');
      line.style.top = `${(hour * 60 - firstMinute) * pixelsPerMinute}px`;
      body.append(line);
    }
    for (const entry of getEntries(key)) {
      const start = Math.max(entry.start, firstMinute);
      const end = Math.min(entry.end, endMinute);
      if (end <= start) continue;
      const block = el('div', 'week-block');
      block.style.top = `${(start - firstMinute) * pixelsPerMinute}px`;
      block.style.height = `${(end - start) * pixelsPerMinute - 1}px`;
      block.style.background = getLabelColor(entry.label);
      block.title = entry.label;
      if (end - start >= 45) block.append(labelChip(entry.label));
      body.append(block);
    }

    column.append(header, body);
    week.append(column);
  }

  container.append(week);
  container.append(renderSummary(days.map(dateKey), 'Hours this week'));
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
