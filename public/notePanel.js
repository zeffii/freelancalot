// The panel to the right of the day view: shows the selected block.
// - A block you logged: its note (editable), label, and whether its time
//   outside the Revit journals counts.
// - A block imported from Revit journals: read-only (it is the evidence), with
//   its generated note, your own remark, file activity and actions, and a tick
//   box to leave the session out of the totals.
// Notes are plain text; URLs and [text](url) become links.
import { el, labelChip } from './dom.js';
import { formatTime, formatDuration } from './dates.js';
import {
  getLabelColor, setNote, deleteBlock, noFileMinutes, countsNoFileTime, setCountExtra,
  setJournalExcluded, setJournalUserNote,
} from './store.js';
import { blockAccounting } from './accounting.js';
import { activityStrip, activityLegend, fileColors } from './activity.js';

const ACTIVITY_OPEN_SETTING = 'timesheet.activityOpen';
const ACTIONS_OPEN_SETTING = 'timesheet.actionsOpen';
const FINE_ROW_HEIGHT = 6;   // pixels per 5-minute step in the expanded histogram

// entry: the selected block, or null; layer: 'manual' or 'journal'.
// startEditing: open the note's text box straight away.
export function renderNotePanel({ key, slot, entry, layer, startEditing, onChangeLabel, onDeleted }) {
  const panel = el('aside', 'note-panel');
  if (!entry) {
    panel.append(el('p', 'muted', 'Click a block to see or add its note. Drag across empty slots to log time.'));
    return panel;
  }
  if (layer === 'journal') fillJournalPanel(panel, key, entry);
  else fillManualPanel(panel, { key, slot, entry, startEditing, onChangeLabel, onDeleted });
  return panel;
}

function panelHeader(entry, badge) {
  const header = el('div', 'note-header');
  const swatch = el('span', 'note-swatch');
  swatch.style.background = getLabelColor(entry.label);
  header.append(swatch, labelChip(entry.label));
  if (badge) header.append(el('span', 'note-badge', badge));
  return header;
}

function checkbox(text, checked, onChange) {
  const label = el('label', 'toggle note-toggle');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.addEventListener('change', () => onChange(box.checked));
  label.append(box, ` ${text}`);
  return label;
}

// A note shown as text (click to edit) or as a text box. Returns the element
// and an "Edit / Add" button for the panel's button row.
function noteEditor({ text, placeholder, addText, editText, startEditing, onSave }) {
  const body = el('div', 'note-body');
  const button = el('button', '', text ? editText : addText);

  const show = () => {
    body.replaceChildren();
    button.style.display = '';
    if (!text) return;
    const rendered = renderNoteText(text);
    rendered.title = 'Click to edit';
    rendered.addEventListener('click', (event) => {
      if (!event.target.closest('a')) edit();
    });
    body.append(rendered);
  };

  const edit = () => {
    body.replaceChildren();
    button.style.display = 'none';
    const textarea = el('textarea', 'note-input');
    textarea.value = text ?? '';
    textarea.placeholder = placeholder;
    body.append(textarea, el('div', 'muted note-hint', 'Ctrl+Enter or click away to save · Esc to cancel'));
    // The panel may not be on the page yet when this runs, so then focus once it is.
    if (textarea.isConnected) textarea.focus();
    else requestAnimationFrame(() => textarea.focus());

    let cancelled = false;
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) textarea.blur();
      if (event.key === 'Escape') {
        cancelled = true;
        textarea.blur();
      }
    });
    textarea.addEventListener('blur', () => {
      const changed = textarea.value.trim() !== (text ?? '');
      if (!cancelled && changed) onSave(textarea.value); // redraws the view
      else show();
    });
  };

  button.addEventListener('click', edit);
  if (startEditing) edit();
  else show();
  return { body, button };
}

// ---------- a block you logged ----------

