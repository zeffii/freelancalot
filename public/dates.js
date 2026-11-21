// Date helpers. Days are keyed by local date ("2026-11-21"), never UTC,
// so an evening entry can't slip onto the next day.

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const pad2 = (n) => String(n).padStart(2, '0');

export function dateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function addMonths(date, months) {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const day = Math.min(date.getDate(), daysInMonth(target.getFullYear(), target.getMonth()));
  return new Date(target.getFullYear(), target.getMonth(), day);
}

export function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

// Monday = 0 … Sunday = 6
export function weekdayIndex(date) {
  return (date.getDay() + 6) % 7;
}

export function startOfWeek(date) {
  return addDays(date, -weekdayIndex(date));
}

export function isSameDay(a, b) {
  return dateKey(a) === dateKey(b);
}

export function today() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function formatTime(minutes) {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

export function formatDuration(minutes) {
  return `${Math.floor(minutes / 60)}h ${pad2(minutes % 60)}m`;
}

// Compact form for small spaces: "4h", "6h 45m", "30m"
export function formatHoursShort(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function formatLongDate(date) {
  const weekday = WEEKDAY_NAMES[weekdayIndex(date)];
  return `${weekday} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}
