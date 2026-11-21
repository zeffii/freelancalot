// Tiny helper for building elements: el('div', 'class-name', 'text')
export function el(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

// A label name as it appears everywhere: black text on a white chip.
export function labelChip(name) {
  return el('span', 'label-chip', name);
}

// Small white marker shown on blocks that have a note (a speech-bubble icon).
export function noteMarker() {
  const marker = el('span', 'note-marker');
  marker.title = 'Has a note';
  marker.innerHTML = '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">'
    + '<path d="M2.5 3h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5V11H2.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" '
    + 'fill="none" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  return marker;
}