function fillManualPanel(panel, { key, slot, entry, startEditing, onChangeLabel, onDeleted }) {
  const share = blockAccounting(key, entry);
  const length = entry.end - entry.start;
  let rangeText = `${formatTime(entry.start)}–${formatTime(entry.end)} · ${formatDuration(length)}`;
  if (share.counted !== length) rangeText += ` · counted ${formatDuration(share.counted)}`;

  const note = noteEditor({
    text: entry.note,
    placeholder: 'Note for this block. Paste a URL, or write [text](https://…)',
    addText: 'Add note',
    editText: 'Edit note',
    startEditing,
    onSave: (text) => setNote(key, slot, text),
  });

  const labelButton = el('button', '', 'Change label');
  const deleteButton = el('button', '', 'Delete block');
  labelButton.addEventListener('click', () => onChangeLabel(entry));
  deleteButton.addEventListener('click', () => {
    if (!confirm(`Delete this ${formatDuration(length)} block of "${entry.label}"?`)) return;
    onDeleted();
    deleteBlock(key, slot);
  });
  const buttons = el('div', 'note-actions');
  buttons.append(note.button, labelButton, deleteButton);

  panel.append(panelHeader(entry), el('div', 'muted note-range', rangeText), note.body);
  // Time in this block that the Revit journals don't cover ("extra" time).
  if (share.extra) {
    panel.append(checkbox(
      `Count the ${formatDuration(share.extra)} outside the Revit journals`,
      entry.countExtra !== false,
      (checked) => setCountExtra(key, slot, checked),
    ));
  }
  panel.append(buttons);
}

// ---------- a block from Revit journals ----------

function fillJournalPanel(panel, key, entry) {
  const share = blockAccounting(key, entry);
  const length = entry.end - entry.start;
  let rangeText = `${formatTime(entry.start)}–${formatTime(entry.end)} · ${formatDuration(length)}`;
  if (entry.excluded) rangeText += ' · not counted';
  else if (share.counted !== length) rangeText += ` · counted ${formatDuration(share.counted)}`;
  const noFile = countsNoFileTime() ? 0 : noFileMinutes(entry);
  if (noFile && !entry.excluded) rangeText += ` (${formatDuration(noFile)} no file loaded)`;

  panel.append(panelHeader(entry, 'Revit journal'), el('div', 'muted note-range', rangeText));
  if (entry.note) {
    const generated = renderNoteText(entry.note);
    generated.classList.add('note-generated');
    panel.append(generated);
  }

  const remark = noteEditor({
    text: entry.userNote,
    placeholder: 'Your own remark on this session (the journal data itself is not changed)',
    addText: 'Add my note',
    editText: 'Edit my note',
    startEditing: false,
    onSave: (text) => setJournalUserNote(key, entry.start, text),
  });
  if (entry.userNote) panel.append(el('div', 'note-subheading', 'My note'));
  panel.append(remark.body);

  panel.append(checkbox(
    'Leave this session out of the totals (e.g. it was other work)',
    Boolean(entry.excluded),
    (checked) => setJournalExcluded(key, entry.start, checked),
  ));
  if (entry.activity) panel.append(activitySection(entry));
  if (entry.activity?.actions) panel.append(actionsSection(entry.activity.actions));

  const buttons = el('div', 'note-actions');
  buttons.append(remark.button);
  panel.append(buttons);
}

