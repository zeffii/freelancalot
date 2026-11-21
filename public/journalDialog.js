// "Revit journals": turn Revit journal files into time blocks.
// Choose the Journals folder (or some journal files), set a label and options,
// check the preview, then add the blocks. They only fill empty time.
import { el } from './dom.js';
import { formatDuration, formatTime, formatLongDate } from './dates.js';
import { addBlocks, getLabelNames } from './store.js';
import { parseJournal, analyseJournals, journalDateRange } from './revitJournal.js';

const GUIDE_URL = 'https://github.com/zeffii/freelancalot/blob/master/docs/revit-journals.md';
const SETTINGS_KEY = 'freelancalot.journalImport';

const isJournalFile = (file) => /^journal\.\d+\.txt$/i.test(file.name);
const dateFromKey = (key) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
};

function loadSettings() {
  try {
    return { breakMinutes: 15, minimumMinutes: 5, ignore: '', includeFiles: true, label: '', ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) };
  } catch {
    return { breakMinutes: 15, minimumMinutes: 5, ignore: '', includeFiles: true, label: '' };
  }
}

function numberInput(value) {
  const input = el('input', 'dialog-number');
  input.type = 'number';
  input.min = '1';
  input.max = '240';
  input.value = String(value);
  return input;
}

export function openJournalDialog() {
  const settings = loadSettings();
  let journals = [];

  const backdrop = el('div', 'modal-backdrop');
  const dialog = el('div', 'modal modal-wide');
  backdrop.append(dialog);

  // ---- choosing journals ----
  const folderInput = el('input');
  folderInput.type = 'file';
  folderInput.webkitdirectory = true;
  folderInput.hidden = true;
  const filesInput = el('input');
  filesInput.type = 'file';
  filesInput.multiple = true;
  filesInput.accept = '.txt';
  filesInput.hidden = true;
  const folderButton = el('button', '', 'Choose Journals folder…');
  const filesButton = el('button', '', 'Choose journal files…');
  const sourceStatus = el('span', 'muted', 'No journals chosen yet.');
  const sourceRow = el('div', 'dialog-row');
  sourceRow.append(el('span', 'dialog-label', 'Journals'), folderButton, filesButton, folderInput, filesInput);

  // ---- options ----
  const labelInput = el('input', 'dialog-text');
  labelInput.value = settings.label;
  labelInput.placeholder = 'Project label';
  const labelOptions = el('datalist');
  labelOptions.id = 'journal-label-options';
  for (const name of getLabelNames()) labelOptions.append(Object.assign(el('option'), { value: name }));
  labelInput.setAttribute('list', labelOptions.id);
  const labelRow = el('div', 'dialog-row');
  labelRow.append(el('span', 'dialog-label', 'Label'), labelInput, labelOptions);

  const fromInput = el('input');
  const toInput = el('input');
  fromInput.type = toInput.type = 'date';
  const periodRow = el('div', 'dialog-row');
  periodRow.append(el('span', 'dialog-label', 'Days'), fromInput, el('span', '', 'to'), toInput);

  const breakInput = numberInput(settings.breakMinutes);
  const minimumInput = numberInput(settings.minimumMinutes);
  const rulesRow = el('div', 'dialog-row');
  rulesRow.append(
    el('span', 'dialog-label', 'Rules'),
    el('span', '', 'a gap over'), breakInput, el('span', '', 'min is a break; ignore periods under'), minimumInput, el('span', '', 'min'),
  );

  const ignoreInput = el('input', 'dialog-text');
  ignoreInput.value = settings.ignore;
  ignoreInput.placeholder = 'e.g. 24130, Spa Road';
  const ignoreRow = el('div', 'dialog-row');
  ignoreRow.append(el('span', 'dialog-label', 'Ignore'), ignoreInput, el('span', 'muted', 'files whose name contains (comma-separated)'));

  const filesToggle = el('label', 'toggle');
  const filesCheckbox = el('input');
  filesCheckbox.type = 'checkbox';
  filesCheckbox.checked = settings.includeFiles;
  filesToggle.append(filesCheckbox, ' List the models and families used in each block\'s note');

  const preview = el('div', 'journal-preview');
  const message = el('p', 'dialog-error');
  const addButton = el('button', 'primary', 'Add to timesheet');
  const cancelButton = el('button', '', 'Cancel');
  const guideLink = el('a', 'dialog-guide', 'How this works');
  guideLink.href = GUIDE_URL;
  guideLink.target = '_blank';
  guideLink.rel = 'noopener noreferrer';
  const actions = el('div', 'dialog-actions');
  actions.append(addButton, cancelButton, guideLink);

  dialog.append(
    el('h2', '', 'Revit journals'),
    el('p', 'muted dialog-note', 'Works out when Revit was in use from its journal files, and adds that time as blocks. Only empty time is filled.'),
    sourceRow, sourceStatus, labelRow, periodRow, rulesRow, ignoreRow, filesToggle, preview, message, actions,
  );
  document.body.append(backdrop);

  const readOptions = () => ({
    label: labelInput.value.trim(),
    fromKey: fromInput.value,
    toKey: toInput.value,
    breakMinutes: Math.max(1, Number(breakInput.value) || 15),
    minimumMinutes: Math.max(0, Number(minimumInput.value) || 0),
    ignoreFileText: ignoreInput.value.split(',').map((text) => text.trim()).filter(Boolean),
    includeFiles: filesCheckbox.checked,
  });

  let analysed = [];
  function refreshPreview() {
    preview.replaceChildren();
    if (journals.length === 0) return;
    analysed = analyseJournals(journals, readOptions());
    if (analysed.length === 0) {
      preview.append(el('p', 'muted', 'No Revit activity in these days.'));
      return;
    }
    const table = el('table', 'journal-table');
    const head = el('tr');
    for (const heading of ['Day', 'Active in Revit', 'Blocks (to the nearest ¼ h)', 'Blocks total']) head.append(el('th', '', heading));
    table.append(head);
    let activeTotal = 0;
    let blockTotal = 0;
    for (const day of analysed) {
      const blockMinutes = day.blocks.reduce((sum, block) => sum + block.end - block.start, 0);
      activeTotal += day.activeMinutes;
      blockTotal += blockMinutes;
      const row = el('tr');
      row.append(
        el('td', '', formatLongDate(dateFromKey(day.key))),
        el('td', '', formatDuration(Math.round(day.activeMinutes))),
        el('td', '', day.blocks.map((block) => `${formatTime(block.start)}–${formatTime(block.end)}`).join(', ')),
        el('td', '', formatDuration(blockMinutes)),
      );
      row.title = day.blocks.map((block) => `${formatTime(block.start)}–${formatTime(block.end)}\n${block.note}`).join('\n\n');
      table.append(row);
    }
    const total = el('tr', 'journal-total');
    total.append(
      el('td', '', 'Total'),
      el('td', '', `${formatDuration(Math.round(activeTotal))} (${(activeTotal / 60).toFixed(2)} h)`),
      el('td', '', ''),
      el('td', '', `${formatDuration(blockTotal)} (${(blockTotal / 60).toFixed(2)} h)`),
    );
    table.append(total);
    preview.append(table, el('p', 'muted dialog-note', 'Hover a row to see the notes its blocks will get.'));
  }

  async function readJournals(fileList) {
    const files = [...fileList].filter(isJournalFile);
    if (files.length === 0) {
      sourceStatus.textContent = 'No journal files (journal.0001.txt …) found there.';
      return;
    }
    sourceStatus.textContent = `Reading ${files.length} journals…`;
    journals = [];
    for (const file of files) journals.push(parseJournal(await file.text()));
    const range = journalDateRange(journals);
    const saves = journals.reduce((sum, journal) => sum + journal.saves, 0);
    if (range) {
      fromInput.value = range.fromKey;
      toInput.value = range.toKey;
      sourceStatus.textContent = `${files.length} journals, ${formatLongDate(dateFromKey(range.fromKey))} – ${formatLongDate(dateFromKey(range.toKey))}, ${saves} saves.`;
    } else {
      sourceStatus.textContent = `${files.length} journals, but no user activity in them.`;
    }
    refreshPreview();
  }

  folderButton.addEventListener('click', () => folderInput.click());
  filesButton.addEventListener('click', () => filesInput.click());
  folderInput.addEventListener('change', () => readJournals(folderInput.files));
  filesInput.addEventListener('change', () => readJournals(filesInput.files));
  for (const input of [fromInput, toInput, breakInput, minimumInput, ignoreInput, filesCheckbox]) {
    input.addEventListener('change', refreshPreview);
  }

  const close = () => backdrop.remove();
  cancelButton.addEventListener('click', close);
  backdrop.addEventListener('pointerdown', (event) => { if (event.target === backdrop) close(); });
  dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });

  addButton.addEventListener('click', () => {
    const options = readOptions();
    if (journals.length === 0) {
      message.textContent = 'Choose the Journals folder or some journal files first.';
      return;
    }
    if (!options.label) {
      message.textContent = 'Enter the label to log this time under.';
      labelInput.focus();
      return;
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      breakMinutes: options.breakMinutes,
      minimumMinutes: options.minimumMinutes,
      ignore: ignoreInput.value,
      includeFiles: options.includeFiles,
      label: options.label,
    }));
    let added = 0;
    let skipped = 0;
    for (const day of analysed) {
      const result = addBlocks(day.key, options.label, day.blocks);
      added += result.added;
      skipped += result.skipped;
    }
    close();
    const skippedText = skipped ? `\n${formatDuration(skipped)} overlapped time already logged and was left as it was.` : '';
    alert(`Added ${formatDuration(added)} under "${options.label}".${skippedText}`);
  });
}
