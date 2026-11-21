// What counts as worked time, per 15-minute slot, from the two layers:
// journal blocks (imported evidence) and manual blocks (logged by you).
//
// For each quarter-hour of a day:
// - Covered by a journal block (not excluded, and not a no-file quarter-hour
//   while no-file time isn't counted): it counts, once, as "journal" time.
//   Its label is the manual block's label if one covers it (your label wins),
//   otherwise the journal block's.
// - Otherwise covered by a manual block: it is "extra" time (not in the
//   journals). It counts unless that block's countExtra is switched off.
// - Otherwise: nothing.
// Where the layers overlap, time is never counted twice.
import {
  SLOT_MINUTES, SLOTS_PER_DAY, getEntries, getJournalEntries, noFileSlots, countsNoFileTime,
} from './store.js';

// [{ label, kind: 'journal' | 'extra', counted, manual, journal } | null] per slot
export function daySlots(key) {
  const slots = new Array(SLOTS_PER_DAY).fill(null);
  const manualAt = new Array(SLOTS_PER_DAY).fill(null);
  for (const entry of getEntries(key)) {
    for (let slot = entry.start / SLOT_MINUTES; slot < entry.end / SLOT_MINUTES; slot++) manualAt[slot] = entry;
  }
  const evidenceAt = new Array(SLOTS_PER_DAY).fill(null);
  const journalAt = new Array(SLOTS_PER_DAY).fill(null);
  for (const entry of getJournalEntries(key)) {
    const noFile = countsNoFileTime() ? new Set() : new Set(noFileSlots(entry));
    for (let minute = entry.start; minute < entry.end; minute += SLOT_MINUTES) {
      const slot = minute / SLOT_MINUTES;
      journalAt[slot] = entry;
      if (!entry.excluded && !noFile.has(minute)) evidenceAt[slot] = entry;
    }
  }
  for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
    const manual = manualAt[slot];
    const evidence = evidenceAt[slot];
    if (evidence) {
      slots[slot] = { label: manual?.label ?? evidence.label, kind: 'journal', counted: true, manual, journal: evidence };
    } else if (manual) {
      slots[slot] = { label: manual.label, kind: 'extra', counted: manual.countExtra !== false, manual, journal: journalAt[slot] };
    }
  }
  return slots;
}

// Counted minutes per label over some days, largest first. With labels given,
// only those labels.
export function minutesByLabel(keys, labels = null) {
  const totals = new Map();
  for (const key of keys) {
    for (const slot of daySlots(key)) {
      if (!slot?.counted || (labels && !labels.includes(slot.label))) continue;
      totals.set(slot.label, (totals.get(slot.label) ?? 0) + SLOT_MINUTES);
    }
  }
  return new Map([...totals].sort((a, b) => b[1] - a[1]));
}

export function minutesOnDay(key, labels = null) {
  return [...minutesByLabel([key], labels).values()].reduce((sum, minutes) => sum + minutes, 0);
}

// Extra time (manual, not in the journals) over some days:
// { counted, notCounted } in minutes.
export function extraMinutes(keys, labels = null) {
  const result = { counted: 0, notCounted: 0 };
  for (const key of keys) {
    for (const slot of daySlots(key)) {
      if (slot?.kind !== 'extra' || (labels && !labels.includes(slot.label))) continue;
      if (slot.counted) result.counted += SLOT_MINUTES;
      else result.notCounted += SLOT_MINUTES;
    }
  }
  return result;
}

// One block's share: how much of it counts, and (for a manual block) how much
// of it is extra time outside the journals.
export function blockAccounting(key, entry) {
  const slots = daySlots(key);
  const result = { counted: 0, extra: 0, extraCounted: 0 };
  for (let minute = entry.start; minute < entry.end; minute += SLOT_MINUTES) {
    const slot = slots[minute / SLOT_MINUTES];
    if (!slot) continue;
    const asManual = slot.manual === entry;
    const asJournal = slot.kind === 'journal' && slot.journal === entry;
    if (slot.counted && (asManual || asJournal)) result.counted += SLOT_MINUTES;
    if (slot.kind === 'extra' && asManual) {
      result.extra += SLOT_MINUTES;
      if (slot.counted) result.extraCounted += SLOT_MINUTES;
    }
  }
  return result;
}

// Runs of counted time for one label on a day, for the report:
// [{ start, end, kinds: Set, notes: [text] }]
export function countedRuns(key, label) {
  const slots = daySlots(key);
  const runs = [];
  let run = null;
  for (let slot = 0; slot <= SLOTS_PER_DAY; slot++) {
    const here = slots[slot];
    const inRun = here?.counted && here.label === label;
    if (inRun && run) {
      run.end = (slot + 1) * SLOT_MINUTES;
      run.cells.push(here);
    } else if (inRun) {
      run = { start: slot * SLOT_MINUTES, end: (slot + 1) * SLOT_MINUTES, cells: [here] };
      runs.push(run);
    } else {
      run = null;
    }
  }
  return runs.map(({ start, end, cells }) => {
    const notes = [];
    for (const cell of cells) {
      for (const text of [cell.manual?.note, cell.journal?.userNote, cell.journal?.note]) {
        if (text && !notes.includes(text)) notes.push(text);
      }
    }
    return { start, end, kinds: new Set(cells.map((cell) => cell.kind)), notes };
  });
}
