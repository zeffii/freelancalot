// Day view: 15-minute rows you drag across to select, then label.
// Clicking a block selects it and shows its note in the panel on the right.
import { el, labelChip, noteMarker } from './dom.js';
import { dateKey, formatTime, formatDuration, formatLongDate } from './dates.js';
import {
  SLOT_MINUTES, SLOTS_PER_DAY, getEntries, getLabelColor, findEntryAt, assignSlots,
} from './store.js';
import { openLabelPopover } from './labelPopover.js';
import { renderNotePanel } from './notePanel.js';
import { renderSummary } from './summary.js';

const ROW_HEIGHT = 13;          // pixels per 15-minute slot
const DEFAULT_FIRST_HOUR = 7;
const DEFAULT_LAST_HOUR = 23;
const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;

// The selected block, kept across redraws: a slot inside it on a given day.
let selected = null;           // { key, slot }
let editNoteOnNextDraw = false;

export function renderDayView(container, date, { fullDay, rerender }) {
  const key = dateKey(date);
  const firstSlot = fullDay ? 0 : DEFAULT_FIRST_HOUR * SLOTS_PER_HOUR;
  const endSlot = fullDay ? SLOTS_PER_DAY : DEFAULT_LAST_HOUR * SLOTS_PER_HOUR;
  const slotTop = (slot) => (slot - firstSlot) * ROW_HEIGHT;
  const gridHeight = `${(endSlot - firstSlot) * ROW_HEIGHT}px`;

  const selectedEntry = selected?.key === key ? findEntryAt(key, selected.slot) : null;

  const page = el('div', 'day-page');
  const layout = el('div', 'day-layout');
  const gutter = el('div', 'day-gutter');
  const grid = el('div', 'day-grid');
  gutter.style.height = gridHeight;
  grid.style.height = gridHeight;

  drawRowsAndTimes(grid, gutter, firstSlot, endSlot, slotTop);
  const hiddenMinutes = drawBlocks(grid, key, firstSlot, endSlot, slotTop, selectedEntry);

  const selectionBox = el('div', 'selection-box');
  grid.append(selectionBox);
  const showSelection = (first, last) => {
    selectionBox.style.display = 'block';
    selectionBox.style.top = `${slotTop(first)}px`;
    selectionBox.style.height = `${(last - first + 1) * ROW_HEIGHT}px`;
  };
  const hideSelection = () => {
    selectionBox.style.display = 'none';
  };

  const selectBlock = (slot, editNote = false) => {
    selected = { key, slot };
    editNoteOnNextDraw = editNote;
  };

  // Ask for a label for slots first..last, then select the resulting block.
  const askForLabel = (first, last) => {
    showSelection(first, last);
    openLabelPopover({
      parent: grid,
      top: slotTop(first),
      key,
      firstSlot: first,
      lastSlot: last,
      onAssign(label) {
        selectBlock(first, true);
        assignSlots(key, first, last, label); // redraws the view
      },
      onClear() {
        selected = null;
        assignSlots(key, first, last, null);
      },
      onClose: hideSelection,
    });
  };

  setupSlotSelection(grid, {
    firstSlot,
    endSlot,
    showSelection,
    clickedSlot(slot) {
      if (!findEntryAt(key, slot)) return false;
      hideSelection();
      selectBlock(slot);
      rerender();
      return true;
    },
    selectionFinished: askForLabel,
  });

  layout.append(gutter, grid);
  const notePanel = renderNotePanel({
    key,
    slot: selected?.slot,
    entry: selectedEntry,
    startEditing: editNoteOnNextDraw,
    onChangeLabel: (entry) => askForLabel(entry.start / SLOT_MINUTES, entry.end / SLOT_MINUTES - 1),
    onDeleted: () => { selected = null; },
  });
  editNoteOnNextDraw = false;

  // Right-hand column: the note at the top, the day's hours at the bottom.
  const sideColumn = el('div', 'day-side');
  sideColumn.append(notePanel);
  if (hiddenMinutes > 0) {
    const note = `${formatDuration(hiddenMinutes)} logged outside ${formatTime(firstSlot * SLOT_MINUTES)}–${formatTime(endSlot * SLOT_MINUTES)}. Tick "Show 24 h" to see it.`;
    sideColumn.append(el('p', 'muted hidden-note', note));
  }
  sideColumn.append(renderSummary([key], `Hours on ${formatLongDate(date)}`));

  page.append(layout, sideColumn);
  container.append(page);
}