// Expandable "File activity": the block's histogram in 5-minute steps, with
// hour marks and each file's share. Whether it is open is remembered.
function activitySection(entry) {
  const details = el('details', 'activity-details');
  details.open = localStorage.getItem(ACTIVITY_OPEN_SETTING) === 'true';
  details.append(el('summary', '', 'File activity'));
  details.addEventListener('toggle', () => localStorage.setItem(ACTIVITY_OPEN_SETTING, String(details.open)));

  const colors = fileColors();
  const step = entry.activity.binMinutes ?? 15;
  const chart = el('div', 'activity-chart');
  const height = ((entry.end - entry.start) / step) * FINE_ROW_HEIGHT;
  const times = el('div', 'activity-times');
  times.style.height = `${height}px`;
  for (let minute = Math.ceil(entry.start / 60) * 60; minute <= entry.end; minute += 60) {
    const tick = el('div', 'activity-tick', formatTime(minute));
    tick.style.top = `${((minute - entry.start) / step) * FINE_ROW_HEIGHT}px`;
    times.append(tick);
  }
  const strip = activityStrip(entry.activity, {
    visibleStart: entry.start,
    visibleEnd: entry.end,
    top: (minute) => ((minute - entry.start) / step) * FINE_ROW_HEIGHT,
    rowHeight: FINE_ROW_HEIGHT,
    rowMinutes: step,
    colors,
    className: 'activity-fine',
    excludeNoFile: !countsNoFileTime(),
  });
  strip.style.height = `${height}px`;
  chart.append(times, strip);
  details.append(chart, activityLegend(entry.activity, entry.start, entry.end, colors, noFileMinutes(entry), !countsNoFileTime()));
  return details;
}

// Expandable "Actions": what Revit logged as done in this block (from the
// journals): completed actions, undos, saves, dimensions, deletes by category.
function actionsSection(actions) {
  const details = el('details', 'activity-details');
  details.open = localStorage.getItem(ACTIONS_OPEN_SETTING) === 'true';
  const undoRate = actions.actions ? `${((actions.undos / actions.actions) * 100).toFixed(1)}%` : '–';
  details.append(el('summary', '', `Actions · ${actions.actions.toLocaleString()} done, ${actions.undos} undone (${undoRate})`));
  details.addEventListener('toggle', () => localStorage.setItem(ACTIONS_OPEN_SETTING, String(details.open)));

  const table = el('table', 'actions-table');
  const row = (name, value, hint = '') => {
    const tr = el('tr');
    tr.append(el('td', '', name), el('td', 'actions-number', value), el('td', 'muted', hint));
    table.append(tr);
  };
  row('Actions', actions.actions.toLocaleString(), `plus ${actions.smallActions.toLocaleString()} nudges and drags`);
  row('Undos', String(actions.undos), actions.multiUndos ? `plus ${actions.multiUndos} multi-undo (several steps each)` : '');
  if (actions.redos) row('Redos', String(actions.redos));
  row('Undo rate', undoRate, 'undos per action');
  row('Saves', String(actions.saves));
  row('Dimensions placed', String(actions.dimensions), 'each dimension string counts once');
  details.append(table);

  const list = (title, items) => {
    if (!items.length) return;
    details.append(el('div', 'actions-heading', title));
    const listTable = el('table', 'actions-table');
    for (const [name, count] of items) {
      const tr = el('tr');
      tr.append(el('td', '', name), el('td', 'actions-number', String(count)), el('td'));
      listTable.append(tr);
    }
    details.append(listTable);
  };
  list('Deleted', actions.deletes);
  list('Most frequent actions', actions.topActions);
  return details;
}

// Matches [text](http…) or a bare http(s) URL.
const LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>]+[^\s<>.,;:!?)\]'"])/g;

// Older journal notes list files on one line ("Models: a.rvt, b.rvt"); show
// those as a heading with one file per line, the same as newer notes.
// The stored note is not changed.
const FILE_LIST_LINE = /^(Models|Families):\s*(\S.*)$/;
export function expandFileLists(text) {
  return text.split('\n').map((line) => {
    const list = FILE_LIST_LINE.exec(line);
    return list ? `${list[1]}:\n${list[2].split(/,\s*(?=\S)/).join('\n')}` : line;
  }).join('\n');
}

// Builds the note as DOM nodes (never innerHTML), turning links into <a>.
export function renderNoteText(note) {
  const text = expandFileLists(note);
  const container = el('div', 'note-text');
  let position = 0;
  for (const match of text.matchAll(LINK_PATTERN)) {
    container.append(text.slice(position, match.index));
    const [, linkText, linkUrl, bareUrl] = match;
    const link = el('a', '', linkText ?? bareUrl);
    link.href = linkUrl ?? bareUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    container.append(link);
    position = match.index + match[0].length;
  }
  container.append(text.slice(position));
  return container;
}
