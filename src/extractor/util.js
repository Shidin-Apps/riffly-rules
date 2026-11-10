// Tiny lenient helpers. Every accessor tolerates missing nodes: YouTube changes
// shapes without notice and a parser must degrade to "skip", never throw.

export function nav(obj, path) {
  let cur = obj;
  for (let i = 0; i < path.length; i++) {
    if (cur == null) return undefined;
    cur = cur[path[i]];
  }
  return cur;
}

export function text(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node.simpleText === 'string') return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((r) => r.text || '').join('');
  return '';
}

export function thumbs(node) {
  const list =
    nav(node, ['musicThumbnailRenderer', 'thumbnail', 'thumbnails']) ||
    nav(node, ['croppedSquareThumbnailRenderer', 'thumbnail', 'thumbnails']) ||
    nav(node, ['thumbnail', 'thumbnails']) ||
    nav(node, ['thumbnails']) ||
    [];
  if (!Array.isArray(list)) return [];
  return list
    .filter((t) => t && typeof t.url === 'string')
    .map((t) => ({ url: t.url.startsWith('//') ? 'https:' + t.url : t.url, width: t.width || 0, height: t.height || 0 }));
}

export function parseDuration(str) {
  if (!str || typeof str !== 'string') return 0;
  const m = str.trim().match(/^(\d+:)?(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  return h * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
}

export function compact(obj) {
  const out = {};
  for (const k in obj) {
    const v = obj[k];
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}

// Depth-first search for the first object that owns `key`. Used only as a last
// resort when a known path is missing (bounded so a huge response can't stall us).
export function findKey(obj, key, budget) {
  const state = budget || { left: 20000 };
  if (!obj || typeof obj !== 'object' || state.left-- <= 0) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  const values = Array.isArray(obj) ? obj : Object.values(obj);
  for (let i = 0; i < values.length; i++) {
    const hit = findKey(values[i], key, state);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

export function findAll(obj, key, out, budget) {
  const acc = out || [];
  const state = budget || { left: 60000 };
  if (!obj || typeof obj !== 'object' || state.left-- <= 0) return acc;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) findAll(obj[i], key, acc, state);
    return acc;
  }
  for (const k in obj) {
    if (k === key) acc.push(obj[k]);
    else findAll(obj[k], key, acc, state);
  }
  return acc;
}
