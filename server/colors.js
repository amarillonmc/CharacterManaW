import {
  STANDARD_PALETTE,
  GRAY_CONTRAST,
  MONO_GAMMA_OVERRIDE,
  SKIN_SHADE,
  SKIN_GAMMA,
} from './constants.js';

const gammaCache = new Map();
const grayLumaCache = new Map();

function finiteOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function gammaValue(v, param) {
  if (param === 1000) return v;
  if (!Number.isFinite(param) || param <= 0) return v === 255 ? 255 : 0;
  let table = gammaCache.get(param);
  if (!table) {
    table = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      table[i] = clampByte(Math.round(255 * Math.pow(i / 255, 1000 / param)));
    }
    table[255] = 255;
    gammaCache.set(param, table);
  }
  return table[v];
}

export function shadeValue(v, param) {
  if (param === 1000) return v;
  return clampByte(Math.floor((v * param) / 1000 + 0.5));
}

export function toneValue(v, param) {
  return clampByte(v + param);
}

export function grayLuma(r, g, b) {
  const key = (r << 16) | (g << 8) | b;
  let v = grayLumaCache.get(key);
  if (v === undefined) {
    v = (117 * b + 601 * g + 306 * r + 512) >> 10;
    if (grayLumaCache.size > 200000) grayLumaCache.clear();
    grayLumaCache.set(key, v);
  }
  return v;
}

export function grayBlend(r, g, b, amount) {
  if (!amount) return [r, g, b];
  const y = grayLuma(r, g, b);
  const inv = 255 - amount;
  return [
    clampByte(Math.floor((r * inv + y * amount + 127) / 255)),
    clampByte(Math.floor((g * inv + y * amount + 127) / 255)),
    clampByte(Math.floor((b * inv + y * amount + 127) / 255)),
  ];
}

export function normalizeColorGroup(group, kind = 'hair') {
  const g = group && typeof group === 'object' ? group : {};
  let palette = Number.isFinite(+g.palette) ? Math.trunc(+g.palette) : 0;
  let gray = Number.isFinite(+g.gray) ? Math.trunc(+g.gray) : 3;
  let custom = g.custom && typeof g.custom === 'object' ? g.custom : {};
  let customR = clampByte(finiteOr(custom.r, 64));
  let customG = clampByte(finiteOr(custom.g, 64));
  let customB = clampByte(finiteOr(custom.b, 64));
  let customW = clampByte(finiteOr(custom.w, 50));
  if (customW > 100) customW = 100;
  if (gray < 0) gray = 0;
  if (gray > 6) gray = 6;

  // Version 2 palettes 9/10 (brown / orange) were removed in ver 3.  The
  // original converts them to the closest custom colours; mirror that for
  // loaded old .cpd files.
  if ((g.legacy && palette >= 8) || palette === 9 || palette === 10) {
    const legacy = legacyV2Color(palette, gray, kind);
    customR = legacy.r;
    customG = legacy.g;
    customB = legacy.b;
    customW = 50;
    palette = 8;
    gray = 3;
  }

  if (palette >= 8) {
    return {
      palette: 8,
      gray: 3,
      mode: 'custom',
      custom: { r: customR, g: customG, b: customB, w: customW },
      channels: [0, 0, 0],
      gamma: [customW * 20, customW * 20, customW * 20],
      desaturate: 0,
    };
  }

  if (palette < 0) palette = 0;
  if (palette > 7) palette = 7;
  const def = STANDARD_PALETTE[palette];
  let gamma = [1000, 1000, 1000];
  if (palette === 6 || palette === 7) {
    const gv = MONO_GAMMA_OVERRIDE[gray];
    gamma = [gv, gv, gv];
  }
  return {
    palette,
    gray,
    mode: 'standard',
    // Keep the loaded custom values so a .cpd round-trip does not discard
    // them even though the selected standard palette does not use them.
    custom: { r: customR, g: customG, b: customB, w: customW },
    channels: def.channels,
    gamma,
    desaturate: GRAY_CONTRAST[gray],
  };
}

export function normalizeSkinGroup(group) {
  const g = group && typeof group === 'object' ? group : {};
  let palette = Number.isFinite(+g.palette) ? Math.trunc(+g.palette) : 0;
  let gray = Number.isFinite(+g.gray) ? Math.trunc(+g.gray) : 3;
  if (palette < 0) palette = 0;
  if (palette > 5) palette = 5;
  if (gray < 0) gray = 0;
  if (gray > 6) gray = 6;
  return {
    palette,
    gray,
    shade: SKIN_SHADE[palette].slice(),
    gamma: SKIN_GAMMA[gray],
  };
}

export function normalizeColors(colors = {}) {
  return {
    hair: normalizeColorGroup(colors.hair, 'hair'),
    eye: normalizeColorGroup(colors.eye, 'eye'),
    body: normalizeColorGroup(colors.body, 'body'),
    skin: normalizeSkinGroup(colors.skin),
    bg: normalizeRgb(colors.bg, [255, 255, 255]),
  };
}

export function normalizeRgb(value, fallback = [255, 255, 255]) {
  if (Array.isArray(value) && value.length >= 3) {
    return [clampByte(finiteOr(value[0], 0)), clampByte(finiteOr(value[1], 0)), clampByte(finiteOr(value[2], 0))];
  }
  if (typeof value === 'string') {
    const parts = value.split(',').map((v) => Number.parseInt(v, 10));
    if (parts.length >= 3 && parts.every(Number.isFinite)) {
      return [clampByte(parts[0]), clampByte(parts[1]), clampByte(parts[2])];
    }
  }
  return fallback.slice();
}

