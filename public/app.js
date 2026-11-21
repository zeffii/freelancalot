// App shell: toolbar, navigation and switching between views.
import {
  MONTH_NAMES, addDays, addMonths, startOfWeek, today, formatLongDate,
} from './dates.js';
import {
  loadData, onChange, onSaveStatus, getStorageMode, exportJson, importJson,
} from './store.js';
import { renderDayView } from './dayView.js';
import { renderWeekView, renderMonthView, renderYearView } from './calendarViews.js';

const FULL_DAY_SETTING = 'timesheet.fullDay';

const state = {
  view: 'day',
  date: today(),
  fullDay: localStorage.getItem(FULL_DAY_SETTING) === 'true',
};

const viewContainer = document.getElementById('view');
const titleElement = document.getElementById('title');
const fullDayToggle = document.getElementById('fullDayToggle');
const fullDayCheckbox = document.getElementById('fullDayCheckbox');
const saveStatus = document.getElementById('saveStatus');

function openDay(date) {
  state.view = 'day';
  state.date = date;
  render();
}

function openMonth(date) {
  state.view = 'month';
  state.date = date;
  render();
}

function viewTitle() {
  const { date } = state;
  switch (state.view) {
    case 'day': return formatLongDate(date);
    case 'week': {
      const monday = startOfWeek(date);
      const sunday = addDays(monday, 6);
      return `${monday.getDate()} ${MONTH_NAMES[monday.getMonth()]} – ${sunday.getDate()} ${MONTH_NAMES[sunday.getMonth()]} ${sunday.getFullYear()}`;
    }
    case 'month': return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
    default: return String(date.getFullYear());
  }
}

function step(direction) {
  const { date } = state;
  switch (state.view) {
    case 'day': state.date = addDays(date, direction); break;
    case 'week': state.date = addDays(date, 7 * direction); break;
    case 'month': state.date = addMonths(date, direction); break;
    default: state.date = addMonths(date, 12 * direction);
  }
  render();
}

function render() {
  const scrollY = window.scrollY;
  viewContainer.replaceChildren();
  titleElement.textContent = viewTitle();
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === state.view);
  });
  fullDayToggle.style.visibility = state.view === 'day' || state.view === 'week' ? 'visible' : 'hidden';

  const options = { fullDay: state.fullDay, openDay, openMonth };
  if (state.view === 'day') renderDayView(viewContainer, state.date, options);
  else if (state.view === 'week') renderWeekView(viewContainer, state.date, options);
  else if (state.view === 'month') renderMonthView(viewContainer, state.date, options);
  else renderYearView(viewContainer, state.date, options);
  return scrollY;
}

function showSaveStatus(status) {
  const inBrowser = getStorageMode() === 'browser';
  const messages = {
    saving: 'Saving…',
    saved: inBrowser ? 'Saved in this browser' : 'Saved',
    error: inBrowser ? 'Not saved – browser storage refused' : 'Not saved – is the server running?',
  };
  saveStatus.textContent = messages[status];
  saveStatus.className = `save-status ${status}`;
}

function wireToolbar() {
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      render();
    });
  });
  document.getElementById('prevButton').addEventListener('click', () => step(-1));
  document.getElementById('nextButton').addEventListener('click', () => step(1));
  document.getElementById('todayButton').addEventListener('click', () => {
    state.date = today();
    render();
  });

  fullDayCheckbox.checked = state.fullDay;
  fullDayCheckbox.addEventListener('change', () => {
    state.fullDay = fullDayCheckbox.checked;
    localStorage.setItem(FULL_DAY_SETTING, String(state.fullDay));
    render();
  });

  document.getElementById('exportButton').addEventListener('click', downloadExport);
  const importFile = document.getElementById('importFile');
  document.getElementById('importButton').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0];
    importFile.value = '';
    if (!file || !confirm(`Replace all current data with ${file.name}?`)) return;
    try {
      importJson(await file.text());
    } catch (error) {
      alert(error.message);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.target.closest('input, textarea')) return;
    if (event.key === 'ArrowLeft') step(-1);
    if (event.key === 'ArrowRight') step(1);
  });
}

function downloadExport() {
  const blob = new Blob([exportJson()], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'timesheet.json';
  link.click();
  URL.revokeObjectURL(link.href);
}

async function start() {
  wireToolbar();
  onSaveStatus(showSaveStatus);
  // Re-draw after every change, keeping the page where it was scrolled to.
  onChange(() => {
    const scrollY = render();
    window.scrollTo(0, scrollY);
  });
  await loadData();
  if (getStorageMode() === 'browser') {
    saveStatus.textContent = 'No server – saving in this browser';
  }
  render();
}

start();
