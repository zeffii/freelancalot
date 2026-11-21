// Day view: 15-minute rows you drag across to select, then label.
import { el, labelChip } from './dom.js';
import { dateKey, formatTime, formatDuration, formatLongDate } from './dates.js';
import { SLOT_MINUTES, SLOTS_PER_DAY, getEntries, getLabelColor } from './store.js';
import { openLabelPopover } from './labelPopover.js';
import { renderSummary } from './summary.js';

const ROW_HEIGHT = 13;          // pixels per 15-minute slot
const DEFAULT_FIRST_HOUR = 7;
const DEFAULT_LAST_HOUR = 23;
const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;

export function renderDayView(container, date, { fullDay }) {
  const key = dateKey(date);
  const firstSlot = fullDay ? 0 : DEFAULT_FIRST_HOUR * SLOTS_PER_HOUR;
  const endSlot = fullDay ? SLOTS_PER_DAY : DEFAULT_LAST_HOUR * SLOTS_PER_HOUR;
  const slotTop = (slot) => (slot - firstSlot) * ROW_HEIGHT;
  const gridHeight = `${(endSlot - firstSlot) * ROW_HEIGHT}px`;

  const layout = el('div', 'day-layout');
  const gutter = el('div', 'day-gutter');
  const grid = el('div', 'day-grid');
  gutter.style.height = gridHeight;
  grid.style.height = gridHeight;

  drawRowsAndTimes(grid, gutter, firstSlot, endSlot, slotTop);
  const hiddenMinutes = drawBlocks(grid, key, firstSlot, endSlot, slotTop);

  const selectionBox = el('div', 'selection-box');
  grid.append(selectionBox);

  setupSlotSelection(grid, {
    firstSlot,
    endSlot,
    showSelection(first, last) {
      selectionBox.style.display = 'block';
      selectionBox.style.top = `${slotTop(first)}px`;
      selectionBox.style.height = `${(last - first + 1) * ROW_HEIGHT}px`;
    },
    hideSelection() {
      selectionBox.style.display = 'none';
    },
    selectionFinished(first, last, hideSelection) {
      openLabelPopover({ parent: grid, top: slotTop(first), key, firstSlot: first, lastSlot: last, onClose: hideSelection });
    },
  });

  layout.append(gutter, grid);
  container.append(layout);

  if (hiddenMinutes > 0) {
    const note = `${formatDuration(hiddenMinutes)} logged outside ${formatTime(firstSlot * SLOT_MINUTES)}–${formatTime(endSlot * SLOT_MINUTES)}. Tick "Show 24 h" to see it.`;
    container.append(el('p', 'muted hidden-note', note));
  }
  container.append(renderSummary([key], `Hours on ${formatLongDate(date)}`));
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
function drawBlocks(grid, key, firstSlot, endSlot, slotTop) {
  let hiddenMinutes = 0;
  for (const entry of getEntries(key)) {
    const start = Math.max(entry.start / SLOT_MINUTES, firstSlot);
    const end = Math.min(entry.end / SLOT_MINUTES, endSlot);
    hiddenMinutes += (entry.end - entry.start) - Math.max(0, end - start) * SLOT_MINUTES;
    if (end <= start) continue;

    const block = el('div', 'time-block');
    block.style.top = `${slotTop(start) + 1}px`;
    block.style.height = `${(end - start) * ROW_HEIGHT - 1}px`;
    block.style.background = getLabelColor(entry.label);

    const timeChip = labelChip(`${formatTime(entry.start)}–${formatTime(entry.end)} · ${formatDuration(entry.end - entry.start)}`);
    timeChip.classList.add('time-chip');
    block.append(labelChip(entry.label), timeChip);
    grid.append(block);
  }
  return hiddenMinutes;
}

// Press on a slot, drag up or down, release: the slots in between are selected.
function setupSlotSelection(grid, { firstSlot, endSlot, showSelection, hideSelection, selectionFinished }) {
  let anchorSlot = null;
  let currentSlot = null;

  const slotAt = (event) => {
    const offsetY = event.clientY - grid.getBoundingClientRect().top;
    const slot = firstSlot + Math.floor(offsetY / ROW_HEIGHT);
    return Math.min(Math.max(slot, firstSlot), endSlot - 1);
  };
  const orderedRange = () => [Math.min(anchorSlot, currentSlot), Math.max(anchorSlot, currentSlot)];

  grid.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.label-popover')) return;
    grid.querySelector('.label-popover')?.closeLabelPopover();
    anchorSlot = currentSlot = slotAt(event);
    grid.setPointerCapture(event.pointerId);
    showSelection(...orderedRange());
    event.preventDefault();
  });

  grid.addEventListener('pointermove', (event) => {
    if (anchorSlot === null) return;
    currentSlot = slotAt(event);
    showSelection(...orderedRange());
  });

  grid.addEventListener('pointerup', () => {
    if (anchorSlot === null) return;
    const [first, last] = orderedRange();
    anchorSlot = currentSlot = null;
    selectionFinished(first, last, hideSelection);
  });
}
