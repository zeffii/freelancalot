// "Export PDF": choose a period, labels and whether to include notes,
// preview the report, then save it with the browser's print dialog.
import { el, labelChip } from './dom.js';
import {
  addDays, addMonths, startOfWeek, daysInMonth, dateKey, today,
} from './dates.js';
import { getLabelColor } from './store.js';
import { buildReport, labelTotalsInRange } from './report.js';

const toInputValue = (date) => dateKey(date);
const fromInputValue = (value) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

function periodPresets(now) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = addMonths(monthStart, -1);
  return [
    ['This week', startOfWeek(now), addDays(startOfWeek(now), 6)],
    ['This month', monthStart, new Date(now.getFullYear(), now.getMonth(), daysInMonth(now.getFullYear(), now.getMonth()))],
    ['Last month', lastMonthStart, new Date(lastMonthStart.getFullYear(), lastMonthStart.getMonth(), daysInMonth(lastMonthStart.getFullYear(), lastMonthStart.getMonth()))],
    ['This year', new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear(), 11, 31)],
  ];
}

// The period shown in the current view is the starting choice.
function periodForView(view, date) {
  if (view === 'day' || view === 'week') return [startOfWeek(date), addDays(startOfWeek(date), 6)];
  if (view === 'year') return [new Date(date.getFullYear(), 0, 1), new Date(date.getFullYear(), 11, 31)];
  return [new Date(date.getFullYear(), date.getMonth(), 1), new Date(date.getFullYear(), date.getMonth(), daysInMonth(date.getFullYear(), date.getMonth()))];
}

export function openReportDialog({ view, date }) {
  const backdrop = el('div', 'modal-backdrop');
  const dialog = el('div', 'modal');
  backdrop.append(dialog);

  const [initialFrom, initialTo] = periodForView(view, date);
  const fromInput = el('input');
  const toInput = el('input');
  fromInput.type = toInput.type = 'date';
  fromInput.value = toInputValue(initialFrom);
  toInput.value = toInputValue(initialTo);

  const presets = el('div', 'button-group preset-buttons');
  for (const [name, from, to] of periodPresets(today())) {
    const button = el('button', '', name);
    button.addEventListener('click', () => {
      fromInput.value = toInputValue(from);
      toInput.value = toInputValue(to);
      refreshLabels();
    });
    presets.append(button);
  }

  const period = el('div', 'dialog-row');
  period.append(el('span', 'dialog-label', 'Period'), fromInput, el('span', '', 'to'), toInput);

  const labelList = el('div', 'dialog-labels');
  const allButton = el('button', '', 'All');
  const noneButton = el('button', '', 'None');
  const labelHeader = el('div', 'dialog-row');
  labelHeader.append(el('span', 'dialog-label', 'Labels'), allButton, noneButton);

  const notesToggle = el('label', 'toggle');
  const notesCheckbox = el('input');
  notesCheckbox.type = 'checkbox';
  notesCheckbox.checked = true;
  notesToggle.append(notesCheckbox, ' Include notes');

  const error = el('p', 'dialog-error');
  const createButton = el('button', 'primary', 'Preview PDF');
  const cancelButton = el('button', '', 'Cancel');
  const actions = el('div', 'dialog-actions');
  actions.append(createButton, cancelButton);

  dialog.append(el('h2', '', 'Export PDF'), presets, period, labelHeader, labelList, notesToggle, error, actions);
  document.body.append(backdrop);

  const readPeriod = () => [fromInputValue(fromInput.value), fromInputValue(toInput.value)];
  const chosenLabels = () => [...labelList.querySelectorAll('input:checked')].map((box) => box.value);

  // Only labels with time in the period are offered; previous ticks are kept.
  function refreshLabels() {
    const previouslyUnticked = new Set([...labelList.querySelectorAll('input:not(:checked)')].map((box) => box.value));
    labelList.replaceChildren();
    if (!fromInput.value || !toInput.value) return;
    const totals = labelTotalsInRange(...readPeriod());
    if (totals.size === 0) labelList.append(el('p', 'muted', 'No time logged in this period.'));
    for (const label of totals.keys()) {
      const option = el('label', 'dialog-label-option');
      const box = el('input');
      box.type = 'checkbox';
      box.value = label;
      box.checked = !previouslyUnticked.has(label);
      const swatch = el('span', 'report-swatch');
      swatch.style.background = getLabelColor(label);
      option.append(box, swatch, labelChip(label));
      labelList.append(option);
    }
  }

  const close = () => backdrop.remove();
  fromInput.addEventListener('change', refreshLabels);
  toInput.addEventListener('change', refreshLabels);
  allButton.addEventListener('click', () => labelList.querySelectorAll('input').forEach((box) => { box.checked = true; }));
  noneButton.addEventListener('click', () => labelList.querySelectorAll('input').forEach((box) => { box.checked = false; }));
  cancelButton.addEventListener('click', close);
  backdrop.addEventListener('pointerdown', (event) => { if (event.target === backdrop) close(); });
  dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });

  createButton.addEventListener('click', () => {
    const [fromDate, toDate] = readPeriod();
    if (!fromInput.value || !toInput.value || fromDate > toDate) {
      error.textContent = 'Choose a start date on or before the end date.';
      return;
    }
    if (chosenLabels().length === 0) {
      error.textContent = 'Tick at least one label.';
      return;
    }
    close();
    const report = buildReport({ fromDate, toDate, labels: chosenLabels(), includeNotes: notesCheckbox.checked });
    showPreview(report, `Timesheet ${fromInput.value} to ${toInput.value}`);
  });

  refreshLabels();
  createButton.focus();
}

// Full-page preview of the report with a button that opens the print dialog,
// where "Save as PDF" writes the file. Only the report is printed.
// fileName becomes the page title while open, which browsers use as the PDF's name.
function showPreview(report, fileName) {
  const preview = el('div', 'report-preview');
  const toolbar = el('div', 'report-toolbar');
  const printButton = el('button', 'primary', 'Save as PDF…');
  const closeButton = el('button', '', 'Close');
  toolbar.append(printButton, closeButton, el('span', 'muted', 'In the print dialog, choose "Save as PDF" as the printer.'));
  preview.append(toolbar, report);

  const appTitle = document.title;
  document.title = fileName;
  document.body.append(preview);
  document.body.classList.add('showing-report');

  const close = () => {
    preview.remove();
    document.body.classList.remove('showing-report');
    document.title = appTitle;
  };
  printButton.addEventListener('click', () => window.print());
  closeButton.addEventListener('click', close);
}
