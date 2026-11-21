// Day view: 15-minute rows you drag across to select, then label.
// Clicking a block selects it and shows its note in the panel on the right.
// Two lanes: on the left the blocks you log yourself (editable), on the right
// the blocks imported from Revit journals (the evidence, not editable).
import { el, labelChip, noteMarker } from './dom.js';
import { dateKey, formatTime, formatDuration, formatLongDate } from './dates.js';
import {
  SLOT_MINUTES, SLOTS_PER_DAY, getEntries, getLabelColor, findEntryAt, assignSlots,
  isBlockEdge, boundaryLimits, moveBoundary, blockMoveLimits, moveBlock, countsNoFileTime,
  getJournalEntries, findJournalEntryAt,
} from './store.js';
import { daySlots } from './accounting.js';
import { openLabelPopover } from './labelPopover.js';
import { renderNotePanel } from './notePanel.js';
import { renderSummary } from './summary.js';
import { activityStrip, fileColors } from './activity.js';

const ROW_HEIGHT = 13;          // pixels per 15-minute slot
const DEFAULT_FIRST_HOUR = 7;
const DEFAULT_LAST_HOUR = 23;
const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;
const EDGE_GRAB_PIXELS = 4;    // how close to a block edge counts as grabbing it
const SELECTED_EDGE_GRAB_PIXELS = 7; // the selected block's handles are easier to grab
const MANUAL_LANE_SHARE = 0.42;  // left part of the grid for your own blocks (matches the CSS)

// The selected block, kept across redraws: a slot inside it on a given day,
// and which lane it is in ('manual' or 'journal').
let selected = null;           // { key, slot, layer }
let editNoteOnNextDraw = false;

