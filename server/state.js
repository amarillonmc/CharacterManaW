import { CATEGORIES } from './constants.js';
import { normalizeColors, normalizeRgb } from './colors.js';
import { findPart } from './render.js';

export const DEFAULT_OPTIONS = {
  flip: false,
  eyeLayer: false,
  faceLayer: false,
  accessoryMax: 6,
};

export function defaultState(template) {
  return {
    templateId: template.id,
    parts: cloneParts(template.defaults.parts),
    colors: cloneColors(template.defaults.colors),
    options: {
      ...DEFAULT_OPTIONS,
      accessoryMax: template.config?.accessory_max ?? 6,
    },
  };
}

export function normalizeState(template, input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const defaultParts = template.defaults.parts;
  const parts = {};
  for (const def of CATEGORIES) {
    if (def.multiple) {
      const wanted = Array.isArray(source.parts?.[def.id]) ? source.parts[def.id] : defaultParts[def.id] || [];
      const out = [];
      const max = clampInt(source.options?.accessoryMax, 0, 32, template.config?.accessory_max ?? 6);
      for (const name of wanted) {
        if (out.length >= max) break;
        if (findPart(template, def.id, name)) out.push(String(name));
      }
      parts[def.id] = out;
    } else {
      const wanted = source.parts?.[def.id];
      const fallback = defaultParts[def.id] || '';
      parts[def.id] = findPart(template, def.id, wanted) ? String(wanted) : fallback;
    }
  }
  const colors = normalizeColors({
    hair: source.colors?.hair ?? template.defaults.colors.hair,
    eye: source.colors?.eye ?? template.defaults.colors.eye,
    body: source.colors?.body ?? template.defaults.colors.body,
    skin: source.colors?.skin ?? template.defaults.colors.skin,
    bg: source.colors?.bg ?? template.defaults.colors.bg,
  });
  const options = {
    flip: !!source.options?.flip,
    eyeLayer: !!source.options?.eyeLayer,
    faceLayer: !!source.options?.faceLayer,
    accessoryMax: clampInt(source.options?.accessoryMax, 0, 32, template.config?.accessory_max ?? 6),
  };
  return { templateId: template.id, parts, colors, options };
}

export function stateFromCpd(template, cpd) {
  const parts = {
    hair_front: cpd.parts.hair_front,
    hair_back: cpd.parts.hair_back,
    head: cpd.parts.head,
    face: cpd.parts.face,
    eye: cpd.parts.eye,
    body: cpd.parts.body,
    accessory: cpd.parts.accessory,
  };
  const colors = {
    hair: { ...cpd.colors.hair },
    eye: { ...cpd.colors.eye },
    body: { ...cpd.colors.body },
    skin: { ...cpd.colors.skin },
    bg: normalizeRgb(cpd.colors.bg, [255, 255, 255]),
  };
  return normalizeState(template, { parts, colors, options: {} });
}

export function stateToCpd(template, state) {
  const s = normalizeState(template, state);
  return {
    templateId: template.id,
    parts: cloneParts(s.parts),
    colors: {
      hair: cpdColor(s.colors.hair),
      eye: cpdColor(s.colors.eye),
      body: cpdColor(s.colors.body),
      skin: { palette: s.colors.skin.palette, gray: s.colors.skin.gray },
      bg: s.colors.bg.slice(),
    },
  };
}

function cpdColor(group) {
  if (group.mode === 'custom') {
    return {
      palette: 8,
      gray: 3,
      custom: {
        r: group.custom?.r ?? 64,
        g: group.custom?.g ?? 64,
        b: group.custom?.b ?? 64,
        w: group.custom?.w ?? 50,
      },
    };
  }
  return {
    palette: group.palette,
    gray: group.gray,
    custom: group.custom ?? { r: 64, g: 64, b: 64, w: 50 },
  };
}

export function cloneParts(parts = {}) {
  const out = {};
  for (const def of CATEGORIES) {
    out[def.id] = def.multiple ? Array.isArray(parts[def.id]) ? parts[def.id].slice() : [] : parts[def.id] ?? '';
  }
  return out;
}

export function cloneColors(colors = {}) {
  return JSON.parse(JSON.stringify(colors));
}

function clampInt(v, lo, hi, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}
