export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  if (props.id) node.id = props.id;
  if (props.className) node.className = props.className;
  if (props.attrs) {
    for (const [key, value] of Object.entries(props.attrs)) {
      node.setAttribute(key, value);
    }
  }
  if (props.on) {
    for (const [name, handler] of Object.entries(props.on)) {
      node.addEventListener(name, handler);
    }
  }
  mount(node, children);
  // text/html are applied after mount so clear() inside mount cannot wipe them.
  if (props.text !== undefined) node.textContent = props.text;
  if (props.html !== undefined) node.innerHTML = props.html;
  return node;
}

export function clear(node) {
  node.textContent = '';
}

export function mount(node, children) {
  clear(node);
  for (const child of children) {
    if (child == null) continue;
    node.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * The jersey tile: what a player looks like when there is no free photo.
 * Deterministic per player so their avatar is the same everywhere it appears.
 */
export function jerseyTile(player, { size = 56 } = {}) {
  const name = String(player?.name ?? '?');
  const parts = name.split(/\s+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  const hue = Math.abs(Number(player?.id ?? 0)) % 36;
  return el('div', {
    className: 'tile',
    text: initials,
    attrs: {
      role: 'img',
      'aria-label': name,
      title: name,
      style: `width:${size}px;height:${size}px;background:hsl(${hue},55%,42%);`,
    },
  });
}

/** 30000 -> "30,000". Points won read "+4,500"; nothing reads "+0". */
export function pointsLabel(value, { signed = false } = {}) {
  const n = Math.round(Number(value) || 0);
  const text = n.toLocaleString('en-US');
  return signed && n > 0 ? `+${text}` : text;
}

/** A short, shareable summary of a finished quiz. */
export function shareText({ scopeName, score, rounds, recap }) {
  const lines = [
    `Football Trivia — ${scopeName}`,
    `${pointsLabel(score)} points over ${rounds} rounds`,
  ];
  if (recap) lines.push(recap);
  return lines.join('\n');
}
