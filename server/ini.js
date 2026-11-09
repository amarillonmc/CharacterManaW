export function parseIni(text) {
  // Null-prototype maps prevent a crafted INI section/key named "__proto__"
  // from mutating Object.prototype.
  const result = Object.create(null);
  let section = null;
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith(';') || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1).trim().toLowerCase();
      if (section && !result[section]) result[section] = Object.create(null);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1);
    if (!section) {
      if (!result.__global) result.__global = Object.create(null);
      result.__global[key] = value;
    } else {
      result[section][key] = value;
    }
  }
  return result;
}

export function iniGet(ini, section, key, fallback = '') {
  const s = ini?.[String(section).toLowerCase()];
  if (!s) return fallback;
  const k = String(key).toLowerCase();
  return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : fallback;
}

export function iniInt(ini, section, key, fallback = 0) {
  const raw = iniGet(ini, section, key, '');
  const n = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function serializeIni(sections) {
  const out = [];
  for (const { name, entries } of sections) {
    out.push(`[${name}]`);
    for (const [key, value] of entries) {
      out.push(`${key}=${String(value ?? '').replace(/[\r\n]+/g, ' ')}`);
    }
  }
  return `${out.join('\r\n')}\r\n`;
}