export function renderDayView(container, date, { fullDay, showActivity, rerender }) {
  const key = dateKey(date);
  const firstSlot = fullDay ? 0 : DEFAULT_FIRST_HOUR * SLOTS_PER_HOUR;
  const endSlot = fullDay ? SLOTS_PER_DAY : DEFAULT_LAST_HOUR * SLOTS_PER_HOUR;
  const slotTop = (slot) => (slot - firstSlot) * ROW_HEIGHT;
  const gridHeight = `${(endSlot - firstSlot) * ROW_HEIGHT}px`;

  const findIn = (layer, slot) => (layer === 'journal' ? findJournalEntryAt(key, slot) : findEntryAt(key, slot));
  const selectedEntry = selected?.key === key ? findIn(selected.layer, selected.slot) : null;
  const selectedManual = selected?.layer === 'manual' ? selectedEntry : null;

  const page = el('div', 'day-page');
  const layout = el('div', 'day-layout');
  const gutter = el('div', 'day-gutter');
  const grid = el('div', 'day-grid');
  gutter.style.height = gridHeight;
  grid.style.height = gridHeight;

  drawRowsAndTimes(grid, gutter, firstSlot, endSlot, slotTop);
  const colors = showActivity ? fileColors() : null;
  grid.append(el('div', 'lane-divider'));
  const { hiddenMinutes, blockElements } = drawBlocks(grid, key, firstSlot, endSlot, slotTop, selectedManual, colors);
  const hiddenJournal = drawJournalBlocks(grid, key, firstSlot, endSlot, slotTop, selected?.layer === 'journal' ? selectedEntry : null, colors);

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

  const selectBlock = (slot, editNote = false, layer = 'manual') => {
    selected = { key, slot, layer };
    editNoteOnNextDraw = editNote;
  };
  const inManualLane = (offsetX) => offsetX < grid.clientWidth * MANUAL_LANE_SHARE;

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
    // A click selects the block in the lane clicked; if that lane is empty
    // there, the block in the other lane.
    clickedSlot(slot, offsetX) {
      const order = inManualLane(offsetX) ? ['manual', 'journal'] : ['journal', 'manual'];
      const layer = order.find((candidate) => findIn(candidate, slot));
      if (!layer) return false;
      hideSelection();
      selectBlock(slot, false, layer);
      rerender();
      return true;
    },
    selectionFinished: askForLabel,
    // Only your own blocks (left lane) have edges to drag.
    edgeAt(offsetY, offsetX) {
      if (!inManualLane(offsetX)) return null;
      // The selected block's top and bottom handles first, with a bigger grab zone.
      if (selectedManual) {
        for (const minutes of [selectedManual.start, selectedManual.end]) {
          const edge = minutes / SLOT_MINUTES;
          const visible = edge >= firstSlot && edge <= endSlot;
          if (visible && Math.abs(offsetY - slotTop(edge)) <= SELECTED_EDGE_GRAB_PIXELS) return edge;
        }
      }
      const boundary = firstSlot + Math.round(offsetY / ROW_HEIGHT);
      const nearLine = Math.abs(offsetY - slotTop(boundary)) <= EDGE_GRAB_PIXELS;
      return nearLine && boundary >= firstSlot && boundary <= endSlot && isBlockEdge(key, boundary) ? boundary : null;
    },
    startEdgeDrag(boundary) {
      return createEdgeDrag({ grid, key, boundary, firstSlot, endSlot, slotTop, blockElements });
    },
    blockAt(slot, offsetX) {
      return inManualLane(offsetX) ? findEntryAt(key, slot) : null;
    },
    startBlockMove(slot) {
      selectBlock(slot);
      return createBlockMove({ grid, key, slot, firstSlot, endSlot, slotTop, blockElements });
    },
  });

  const laneTitles = el('div', 'lane-titles');
  laneTitles.append(el('span', 'lane-title manual', 'Logged by you'), el('span', 'lane-title journal', 'Revit journals'));
  layout.append(el('div'), laneTitles, gutter, grid);
  const notePanel = renderNotePanel({
    key,
    slot: selected?.slot,
    entry: selectedEntry,
    layer: selected?.layer,
    startEditing: editNoteOnNextDraw,
    onChangeLabel: (entry) => askForLabel(entry.start / SLOT_MINUTES, entry.end / SLOT_MINUTES - 1),
    onDeleted: () => { selected = null; },
  });
  editNoteOnNextDraw = false;

  // Right-hand column: the note at the top, the day's hours at the bottom.
  const sideColumn = el('div', 'day-side');
  sideColumn.append(notePanel);
  if (hiddenMinutes + hiddenJournal > 0) {
    const note = `${formatDuration(hiddenMinutes + hiddenJournal)} logged outside ${formatTime(firstSlot * SLOT_MINUTES)}–${formatTime(endSlot * SLOT_MINUTES)}. Tick "24 h" to see it.`;
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

// Draws your own blocks (left lane). Returns the minutes that fall outside the
// visible hours, and each block's element with its slot range (for edge dragging).
// Time outside the journals that isn't counted (countExtra off) is hatched.
function drawBlocks(grid, key, firstSlot, endSlot, slotTop, selectedEntry, colors) {
  let hiddenMinutes = 0;
  const blockElements = [];
  const accounting = daySlots(key);
  for (const entry of getEntries(key)) {
    const start = Math.max(entry.start / SLOT_MINUTES, firstSlot);
    const end = Math.min(entry.end / SLOT_MINUTES, endSlot);
    hiddenMinutes += (entry.end - entry.start) - Math.max(0, end - start) * SLOT_MINUTES;
    if (end <= start) continue;

    const isSelected = selectedEntry && selectedEntry.start === entry.start;
    const block = el('div', isSelected ? 'time-block manual-block selected' : 'time-block manual-block');
    block.style.top = `${slotTop(start) + 1}px`;
    block.style.height = `${(end - start) * ROW_HEIGHT - 1}px`;
    block.style.background = getLabelColor(entry.label);

    const timeChip = labelChip(`${formatTime(entry.start)}–${formatTime(entry.end)} · ${formatDuration(entry.end - entry.start)}`);
    timeChip.classList.add('time-chip');
    block.append(labelChip(entry.label), timeChip);
    if (isSelected) block.append(el('span', 'resize-handle top'), el('span', 'resize-handle bottom'));
    if (entry.note) {
      block.append(noteMarker());
      block.title = entry.note;
    }
    for (let slot = start; slot < end; slot++) {
      const cell = accounting[slot];
      if (cell?.kind !== 'extra' || cell.counted) continue;
      const hatch = el('div', 'not-counted');
      hatch.style.top = `${(slot - start) * ROW_HEIGHT - 1}px`;
      hatch.style.height = `${ROW_HEIGHT}px`;
      hatch.title = 'Outside the Revit journals · not counted';
      block.append(hatch);
    }
    grid.append(block);
    blockElements.push({ element: block, startSlot: entry.start / SLOT_MINUTES, endSlot: entry.end / SLOT_MINUTES });
  }
  return { hiddenMinutes, blockElements };
}

// Draws the blocks imported from Revit journals (right lane), with their file
// activity strip when File activity is on. Excluded blocks are hatched grey.
// Returns the minutes outside the visible hours.
function drawJournalBlocks(grid, key, firstSlot, endSlot, slotTop, selectedEntry, colors) {
  let hiddenMinutes = 0;
  for (const entry of getJournalEntries(key)) {
    const start = Math.max(entry.start / SLOT_MINUTES, firstSlot);
    const end = Math.min(entry.end / SLOT_MINUTES, endSlot);
    hiddenMinutes += (entry.end - entry.start) - Math.max(0, end - start) * SLOT_MINUTES;
    if (end <= start) continue;

    const classes = ['time-block', 'journal-block'];
    if (selectedEntry && selectedEntry.start === entry.start) classes.push('selected');
    if (entry.excluded) classes.push('excluded');
    const block = el('div', classes.join(' '));
    block.style.top = `${slotTop(start) + 1}px`;
    block.style.height = `${(end - start) * ROW_HEIGHT - 1}px`;
    block.style.background = getLabelColor(entry.label);
    block.title = `From Revit journals${entry.excluded ? ' · excluded from totals' : ''}\n${entry.note ?? ''}`;
    block.append(labelChip(entry.label));
    if (entry.userNote) block.append(noteMarker());
    if (colors && entry.activity) {
      const blockTopMinute = start * SLOT_MINUTES;
      block.append(activityStrip(entry.activity, {
        visibleStart: start * SLOT_MINUTES,
        visibleEnd: end * SLOT_MINUTES,
        top: (minute) => ((minute - blockTopMinute) / SLOT_MINUTES) * ROW_HEIGHT,
        rowHeight: ROW_HEIGHT,
        rowMinutes: SLOT_MINUTES,
        colors,
        excludeNoFile: !countsNoFileTime(),
      }));
    }
    grid.append(block);
  }
  return hiddenMinutes;
}

// Dragging a block edge: blocks on both sides are resized on screen while
// dragging (with the new time shown); the change is saved on drop.
function createEdgeDrag({ grid, key, boundary, firstSlot, endSlot, slotTop, blockElements }) {
  const [min, max] = boundaryLimits(key, boundary);
  const above = blockElements.find((block) => block.endSlot === boundary);
  const below = blockElements.find((block) => block.startSlot === boundary);
  const timeTag = el('div', 'drag-time');
  grid.append(timeTag);
  let target = boundary;

  const place = (element, start, end) => {
    const visibleStart = Math.max(start, firstSlot);
    const visibleEnd = Math.min(end, endSlot);
    element.style.top = `${slotTop(visibleStart) + 1}px`;
    element.style.height = `${Math.max(0, (visibleEnd - visibleStart) * ROW_HEIGHT - 1)}px`;
  };

  return {
    moveTo(newBoundary) {
      target = Math.min(Math.max(newBoundary, min), max);
      if (above) place(above.element, above.startSlot, target);
      if (below) place(below.element, target, below.endSlot);
      timeTag.textContent = formatTime(target * SLOT_MINUTES);
      timeTag.style.top = `${slotTop(target)}px`;
    },
    drop() {
      timeTag.remove();
      if (target !== boundary) moveBoundary(key, boundary, target); // redraws the view
    },
  };
}

// Shift+drag inside a block moves the whole block (keeping its length) into
// empty time above or below; shown on screen while dragging, saved on drop.
function createBlockMove({ grid, key, slot, firstSlot, endSlot, slotTop, blockElements }) {
  const entry = findEntryAt(key, slot);
  const startSlot = entry.start / SLOT_MINUTES;
  const length = (entry.end - entry.start) / SLOT_MINUTES;
  const [minDelta, maxDelta] = blockMoveLimits(key, slot);
  const block = blockElements.find((candidate) => candidate.startSlot === startSlot);
  const timeTag = el('div', 'drag-time');
  grid.append(timeTag);
  block?.element.classList.add('moving');
  let delta = 0;

  return {
    moveBy(slots) {
      delta = Math.min(Math.max(slots, minDelta), maxDelta);
      const newStart = startSlot + delta;
      if (block) {
        const visibleStart = Math.max(newStart, firstSlot);
        const visibleEnd = Math.min(newStart + length, endSlot);
        block.element.style.top = `${slotTop(visibleStart) + 1}px`;
        block.element.style.height = `${Math.max(0, (visibleEnd - visibleStart) * ROW_HEIGHT - 1)}px`;
      }
      timeTag.textContent = `${formatTime(newStart * SLOT_MINUTES)}–${formatTime((newStart + length) * SLOT_MINUTES)}`;
      timeTag.style.top = `${slotTop(Math.max(newStart, firstSlot))}px`;
    },
    drop() {
      timeTag.remove();
      block?.element.classList.remove('moving');
      if (delta !== 0) moveBlock(key, slot, delta); // redraws the view
    },
  };
}

// Press on a slot, drag up or down, release: the slots in between are selected.
// A click without dragging on a labelled slot goes to clickedSlot instead.
// Pressing on a block edge (top or bottom) drags that edge instead, and
// Shift+pressing inside a block moves the whole block.
function setupSlotSelection(grid, {
  firstSlot, endSlot, showSelection, clickedSlot, selectionFinished, edgeAt, startEdgeDrag,
  blockAt, startBlockMove,
}) {
  let anchorSlot = null;
  let currentSlot = null;
  let dragged = false;
  let edgeDrag = null;
  let blockMove = null;

  const offsetYOf = (event) => event.clientY - grid.getBoundingClientRect().top;
  const offsetXOf = (event) => event.clientX - grid.getBoundingClientRect().left;
  let pressedX = 0;
  const slotAt = (event) => {
    const slot = firstSlot + Math.floor(offsetYOf(event) / ROW_HEIGHT);
    return Math.min(Math.max(slot, firstSlot), endSlot - 1);
  };
  const boundaryAt = (event) => firstSlot + Math.round(offsetYOf(event) / ROW_HEIGHT);
  const orderedRange = () => [Math.min(anchorSlot, currentSlot), Math.max(anchorSlot, currentSlot)];

  grid.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.label-popover')) return;
    document.activeElement?.blur(); // saves a note being edited…
    if (!grid.isConnected) return; // …which redraws the view, so this grid is gone
    grid.querySelector('.label-popover')?.closeLabelPopover();
    grid.setPointerCapture(event.pointerId);
    event.preventDefault();
    anchorSlot = currentSlot = slotAt(event);
    dragged = false;
    pressedX = offsetXOf(event);

    const edge = edgeAt(offsetYOf(event), pressedX);
    if (edge !== null) {
      edgeDrag = { boundary: edge, drag: null };
    } else if (event.shiftKey && blockAt(anchorSlot, pressedX)) {
      blockMove = { pressedSlot: anchorSlot, move: null };
    }
  });

  grid.addEventListener('pointermove', (event) => {
    if (anchorSlot === null) {
      if (edgeAt(offsetYOf(event), offsetXOf(event)) !== null) grid.style.cursor = 'ns-resize';
      else if (event.shiftKey && blockAt(slotAt(event), offsetXOf(event))) grid.style.cursor = 'move';
      else grid.style.cursor = '';
      return;
    }
    if (blockMove) {
      const delta = slotAt(event) - blockMove.pressedSlot;
      if (delta !== 0 && !blockMove.move) blockMove.move = startBlockMove(blockMove.pressedSlot);
      blockMove.move?.moveBy(delta);
      return;
    }
    if (edgeDrag) {
      const boundary = boundaryAt(event);
      if (boundary !== edgeDrag.boundary && !edgeDrag.drag) edgeDrag.drag = startEdgeDrag(edgeDrag.boundary);
      edgeDrag.drag?.moveTo(boundary);
      return;
    }
    const slot = slotAt(event);
    if (slot !== anchorSlot) dragged = true;
    currentSlot = slot;
    if (dragged) showSelection(...orderedRange());
  });

  grid.addEventListener('pointerup', () => {
    if (anchorSlot === null) return;
    const [first, last] = orderedRange();
    const finishedEdgeDrag = edgeDrag;
    const finishedBlockMove = blockMove;
    anchorSlot = currentSlot = null;
    edgeDrag = null;
    blockMove = null;

    if (finishedEdgeDrag?.drag) {
      finishedEdgeDrag.drag.drop();
      return;
    }
    if (finishedBlockMove?.move) {
      finishedBlockMove.move.drop();
      return;
    }
    // A press on an edge that didn't move counts as a plain click.
    if (!dragged && clickedSlot(first, pressedX)) return;
    selectionFinished(first, last);
  });
}
