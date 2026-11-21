// All timesheet data, and the only code that changes it.
//
// Shape of timesheet.json:
// {
//   "labels": { "Kelly – Revit families": { "color": "#1D9E75", "lastUsed": 1763700000000 } },
//   "days":   { "2026-11-21": [ { "start": 540, "end": 690, "label": "Kelly – Revit families", "note": "…" } ] }
// }
// start/end are minutes from midnight, always on 15-minute boundaries.
// An entry may also have a "note" (free text, may contain links). Notes belong
// to one block of time, so blocks with the same label can have different notes.

export const SLOT_MINUTES = 15;
export const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES;

// Colours handed out to new labels in order (changeable later from the summary).
const LABEL_PALETTE = [
  '#1D9E75', '#378ADD', '#EF9F27', '#D85A30', '#639922', '#5DCAA5',
  '#185FA5', '#BA7517', '#E24B4A', '#0F6E56', '#85B7EB', '#888780',
];
const FALLBACK_COLOR = '#888780';
const SAVE_DELAY_MS = 400;

// Where data is kept: 'server' writes timesheet.json through server.js;
// 'browser' is the fallback when no server answers (e.g. the GitHub Pages copy)
// and keeps the data in this browser's localStorage.
const BROWSER_STORAGE_KEY = 'freelancalot.data';
const API_URL = 'api/data'; // relative, so it also resolves under a sub-path

let data = { labels: {}, days: {} };
let storageMode = 'server';
let saveTimer = null;
let statusListener = () => {};
let changeListener = () => {};

// ---------- loading and saving ----------

export async function loadData() {
  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error(`No server (${response.status})`);
    setData(await response.json());
  } catch {
    storageMode = 'browser';
    const stored = localStorage.getItem(BROWSER_STORAGE_KEY);
    setData(stored ? JSON.parse(stored) : {});
  }
}

export function getStorageMode() { return storageMode; }
export function onSaveStatus(listener) { statusListener = listener; }
export function onChange(listener) { changeListener = listener; }

function setData(loaded) {
  data = { labels: loaded.labels ?? {}, days: loaded.days ?? {} };
}