function drawRowsAndTimes(grid, gutter, firstSlot, endSlot, slotTop) {
  for (let slot = firstSlot; slot < endSlot; slot++) {
    const isHour = slot % SLOTS_PER_HOUR === 0;
    const line = el('div', isHour ? 'slot-line hour' : 'slot-line');
    line.style.top = `${slotTop(slot)}px`;
    grid.append(line);
    if (isHour) addGutterTime(gutter, slot, slotTop);
  }
  addGutterTime(gutter, endSlot, slotTop);
}

function addGutterTime(gutter, slot, slotTop) {
  const time = el('div', 'gutter-time', formatTime(slot * SLOT_MINUTES));
  time.style.top = `${slotTop(slot)}px`;
  gutter.append(time);
}

// Draws the labelled blocks; returns minutes that fall outside the visible hours.
function drawBlocks(grid, key, firstSlot, endSlot, slotTop, selectedEntry) {
  let hiddenMinutes = 0;
  for (const entry of getEntries(key)) {
    const start = Math.max(entry.start / SLOT_MINUTES, firstSlot);
    const end = Math.min(entry.end / SLOT_MINUTES, endSlot);
    hiddenMinutes += (entry.end - entry.start) - Math.max(0, end - start) * SLOT_MINUTES;
    if (end <= start) continue;

    const isSelected = selectedEntry && selectedEntry.start === entry.start;
    const block = el('div', isSelected ? 'time-block selected' : 'time-block');
    block.style.top = `${slotTop(start) + 1}px`;
    block.style.height = `${(end - start) * ROW_HEIGHT - 1}px`;
    block.style.background = getLabelColor(entry.label);

    const timeChip = labelChip(`${formatTime(entry.start)}–${formatTime(entry.end)} · ${formatDuration(entry.end - entry.start)}`);
    timeChip.classList.add('time-chip');
    block.append(labelChip(entry.label), timeChip);
    if (entry.note) {
      block.append(noteMarker());
      block.title = entry.note;
    }
    grid.append(block);
  }
  return hiddenMinutes;
}

// Press on a slot, drag up or down, release: the slots in between are selected.
// A click without dragging on a labelled slot goes to clickedSlot instead.
function setupSlotSelection(grid, { firstSlot, endSlot, showSelection, clickedSlot, selectionFinished }) {
  let anchorSlot = null;
  let currentSlot = null;
  let dragged = false;

  const slotAt = (event) => {
    const offsetY = event.clientY - grid.getBoundingClientRect().top;
    const slot = firstSlot + Math.floor(offsetY / ROW_HEIGHT);
    return Math.min(Math.max(slot, firstSlot), endSlot - 1);
  };
  const orderedRange = () => [Math.min(anchorSlot, currentSlot), Math.max(anchorSlot, currentSlot)];

  grid.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.label-popover')) return;
    document.activeElement?.blur(); // saves a note being edited…
    if (!grid.isConnected) return; // …which redraws the view, so this grid is gone
    grid.querySelector('.label-popover')?.closeLabelPopover();
    anchorSlot = currentSlot = slotAt(event);
    dragged = false;
    grid.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  grid.addEventListener('pointermove', (event) => {
    if (anchorSlot === null) return;
    const slot = slotAt(event);
    if (slot !== anchorSlot) dragged = true;
    currentSlot = slot;
    if (dragged) showSelection(...orderedRange());
  });

  grid.addEventListener('pointerup', () => {
    if (anchorSlot === null) return;
    const [first, last] = orderedRange();
    anchorSlot = currentSlot = null;
    if (!dragged && clickedSlot(first)) return;
    selectionFinished(first, last);
  });
}
