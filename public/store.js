// All timesheet data, and the only code that changes it.
//
// Shape of timesheet.json:
// {
//   "labels": { "Kelly – Revit families": { "color": "#1D9E75", "lastUsed": 1763700000000 } },
//   "days":   { "2026-11-21": [ { "start": 540, "end": 690, "label": "Kelly – Revit families" } ] }
// }
// start/end are minutes from midnight, always on 15-minute boundaries.

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

// One label (or null) per 15-minute slot of the day.
export function getSlotLabels(key) {
  const slots = new Array(SLOTS_PER_DAY).fill(null);
  for (const entry of getEntries(key)) {
    for (let slot = entry.start / SLOT_MINUTES; slot < entry.end / SLOT_MINUTES; slot++) {
      slots[slot] = entry.label;
    }
  }
  return slots;
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
export function assignSlots(key, firstSlot, lastSlot, label) {
  const slots = getSlotLabels(key);
  for (let slot = firstSlot; slot <= lastSlot; slot++) slots[slot] = label;

  const entries = slotsToEntries(slots);
  if (entries.length) data.days[key] = entries;
  else delete data.days[key];

  if (label) markLabelUsed(label);
  dataChanged();
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
    const slots = getSlotLabels(key).map((label) => (label === oldName ? newName : label));
    data.days[key] = slotsToEntries(slots); // re-joins blocks that now touch
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

// Collapse runs of equal slots into { start, end, label } entries.
function slotsToEntries(slots) {
  const entries = [];
  let runStart = 0;
  while (runStart < slots.length) {
    const label = slots[runStart];
    let runEnd = runStart;
    while (runEnd < slots.length && slots[runEnd] === label) runEnd++;
    if (label) entries.push({ start: runStart * SLOT_MINUTES, end: runEnd * SLOT_MINUTES, label });
    runStart = runEnd;
  }
  return entries;
}