export function colorSignature(colors) {
  const c = normalizeColors(colors);
  return JSON.stringify({
    h: [c.hair.palette, c.hair.gray, c.hair.custom],
    e: [c.eye.palette, c.eye.gray, c.eye.custom],
    b: [c.body.palette, c.body.gray, c.body.custom],
    s: [c.skin.palette, c.skin.gray],
  });
}

export function transformForKind(colors, kind) {
  const c = colors;
  if (kind === 'skin') {
    return { type: 'skin', shade: c.skin.shade, gamma: c.skin.gamma };
  }
  const group = c[kind] || c.hair;
  if (group.mode === 'custom') {
    return {
      type: 'custom',
      channels: group.channels,
      gamma: group.gamma,
      custom: group.custom,
      desaturate: group.desaturate,
    };
  }
  return {
    type: 'standard',
    channels: group.channels,
    gamma: group.gamma,
    custom: null,
    desaturate: group.desaturate,
  };
}

export function transformMarkersForAccessory(colors, name) {
  const list = [];
  if (/[（(]髪[）)]/.test(name)) list.push('hair');
  if (/[（(]瞳[）)]/.test(name)) list.push('eye');
  if (/[（(]肌[）)]/.test(name)) list.push('skin');
  if (/[（(]服[）)]/.test(name)) list.push('body');
  return list;
}

export function applyTransform(data, width, height, transform, tone = 2) {
  const kind = transform?.type ?? 'none';
  const out = Buffer.from(data);
  const n = width * height;
  if (kind === 'none') {
    if (!tone) return out;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      out[o] = toneValue(out[o], tone);
      out[o + 1] = toneValue(out[o + 1], tone);
      out[o + 2] = toneValue(out[o + 2], tone);
    }
    return out;
  }

  if (kind === 'skin') {
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      out[o] = toneValue(gammaValue(shadeValue(out[o], transform.shade[0]), transform.gamma), tone);
      out[o + 1] = toneValue(gammaValue(shadeValue(out[o + 1], transform.shade[1]), transform.gamma), tone);
      out[o + 2] = toneValue(gammaValue(shadeValue(out[o + 2], transform.shade[2]), transform.gamma), tone);
    }
    return out;
  }

  const [cr, cg, cb] = transform.channels;
  const [gr, gg, gb] = transform.gamma;
  const custom = transform.custom;
  const desat = transform.desaturate || 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    // ReplaceDIB: each output channel is a source channel selected modulo 3.
    const sr = out[o];
    const sg = out[o + 1];
    const sb = out[o + 2];
    const src = [sr, sg, sb];
    let r = gammaValue(src[cr], gr);
    let g = gammaValue(src[cg], gg);
    let b = gammaValue(src[cb], gb);
    if (custom) {
      r = toneValue(r, custom.r);
      g = toneValue(g, custom.g);
      b = toneValue(b, custom.b);
    }
    if (desat) {
      [r, g, b] = grayBlend(r, g, b, desat);
    }
    out[o] = toneValue(r, tone);
    out[o + 1] = toneValue(g, tone);
    out[o + 2] = toneValue(b, tone);
  }
  return out;
}

export function applyAccessoryTransforms(data, width, height, colors, name, tone = 2) {
  let out = data;
  for (const kind of transformMarkersForAccessory(colors, name)) {
    out = applyTransform(out, width, height, transformForKind(colors, kind), 0);
  }
  return applyTransform(out, width, height, { type: 'none' }, tone);
}

function legacyV2Color(palette, gray, kind) {
  // Values transcribed from the original ver3 compatibility table.  These
  // only apply when a loaded file has no custom_*_rgb key.
  const table = LEGACY_V2[palette === 10 ? 10 : palette === 9 ? 9 : 8];
  const row = table[Math.max(0, Math.min(6, gray))];
  if (kind === 'hair' || kind === 'body' || kind === 'eye') {
    return { r: row[0], g: row[1], b: row[2] };
  }
  return { r: 64, g: 64, b: 64 };
}

const LEGACY_V2 = {
  8: [
    [83, 0, 0], [76, 3, 3], [68, 6, 6], [54, 13, 13], [39, 19, 19], [32, 22, 22], [25, 25, 25],
  ],
  9: [
    [112, 34, 0], [105, 36, 7], [97, 39, 13], [82, 44, 27], [68, 48, 40], [60, 51, 47], [53, 53, 53],
  ],
  10: [
    [118, 16, 16], [109, 20, 20], [100, 24, 24], [82, 31, 31], [64, 39, 39], [55, 42, 42], [46, 46, 46],
  ],
};

export function paletteLabel(index, locale = 'ja') {
  const names = {
    0: { ja: '青', zh: '蓝色', en: 'Blue' },
    1: { ja: '紫', zh: '紫色', en: 'Violet' },
    2: { ja: '赤', zh: '红色', en: 'Red' },
    3: { ja: '黄色', zh: '黄色', en: 'Yellow' },
    4: { ja: '緑', zh: '绿色', en: 'Green' },
    5: { ja: '水色', zh: '青色', en: 'Cyan' },
    6: { ja: '黒', zh: '黑色', en: 'Black' },
    7: { ja: '白', zh: '白色', en: 'White' },
    8: { ja: 'カスタム', zh: '自定义', en: 'Custom' },
  };
  return names[index]?.[locale] ?? names[index]?.ja ?? String(index);
}
