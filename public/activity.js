// File activity inside a block: which files were worked in over time, drawn as
// a vertical histogram (time downwards, one stacked bar per row of time).
// Stored in fine steps (activity.binMinutes, 5 minutes); block strips show
// 15-minute rows, the note panel's expanded view shows the fine steps.
// Families (.rfa) are grouped into one band so the bars stay readable.
import { el } from './dom.js';
import { getAllActivity } from './store.js';

export const FAMILIES = 'Families (.rfa)';
const FAMILIES_COLOR = '#639922';
// Colours for files, given out in order of how much each file is used overall.
const FILE_PALETTE = [
  '#378ADD', '#EF9F27', '#D85A30', '#185FA5', '#888780', '#BA7517',
  '#0F6E56', '#E24B4A', '#85B7EB', '#5DCAA5', '#444441', '#F0997B',
];

const groupOf = (name) => (/\.rfa$/i.test(name) ? FAMILIES : name);

// Counts per group for each row of rowMinutes (a multiple of the stored step):
// [{ start, counts: Map(group -> count) }]
function groupedBins(activity, rowMinutes) {
  const step = activity.binMinutes ?? 15;
  const rowSize = Math.max(step, rowMinutes ?? step);
  const rows = new Map();
  activity.bins.forEach((counts, index) => {
    const minute = activity.start + index * step;
    const rowStart = minute - ((minute - activity.start) % rowSize);
    if (!rows.has(rowStart)) rows.set(rowStart, new Map());
    const grouped = rows.get(rowStart);
    counts.forEach((count, fileIndex) => {
      if (!count) return;
      const group = groupOf(activity.files[fileIndex]);
      grouped.set(group, (grouped.get(group) ?? 0) + count);
    });
  });
  return [...rows].map(([start, counts]) => ({ start, counts }));
}

// Total count per file (families grouped) over a whole activity: Map(group -> count)
export function fileCounts(activity) {
  const totals = new Map();
  for (const bin of groupedBins(activity)) {
    for (const [group, count] of bin.counts) totals.set(group, (totals.get(group) ?? 0) + count);
  }
  return totals;
}

// One colour per file (or the families group), the same in every block.
// Recomputed per drawing from all activity in the timesheet.
export function fileColors() {
  const totals = new Map();
  for (const activity of getAllActivity()) {
    for (const bin of groupedBins(activity)) {
      for (const [group, count] of bin.counts) totals.set(group, (totals.get(group) ?? 0) + count);
    }
  }
  const colors = new Map([[FAMILIES, FAMILIES_COLOR]]);
  [...totals].filter(([group]) => group !== FAMILIES).sort((a, b) => b[1] - a[1])
    .forEach(([group], index) => colors.set(group, FILE_PALETTE[index % FILE_PALETTE.length]));
  return colors;
}

// Share of each file over the part of the activity between start and end
// (minutes of day), largest first: [{ name, share }]
export function activityShares(activity, start, end) {
  const totals = new Map();
  let all = 0;
  for (const bin of groupedBins(activity)) {
    if (bin.start < start || bin.start >= end) continue;
    for (const [group, count] of bin.counts) {
      totals.set(group, (totals.get(group) ?? 0) + count);
      all += count;
    }
  }
  return [...totals].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, share: count / all }));
}

// The histogram for a block. top(minute) gives a minute's position in pixels;
// only rows between visibleStart and visibleEnd are drawn. rowMinutes: 15 for the
// strips in the calendar, the stored step (5) for the fine view.
// A row in which no file was named ("no file loaded") is white with a black
// outline; when that time isn't counted (excludeNoFile), it is also hatched.
export function activityStrip(activity, {
  visibleStart, visibleEnd, top, rowHeight, rowMinutes, colors, className = 'activity-strip', excludeNoFile = false,
}) {
  const strip = el('div', className);
  const rows = new Map(groupedBins(activity, rowMinutes).map((bin) => [bin.start, bin.counts]));
  const rowSize = Math.max(activity.binMinutes ?? 15, rowMinutes ?? 15);
  for (let rowStart = visibleStart; rowStart < visibleEnd; rowStart += rowSize) {
    const counts = rows.get(rowStart) ?? new Map();
    const row = el('div', 'activity-row');
    row.style.top = `${top(rowStart)}px`;
    row.style.height = `${rowHeight - 1}px`;
    if (counts.size === 0) {
      row.classList.add('empty');
      if (excludeNoFile && noFileInQuarter(rows, rowStart, rowSize)) row.classList.add('excluded');
      row.title = excludeNoFile ? 'No file loaded · not counted' : 'No file loaded';
      strip.append(row);
      continue;
    }
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    for (const [group, count] of [...counts].sort((a, b) => b[1] - a[1])) {
      const band = el('div');
      band.style.width = `${(count / total) * 100}%`;
      band.style.background = colors.get(group) ?? '#888780';
      band.title = `${group} · ${Math.round((count / total) * 100)}%`;
      row.append(band);
    }
    strip.append(row);
  }
  return strip;
}

// Whether the whole quarter-hour around a row had no file named (only whole
// empty quarter-hours are left out of totals).
function noFileInQuarter(rows, rowStart, rowSize) {
  const quarterStart = rowStart - (rowStart % 15);
  for (let minute = quarterStart; minute < quarterStart + 15; minute += rowSize) {
    if ((rows.get(minute)?.size ?? 0) > 0) return false;
  }
  return true;
}

// Legend: file colour, name and share of the block, then the time with no
// file loaded (noFileMinutes), if any.
export function activityLegend(activity, start, end, colors, noFileMinutes = 0, excludeNoFile = false) {
  const legend = el('div', 'activity-legend');
  for (const { name, share } of activityShares(activity, start, end)) {
    const row = el('div', 'activity-legend-row');
    const swatch = el('span', 'activity-swatch');
    swatch.style.background = colors.get(name) ?? '#888780';
    const percent = share < 0.005 ? '<1%' : `${Math.round(share * 100)}%`;
    row.append(swatch, el('span', 'activity-name', name), el('span', 'activity-share', percent));
    legend.append(row);
  }
  if (noFileMinutes) {
    const row = el('div', 'activity-legend-row');
    const swatch = el('span', `activity-swatch no-file${excludeNoFile ? ' excluded' : ''}`);
    const time = `${noFileMinutes} min${excludeNoFile ? ' · not counted' : ''}`;
    row.append(swatch, el('span', 'activity-name', 'No file loaded'), el('span', 'activity-share', time));
    legend.append(row);
  }
  return legend;
}
