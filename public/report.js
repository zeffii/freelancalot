// Builds the printable report (saved as PDF through the browser's print dialog).
// Only days with logged time for the chosen labels appear.
import { el, labelChip } from './dom.js';
import { addDays, dateKey, formatTime, formatDuration, formatLongDate } from './dates.js';
import { getLabelColor } from './store.js';
import { minutesByLabel, countedRuns, extraMinutes } from './accounting.js';
import { renderNoteText } from './notePanel.js';
import { chosenDays, buildTimeline, buildWeekSummaries, buildDaySummaries } from './reportSections.js';

// "6h 45m (6.75 h)" — the decimal form is handy for invoicing.
function formatTotal(minutes) {
  return `${formatDuration(minutes)} (${(minutes / 60).toFixed(2)} h)`;
}

export function daysInRange(fromDate, toDate) {
  const days = [];
  for (let day = fromDate; day <= toDate; day = addDays(day, 1)) days.push(day);
  return days;
}

// Counted minutes per label over the period, for labels with any time in it.
export function labelTotalsInRange(fromDate, toDate) {
  return minutesByLabel(daysInRange(fromDate, toDate).map(dateKey));
}

// sections: { timeline, weeks, days } — which rich sections to include.
export function buildReport({ fromDate, toDate, labels, includeNotes, sections = {} }) {
  const report = el('article', 'report');
  const totals = labelTotalsInRange(fromDate, toDate);
  const chosen = [...totals.keys()].filter((label) => labels.includes(label));

  report.append(el('h1', '', 'Timesheet'));
  report.append(el('p', 'report-period', `${formatLongDate(fromDate)} – ${formatLongDate(toDate)}`));

  if (chosen.length === 0) {
    report.append(el('p', '', 'No time logged for the chosen labels in this period.'));
    return report;
  }

  report.append(buildOverview(chosen, totals, fromDate, toDate));
  const items = chosenDays(daysInRange(fromDate, toDate), chosen);
  if (sections.timeline) report.append(buildTimeline(items));
  if (sections.weeks) report.append(buildWeekSummaries(items));
  if (sections.days) report.append(buildDaySummaries(items));
  for (const label of chosen) {
    report.append(buildLabelSection(label, totals.get(label), fromDate, toDate, includeNotes));
  }
  return report;
}

function labelCell(label) {
  const cell = el('td', 'report-label-cell');
  const swatch = el('span', 'report-swatch');
  swatch.style.background = getLabelColor(label);
  cell.append(swatch, labelChip(label));
  return cell;
}

function row(cells, className = '') {
  const tr = el('tr', className);
  for (const cell of cells) tr.append(typeof cell === 'string' ? el('td', '', cell) : cell);
  return tr;
}

function table(headings, className) {
  const tableElement = el('table', `report-table ${className}`);
  const head = el('thead');
  head.append(row(headings.map((heading) => el('th', '', heading))));
  const body = el('tbody');
  tableElement.append(head, body);
  return { tableElement, body };
}

function buildOverview(chosen, totals, fromDate, toDate) {
  const section = el('section', 'report-section');
  section.append(el('h2', '', 'Summary'));
  const { tableElement, body } = table(['Label', 'Days', 'Time'], 'report-overview');

  let grandTotal = 0;
  for (const label of chosen) {
    const dayCount = daysInRange(fromDate, toDate)
      .filter((day) => countedRuns(dateKey(day), label).length > 0).length;
    grandTotal += totals.get(label);
    body.append(row([labelCell(label), String(dayCount), formatTotal(totals.get(label))]));
  }
  body.append(row(['Total', '', formatTotal(grandTotal)], 'report-total'));
  section.append(tableElement);

  // Logged time outside the Revit journals that you chose not to count.
  const extra = extraMinutes(daysInRange(fromDate, toDate).map(dateKey), chosen);
  if (extra.notCounted) {
    section.append(el('p', 'report-not-charged', `Not charged: ${formatDuration(extra.notCounted)} logged outside the Revit journals.`));
  }
  return section;
}

function buildLabelSection(label, labelMinutes, fromDate, toDate, includeNotes) {
  const section = el('section', 'report-section');
  const heading = el('h2', 'report-label-heading');
  const swatch = el('span', 'report-swatch');
  swatch.style.background = getLabelColor(label);
  heading.append(swatch, labelChip(label));
  section.append(heading);

  const headings = includeNotes ? ['Date', 'Time', 'Duration', 'Note'] : ['Date', 'Time', 'Duration'];
  const { tableElement, body } = table(headings, includeNotes ? 'with-notes' : '');

  // One row per run of counted time; where your blocks and journal blocks
  // overlap, the time shows once.
  for (const day of daysInRange(fromDate, toDate)) {
    const runs = countedRuns(dateKey(day), label);
    if (runs.length === 0) continue;

    runs.forEach((run, index) => {
      const cells = [
        index === 0 ? formatLongDate(day) : '',
        `${formatTime(run.start)}–${formatTime(run.end)}`,
        formatDuration(run.end - run.start),
      ];
      if (includeNotes) {
        const noteCell = el('td', 'report-note');
        for (const note of run.notes) noteCell.append(renderNoteText(note));
        cells.push(noteCell);
      }
      body.append(row(cells, index === 0 ? 'day-first' : ''));
    });

    if (runs.length > 1) {
      const dayMinutes = runs.reduce((sum, run) => sum + run.end - run.start, 0);
      const cells = ['', 'Day total', formatDuration(dayMinutes)];
      if (includeNotes) cells.push('');
      body.append(row(cells, 'report-day-total'));
    }
  }

  const totalCells = ['Total', '', formatTotal(labelMinutes)];
  if (includeNotes) totalCells.push('');
  body.append(row(totalCells, 'report-total'));
  section.append(tableElement);
  return section;
}
