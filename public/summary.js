// The per-label hours list shown under every view.
// Click a colour square to change the colour, click a label name to rename it.
import { el, labelChip } from './dom.js';
import { formatDuration } from './dates.js';
import { getLabelColor, setLabelColor, renameLabel, labelExists } from './store.js';
import { minutesByLabel, extraMinutes } from './accounting.js';

export function renderSummary(keys, heading) {
  const totals = minutesByLabel(keys);
  const section = el('section', 'summary');
  section.append(el('h2', '', heading));

  if (totals.size === 0) {
    section.append(el('p', 'muted', 'No time logged.'));
    return section;
  }

  let grandTotal = 0;
  for (const [label, minutes] of totals) {
    grandTotal += minutes;
    const row = el('div', 'summary-row');

    const swatch = el('input', 'swatch');
    swatch.type = 'color';
    swatch.value = getLabelColor(label);
    swatch.title = 'Change colour';
    swatch.addEventListener('change', () => setLabelColor(label, swatch.value));

    const chip = labelChip(label);
    chip.classList.add('renamable');
    chip.title = 'Rename';
    chip.addEventListener('click', () => startRename(chip, label));

    const name = el('span', 'summary-name');
    name.append(swatch, chip);
    row.append(name, el('span', 'summary-time', formatDuration(minutes)));
    section.append(row);
  }

  const totalRow = el('div', 'summary-row summary-total');
  totalRow.append(el('span', '', 'Total'), el('span', 'summary-time', formatDuration(grandTotal)));
  section.append(totalRow);

  // Time you logged yourself that the Revit journals don't cover.
  const extra = extraMinutes(keys);
  if (extra.counted || extra.notCounted) {
    const parts = [];
    if (extra.counted) parts.push(`${formatDuration(extra.counted)} counted`);
    if (extra.notCounted) parts.push(`${formatDuration(extra.notCounted)} not counted`);
    section.append(el('p', 'muted summary-extra', `Outside the Revit journals: ${parts.join(', ')}`));
  }
  return section;
}

// Swap the chip for a text box. Enter or clicking away saves, Escape cancels.
function startRename(chip, oldName) {
  const input = el('input', 'rename-input');
  input.value = oldName;
  chip.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    const newName = input.value.trim();
    const shouldSave = save && newName && newName !== oldName
      && (!labelExists(newName) || confirm(`"${newName}" already exists. Merge "${oldName}" into it?`));
    if (shouldSave) renameLabel(oldName, newName); // redraws the view
    else input.replaceWith(chip);
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}
