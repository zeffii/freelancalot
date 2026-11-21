// "Revit journals": turn Revit journal files into time blocks.
// Choose the Journals folder (or some journal files), set a label and options,
// check the preview, then add the blocks. They only fill empty time.
import { el } from './dom.js';
import { formatDuration, formatTime, formatLongDate } from './dates.js';
import {
  addJournalBlocks, removeJournalBlocks, markSessionsImported, isSessionImported, getLabelNames,
} from './store.js';
import { parseJournal, analyseJournals, journalDateRange } from './revitJournal.js';
import { unzipSync } from './vendor/fflate.js';

const GUIDE_URL = 'https://github.com/zeffii/freelancalot/blob/master/docs/revit-journals.md';
const SETTINGS_KEY = 'freelancalot.journalImport';

const JOURNAL_NAME = /^journal\.\d+\.txt$/i;
const baseName = (path) => path.split(/[\\/]/).pop();
const isJournalFile = (file) => JOURNAL_NAME.test(file.name);
const isZipFile = (file) => /\.zip$/i.test(file.name);

// The journal texts inside a zip (in any folder of it), without unpacking the rest.
async function journalTextsFromZip(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(bytes, { filter: (entry) => JOURNAL_NAME.test(baseName(entry.name)) });
  const decoder = new TextDecoder();
  return Object.values(entries).map((content) => decoder.decode(content));
}
const dateFromKey = (key) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
};

// "9 (0.9%)": undos and their share of the actions.
const undoText = (undos, actions) => (actions ? `${undos} (${((undos / actions) * 100).toFixed(1)}%)` : String(undos));

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
  filesInput.accept = '.txt,.zip';
  filesInput.hidden = true;
  const zipInput = el('input');
  zipInput.type = 'file';
  zipInput.accept = '.zip';
  zipInput.hidden = true;
  const folderButton = el('button', '', 'Choose Journals folder…');
  const zipButton = el('button', '', 'Choose zip…');
  const filesButton = el('button', '', 'Choose journal files…');
  const sourceStatus = el('span', 'muted', 'No journals chosen yet.');
  const sourceRow = el('div', 'dialog-row');
  sourceRow.append(el('span', 'dialog-label', 'Journals'), folderButton, zipButton, filesButton, folderInput, zipInput, filesInput);

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

  // Sessions imported before are skipped, unless importing them again is ticked
  // (that replaces this label's journal blocks on those days).
  const replaceToggle = el('label', 'toggle');
  const replaceCheckbox = el('input');
  replaceCheckbox.type = 'checkbox';
  replaceToggle.append(replaceCheckbox, ' Import sessions again that were imported before (replaces their journal blocks)');

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
    sourceRow, sourceStatus, labelRow, periodRow, rulesRow, ignoreRow, filesToggle, replaceToggle, preview, message, actions,
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
  const journalsToImport = () => (replaceCheckbox.checked ? journals : journals.filter((journal) => !isSessionImported(journal.sessionId)));
  function refreshPreview() {
    preview.replaceChildren();
    if (journals.length === 0) return;
    analysed = analyseJournals(journalsToImport(), readOptions());
    const skippedSessions = journals.length - journalsToImport().length;
    if (skippedSessions) {
      preview.append(el('p', 'muted dialog-note', `${skippedSessions} of ${journals.length} sessions were imported before and are skipped.`));
    }
    if (analysed.length === 0) {
      preview.append(el('p', 'muted', skippedSessions ? 'Nothing new to import.' : 'No Revit activity in these days.'));
      return;
    }
    const table = el('table', 'journal-table');
    const head = el('tr');
    for (const heading of ['Day', 'Active in Revit', 'Blocks (to the nearest ¼ h)', 'Blocks total', 'Actions', 'Undos']) head.append(el('th', '', heading));
    table.append(head);
    let activeTotal = 0;
    let blockTotal = 0;
    let actionTotal = 0;
    let undoTotal = 0;
    for (const day of analysed) {
      const blockMinutes = day.blocks.reduce((sum, block) => sum + block.end - block.start, 0);
      activeTotal += day.activeMinutes;
      blockTotal += blockMinutes;
      actionTotal += day.actions.actions;
      undoTotal += day.actions.undos;
      const row = el('tr');
      row.append(
        el('td', '', formatLongDate(dateFromKey(day.key))),
        el('td', '', formatDuration(Math.round(day.activeMinutes))),
        el('td', '', day.blocks.map((block) => `${formatTime(block.start)}–${formatTime(block.end)}`).join(', ')),
        el('td', '', formatDuration(blockMinutes)),
        el('td', '', day.actions.actions.toLocaleString()),
        el('td', '', undoText(day.actions.undos, day.actions.actions)),
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
      el('td', '', actionTotal.toLocaleString()),
      el('td', '', undoText(undoTotal, actionTotal)),
    );
    table.append(total);
    preview.append(table, el('p', 'muted dialog-note', 'Hover a row to see the notes its blocks will get.'));
  }

  // Journal files, zips of them (e.g. the zipped Journals folder), or both.
  async function readJournals(fileList) {
    const chosen = [...fileList];
    const zips = chosen.filter(isZipFile);
    const files = chosen.filter(isJournalFile);
    if (zips.length === 0 && files.length === 0) {
      sourceStatus.textContent = 'No journal files (journal.0001.txt …) or zips found there.';
      return;
    }
    sourceStatus.textContent = 'Reading journals…';
    const texts = [];
    try {
      for (const zip of zips) texts.push(...await journalTextsFromZip(zip));
    } catch (error) {
      sourceStatus.textContent = `Couldn't open the zip: ${error.message}`;
      return;
    }
    for (const file of files) texts.push(await file.text());
    if (texts.length === 0) {
      sourceStatus.textContent = 'No journal files (journal.0001.txt …) inside the zip.';
      return;
    }
    journals = texts.map(parseJournal);
    const range = journalDateRange(journals);
    const saves = journals.reduce((sum, journal) => sum + journal.saves, 0);
    if (range) {
      fromInput.value = range.fromKey;
      toInput.value = range.toKey;
      sourceStatus.textContent = `${journals.length} journals, ${formatLongDate(dateFromKey(range.fromKey))} – ${formatLongDate(dateFromKey(range.toKey))}, ${saves} saves.`;
    } else {
      sourceStatus.textContent = `${journals.length} journals, but no user activity in them.`;
    }
    refreshPreview();
  }

  folderButton.addEventListener('click', () => folderInput.click());
  zipButton.addEventListener('click', () => zipInput.click());
  zipInput.addEventListener('change', () => readJournals(zipInput.files));
  filesButton.addEventListener('click', () => filesInput.click());
  folderInput.addEventListener('change', () => readJournals(folderInput.files));
  filesInput.addEventListener('change', () => readJournals(filesInput.files));
  for (const input of [fromInput, toInput, breakInput, minimumInput, ignoreInput, filesCheckbox, replaceCheckbox]) {
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
    if (analysed.length === 0) {
      message.textContent = 'Nothing new to import: these sessions were all imported before.';
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
      if (replaceCheckbox.checked) removeJournalBlocks(day.key, options.label);
      const result = addJournalBlocks(day.key, options.label, day.blocks);
      added += result.added;
      skipped += result.skipped;
    }
    markSessionsImported(journalsToImport().map((journal) => journal.sessionId).filter(Boolean), options.label);
    close();
    const skippedText = skipped ? `\n${formatDuration(skipped)} was already covered by imported time and was left as it was.` : '';
    alert(`Added ${formatDuration(added)} under "${options.label}".${skippedText}`);
  });
}
