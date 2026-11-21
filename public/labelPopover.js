// The box that opens after selecting slots: type a label (existing labels
// are suggested as you type), pick one, or clear the slots.
//
// Keys: ↑/↓ move through suggestions, Tab fills in the highlighted one,
// Enter assigns it, Escape cancels.
import { el, labelChip } from './dom.js';
import { formatTime, formatDuration } from './dates.js';
import {
  SLOT_MINUTES, assignSlots, getSlotLabels, suggestLabels, labelExists, getLabelColor,
} from './store.js';

const MAX_SUGGESTIONS = 8;
const POPOVER_HEIGHT_ESTIMATE = 330;

export function openLabelPopover({ parent, top, key, firstSlot, lastSlot, onClose }) {
  const popover = el('div', 'label-popover');
  const maxTop = Math.max(0, parent.clientHeight - POPOVER_HEIGHT_ESTIMATE);
  popover.style.top = `${Math.min(top, maxTop)}px`;

  const startMinutes = firstSlot * SLOT_MINUTES;
  const endMinutes = (lastSlot + 1) * SLOT_MINUTES;
  const rangeText = `${formatTime(startMinutes)}–${formatTime(endMinutes)} · ${formatDuration(endMinutes - startMinutes)}`;

  const input = el('input', 'popover-input');
  input.placeholder = 'Project label';
  input.value = commonLabel(key, firstSlot, lastSlot) ?? '';

  const suggestionList = el('div', 'suggestions');
  const assignButton = el('button', 'primary', 'Assign');
  const clearButton = el('button', '', 'Clear slots');
  const cancelButton = el('button', '', 'Cancel');
  const actions = el('div', 'popover-actions');
  actions.append(assignButton, clearButton, cancelButton);

  popover.append(el('div', 'popover-range', rangeText), input, suggestionList, actions);
  parent.append(popover);

  let options = [];
  let highlighted = 0;

  function refreshOptions() {
    const text = input.value.trim();
    let names = suggestLabels(text);
    if (labelExists(text)) names = [text, ...names.filter((name) => name !== text)];
    options = names.slice(0, MAX_SUGGESTIONS).map((name) => ({ name, isNew: false }));
    if (text && !labelExists(text)) options.push({ name: text, isNew: true });
    highlighted = 0;
    drawOptions();
  }

  function drawOptions() {
    suggestionList.replaceChildren();
    options.forEach((option, index) => {
      const item = el('div', index === highlighted ? 'suggestion active' : 'suggestion');
      const swatch = el('span', option.isNew ? 'suggestion-swatch new' : 'suggestion-swatch');
      if (!option.isNew) swatch.style.background = getLabelColor(option.name);
      item.append(swatch, option.isNew ? el('span', '', `Create "${option.name}"`) : labelChip(option.name));
      item.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        assign(option.name);
      });
      item.addEventListener('mouseenter', () => {
        highlighted = index;
        drawOptions();
      });
      suggestionList.append(item);
    });
  }

  function assign(label) {
    if (!label) {
      input.focus();
      return;
    }
    close();
    assignSlots(key, firstSlot, lastSlot, label);
  }

  function close() {
    document.removeEventListener('pointerdown', closeIfOutside, true);
    popover.remove();
    onClose();
  }

  function closeIfOutside(event) {
    if (!popover.contains(event.target)) close();
  }

  input.addEventListener('input', refreshOptions);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && options.length) {
      highlighted = (highlighted + 1) % options.length;
      drawOptions();
    } else if (event.key === 'ArrowUp' && options.length) {
      highlighted = (highlighted - 1 + options.length) % options.length;
      drawOptions();
    } else if (event.key === 'Tab' && options[highlighted] && !options[highlighted].isNew) {
      input.value = options[highlighted].name;
      refreshOptions();
    } else if (event.key === 'Enter') {
      assign(options[highlighted]?.name ?? input.value.trim());
    } else if (event.key === 'Escape') {
      close();
    } else {
      return;
    }
    event.preventDefault();
  });

  assignButton.addEventListener('click', () => assign(input.value.trim()));
  clearButton.addEventListener('click', () => {
    close();
    assignSlots(key, firstSlot, lastSlot, null);
  });
  cancelButton.addEventListener('click', close);

  // Lets the day view close an open popover when a new selection starts.
  popover.closeLabelPopover = close;
  document.addEventListener('pointerdown', closeIfOutside, true);

  refreshOptions();
  input.focus();
  input.select();
}

// If every selected slot already has the same label, return it (to prefill the input).
function commonLabel(key, firstSlot, lastSlot) {
  const labels = getSlotLabels(key).slice(firstSlot, lastSlot + 1);
  return labels.every((label) => label && label === labels[0]) ? labels[0] : null;
}
