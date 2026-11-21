// "Import JSON": replace all data with a timesheet file, either a local file
// or one fetched from a link (also via ?load=<link> in the page address).
import { el } from './dom.js';
import { importJson, getStorageMode } from './store.js';

const LAST_LINK_SETTING = 'freelancalot.lastImportLink';

// Turn common "share" links into links to the raw file.
export function directDownloadLink(link) {
  const url = new URL(link.trim());
  // github.com/user/repo/blob/branch/path -> raw.githubusercontent.com/user/repo/branch/path
  const blob = url.hostname === 'github.com' && url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`;
  // Dropbox: dl=0 shows a web page, dl=1 gives the file
  if (url.hostname.endsWith('dropbox.com')) {
    url.searchParams.set('dl', '1');
    return url.toString();
  }
  // Google Drive: /file/d/ID/view -> direct download
  const drive = url.hostname === 'drive.google.com' && url.pathname.match(/\/file\/d\/([^/]+)/);
  if (drive) return `https://drive.google.com/uc?export=download&id=${drive[1]}`;
  return url.toString();
}

// Fetch the file's text. If the site blocks the browser from reading it (CORS),
// fall back to the local server, which can fetch it on our behalf.
export async function fetchJsonText(link) {
  const url = directDownloadLink(link);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`The link answered ${response.status}`);
    return await response.text();
  } catch (directError) {
    if (getStorageMode() !== 'server') {
      if (!(directError instanceof TypeError)) throw directError;
      throw new Error('that site doesn\'t let other pages read its files. Download it and use "Choose file", or use the local app.');
    }
    const response = await fetch(`api/fetch?url=${encodeURIComponent(url)}`);
    if (!response.ok) throw new Error((await response.json()).error ?? `Fetch failed (${response.status})`);
    return await response.text();
  }
}

export function openImportDialog() {
  const backdrop = el('div', 'modal-backdrop');
  const dialog = el('div', 'modal');
  backdrop.append(dialog);

  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.hidden = true;
  const fileButton = el('button', '', 'Choose file…');

  const linkInput = el('input', 'dialog-link');
  linkInput.type = 'url';
  linkInput.placeholder = 'https://…/timesheet.json';
  linkInput.value = localStorage.getItem(LAST_LINK_SETTING) ?? '';
  const linkButton = el('button', 'primary', 'Load link');

  const fileRow = el('div', 'dialog-row');
  fileRow.append(el('span', 'dialog-label', 'File'), fileButton, fileInput);
  const linkRow = el('div', 'dialog-row');
  linkRow.append(el('span', 'dialog-label', 'Link'), linkInput, linkButton);

  const message = el('p', 'dialog-error');
  const cancelButton = el('button', '', 'Cancel');
  const actions = el('div', 'dialog-actions');
  actions.append(cancelButton);

  dialog.append(
    el('h2', '', 'Import JSON'),
    el('p', 'muted dialog-note', 'Replaces all current data. Export JSON first if you want to keep it.'),
    fileRow, linkRow, message, actions,
  );
  document.body.append(backdrop);
  linkInput.focus();

  const close = () => backdrop.remove();
  const importText = (text, source) => {
    if (!confirm(`Replace all current data with ${source}?`)) return;
    importJson(text);
    close();
  };

  fileButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      importText(await file.text(), file.name);
    } catch (error) {
      message.textContent = error.message;
    }
  });

  const loadLink = async () => {
    const link = linkInput.value.trim();
    if (!link) {
      message.textContent = 'Paste a link first.';
      return;
    }
    message.textContent = '';
    linkButton.textContent = 'Loading…';
    try {
      const text = await fetchJsonText(link);
      localStorage.setItem(LAST_LINK_SETTING, link);
      importText(text, 'the file at that link');
    } catch (error) {
      message.textContent = `Couldn't load it: ${error.message}`;
    } finally {
      linkButton.textContent = 'Load link';
    }
  };
  linkButton.addEventListener('click', loadLink);
  linkInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') loadLink(); });

  cancelButton.addEventListener('click', close);
  backdrop.addEventListener('pointerdown', (event) => { if (event.target === backdrop) close(); });
  dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
}

// Called on start: ?load=<link> imports that file (after asking), then the
// parameter is removed from the address so a reload doesn't import again.
export async function importFromAddressBar() {
  const params = new URLSearchParams(window.location.search);
  const link = params.get('load');
  if (!link) return;
  params.delete('load');
  const query = params.toString();
  history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);

  if (!confirm(`Load timesheet data from\n${link}\n\nThis replaces all current data.`)) return;
  try {
    importJson(await fetchJsonText(link));
  } catch (error) {
    alert(`Couldn't load ${link}: ${error.message}`);
  }
}