function dataChanged() {
  changeListener();
  statusListener('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

async function saveNow() {
  try {
    if (storageMode === 'browser') {
      localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(data));
    } else {
      const response = await fetch(API_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error(`Save failed (${response.status})`);
    }
    statusListener('saved');
  } catch (error) {
    console.error(error);
    statusListener('error');
  }
}

// ---------- export and import (a timesheet.json file) ----------

export function exportJson() {
  return JSON.stringify(data, null, 2);
}

// Replaces all current data with the file's contents.
export function importJson(text) {
  const loaded = JSON.parse(text);
  if (typeof loaded?.labels !== 'object' || typeof loaded?.days !== 'object') {
    throw new Error('Not a timesheet file: expected { labels, days }');
  }
  setData(loaded);
  dataChanged();
}

// ---------- reading ----------

export function getEntries(key) {
  return data.days[key] ?? [];
}

export function getLabelColor(name) {
  return data.labels[name]?.color ?? FALLBACK_COLOR;
}

// One { label, note } (or null) per 15-minute slot of the day.
function getSlots(key) {
  const slots = new Array(SLOTS_PER_DAY).fill(null);
  for (const entry of getEntries(key)) {
    for (let slot = entry.start / SLOT_MINUTES; slot < entry.end / SLOT_MINUTES; slot++) {
      slots[slot] = { label: entry.label, note: entry.note ?? '' };
    }
  }
  return slots;
}

// One label (or null) per 15-minute slot of the day.
export function getSlotLabels(key) {
  return getSlots(key).map((slot) => slot?.label ?? null);
}

// The block (entry) covering a slot, or null.
export function findEntryAt(key, slot) {
  const minute = slot * SLOT_MINUTES;
  return getEntries(key).find((entry) => entry.start <= minute && minute < entry.end) ?? null;
}

export function minutesOnDay(key) {
  return getEntries(key).reduce((sum, entry) => sum + entry.end - entry.start, 0);
}

// Map of label -> minutes across the given days, largest first.
export function minutesByLabel(keys) {
  const totals = new Map();
  for (const key of keys) {
    for (const entry of getEntries(key)) {
      totals.set(entry.label, (totals.get(entry.label) ?? 0) + entry.end - entry.start);
    }
  }
  return new Map([...totals].sort((a, b) => b[1] - a[1]));
}

// Existing labels matching the typed text: names starting with it first,
// then names containing it; most recently used first within each group.
export function suggestLabels(text) {
  const query = text.trim().toLowerCase();
  const byRecency = (a, b) => (b[1].lastUsed ?? 0) - (a[1].lastUsed ?? 0);
  const entries = Object.entries(data.labels).sort(byRecency);
  const startsWith = entries.filter(([name]) => name.toLowerCase().startsWith(query));
  const contains = entries.filter(([name]) => !name.toLowerCase().startsWith(query) && name.toLowerCase().includes(query));
  return [...startsWith, ...contains].map(([name]) => name);
}

export function labelExists(name) {
  return Object.prototype.hasOwnProperty.call(data.labels, name);
}

// ---------- changing ----------

// Give slots firstSlot..lastSlot (inclusive) a label, or clear them with label = null.
// Slots that already had this label keep their note; newly labelled slots take
// the note of a same-label block they touch, so extending a block keeps its note.
export function assignSlots(key, firstSlot, lastSlot, label) {
  const slots = getSlots(key);
  const note = label ? noteToInherit(slots, firstSlot, lastSlot, label) : '';
  for (let slot = firstSlot; slot <= lastSlot; slot++) {
    if (!label) slots[slot] = null;
    else if (slots[slot]?.label !== label) slots[slot] = { label, note };
  }
  storeSlots(key, slots);
  if (label) markLabelUsed(label);
  dataChanged();
}

export function setNote(key, slot, note) {
  const slots = getSlots(key);
  const [first, last] = blockRange(slots, slot);
  if (first === null) return;
  for (let s = first; s <= last; s++) slots[s] = { label: slots[s].label, note: note.trim() };
  storeSlots(key, slots);
  dataChanged();
}

export function deleteBlock(key, slot) {
  const slots = getSlots(key);
  const [first, last] = blockRange(slots, slot);
  if (first === null) return;
  for (let s = first; s <= last; s++) slots[s] = null;
  storeSlots(key, slots);
  dataChanged();
}

// Boundary b is where slot b-1 meets slot b (0..SLOTS_PER_DAY).
// It is a block edge when the slots on either side differ.
export function isBlockEdge(key, boundary) {
  const slots = getSlots(key);
  return !sameSlot(slots[boundary - 1], slots[boundary]);
}

// How far a block edge may move: until the block on either side would vanish
// (each keeps at least one slot); empty time on either side may be used up.
export function boundaryLimits(key, boundary) {
  return limitsOfBoundary(getSlots(key), boundary);
}

// Drag a block edge to newBoundary: the side it moves into takes over those slots.
export function moveBoundary(key, boundary, newBoundary) {
  const slots = getSlots(key);
  const [min, max] = limitsOfBoundary(slots, boundary);
  const target = Math.min(Math.max(newBoundary, min), max);
  if (target === boundary) return;
  if (target > boundary) {
    for (let slot = boundary; slot < target; slot++) slots[slot] = slots[boundary - 1];
  } else {
    for (let slot = target; slot < boundary; slot++) slots[slot] = slots[boundary];
  }
  storeSlots(key, slots);
  dataChanged();
}

function limitsOfBoundary(slots, boundary) {
  const left = slots[boundary - 1] ?? null;
  const right = slots[boundary] ?? null;
  let leftRunStart = boundary;
  while (leftRunStart > 0 && sameSlot(slots[leftRunStart - 1], left)) leftRunStart--;
  let rightRunEnd = boundary;
  while (rightRunEnd < slots.length && sameSlot(slots[rightRunEnd], right)) rightRunEnd++;
  return [left ? leftRunStart + 1 : leftRunStart, right ? rightRunEnd - 1 : rightRunEnd];
}

// Two slots are the same when both are empty, or both have the same label and note.
function sameSlot(a, b) {
  const first = a ?? null;
  const second = b ?? null;
  if (first === null || second === null) return first === second;
  return first.label === second.label && first.note === second.note;
}

function noteToInherit(slots, firstSlot, lastSlot, label) {
  const candidates = [firstSlot - 1, lastSlot + 1];
  for (let slot = firstSlot; slot <= lastSlot; slot++) candidates.push(slot);
  const match = candidates.find((slot) => slots[slot]?.label === label);
  return match === undefined ? '' : slots[match].note;
}

// First and last slot of the block (same label and note) around a slot.
function blockRange(slots, slot) {
  if (!slots[slot]) return [null, null];
  const same = (s) => slots[s] && slots[s].label === slots[slot].label && slots[s].note === slots[slot].note;
  let first = slot;
  let last = slot;
  while (first > 0 && same(first - 1)) first--;
  while (last < slots.length - 1 && same(last + 1)) last++;
  return [first, last];
}

function storeSlots(key, slots) {
  const entries = slotsToEntries(slots);
  if (entries.length) data.days[key] = entries;
  else delete data.days[key];
}

export function setLabelColor(name, color) {
  if (!data.labels[name]) return;
  data.labels[name].color = color;
  dataChanged();
}

// Rename a label everywhere. Renaming to a name that already exists merges
// the two: all time moves to the existing label, which keeps its colour.
export function renameLabel(oldName, newName) {
  if (!labelExists(oldName) || !newName || oldName === newName) return;

  if (labelExists(newName)) {
    data.labels[newName].lastUsed = Math.max(data.labels[newName].lastUsed ?? 0, data.labels[oldName].lastUsed ?? 0);
  } else {
    data.labels[newName] = data.labels[oldName];
  }
  delete data.labels[oldName];

  for (const key of Object.keys(data.days)) {
    const slots = getSlots(key).map((slot) => (slot?.label === oldName ? { ...slot, label: newName } : slot));
    storeSlots(key, slots); // re-joins blocks that now touch (if their notes match)
  }
  dataChanged();
}

function markLabelUsed(name) {
  if (!data.labels[name]) data.labels[name] = { color: pickNewLabelColor() };
  data.labels[name].lastUsed = Date.now();
}

function pickNewLabelColor() {
  const usedColors = new Set(Object.values(data.labels).map((label) => label.color));
  const unused = LABEL_PALETTE.find((color) => !usedColors.has(color));
  return unused ?? LABEL_PALETTE[Object.keys(data.labels).length % LABEL_PALETTE.length];
}

// Collapse runs of equal slots (same label and note) into entries.
function slotsToEntries(slots) {
  const entries = [];
  let runStart = 0;
  while (runStart < slots.length) {
    const slot = slots[runStart];
    let runEnd = runStart;
    while (runEnd < slots.length && sameSlot(slots[runEnd], slot)) runEnd++;
    if (slot) {
      const entry = { start: runStart * SLOT_MINUTES, end: runEnd * SLOT_MINUTES, label: slot.label };
      if (slot.note) entry.note = slot.note;
      entries.push(entry);
    }
    runStart = runEnd;
  }
  return entries;
}
