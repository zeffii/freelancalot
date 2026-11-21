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
