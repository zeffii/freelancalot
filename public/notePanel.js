// The panel to the right of the day view: shows and edits the note of the
// selected block. Notes are plain text; URLs and [text](url) become links.
import { el, labelChip } from './dom.js';
import { formatTime, formatDuration } from './dates.js';
import {
  getLabelColor, setNote, deleteBlock, noFileMinutes, countsNoFileTime, countedMinutes,
} from './store.js';
import { activityStrip, activityLegend, fileColors } from './activity.js';

const ACTIVITY_OPEN_SETTING = 'timesheet.activityOpen';
const ACTIONS_OPEN_SETTING = 'timesheet.actionsOpen';
const FINE_ROW_HEIGHT = 6;   // pixels per 5-minute step in the expanded histogram

// entry: the selected block, or null. startEditing: open the text box straight away.
export function renderNotePanel({ key, slot, entry, startEditing, onChangeLabel, onDeleted }) {
  const panel = el('aside', 'note-panel');

  if (!entry) {
    panel.append(el('p', 'muted', 'Click a block to see or add its note. Drag across empty slots to log time.'));
    return panel;
  }

  const header = el('div', 'note-header');
  const swatch = el('span', 'note-swatch');
  swatch.style.background = getLabelColor(entry.label);
  header.append(swatch, labelChip(entry.label));
  const notCounted = countsNoFileTime() ? 0 : noFileMinutes(entry);
  const countedText = notCounted ? ` · counted ${formatDuration(countedMinutes(entry))} (${formatDuration(notCounted)} no file loaded)` : '';
  const range = el('div', 'muted note-range', `${formatTime(entry.start)}–${formatTime(entry.end)} · ${formatDuration(entry.end - entry.start)}${countedText}`);

  const body = el('div', 'note-body');
  const editButton = el('button', '', 'Edit note');
  const labelButton = el('button', '', 'Change label');
  const deleteButton = el('button', '', 'Delete block');
  const actions = el('div', 'note-actions');
  actions.append(editButton, labelButton, deleteButton);

  const showNote = () => {
    body.replaceChildren();
    editButton.style.display = '';
    if (entry.note) {
      const rendered = renderNoteText(entry.note);
      rendered.title = 'Click to edit';
      rendered.addEventListener('click', (event) => {
        if (!event.target.closest('a')) showEditor();
      });
      body.append(rendered);
    } else {
      editButton.textContent = 'Add note';
    }
  };

  const showEditor = () => {
    body.replaceChildren();
    editButton.style.display = 'none';
    const textarea = el('textarea', 'note-input');
    textarea.value = entry.note ?? '';
    textarea.placeholder = 'Note for this block. Paste a URL, or write [text](https://…)';
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
      const changed = textarea.value.trim() !== (entry.note ?? '');
      if (!cancelled && changed) setNote(key, slot, textarea.value); // redraws the view
      else showNote();
    });
  };

  editButton.addEventListener('click', showEditor);
  labelButton.addEventListener('click', () => onChangeLabel(entry));
  deleteButton.addEventListener('click', () => {
    if (!confirm(`Delete this ${formatDuration(entry.end - entry.start)} block of "${entry.label}"?`)) return;
    onDeleted();
    deleteBlock(key, slot);
  });

  panel.append(header, range, body);
  if (entry.activity) panel.append(activitySection(entry));
  if (entry.activity?.actions) panel.append(actionsSection(entry.activity.actions));
  panel.append(actions);
  if (startEditing) {
    showEditor();
  } else {
    showNote();
  }
  return panel;
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
