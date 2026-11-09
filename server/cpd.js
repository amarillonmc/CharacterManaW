import { decodeText, encodeCompatibleText } from './encoding.js';
import { iniGet, iniInt, parseIni, serializeIni } from './ini.js';
import { normalizeRgb } from './colors.js';

const EMPTY_PARTS = {
  hair_front: '',
  hair_back: '',
  head: '',
  face: '',
  eye: '',
  body: '',
  accessory: [],
};

export function parseCpd(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ''), 'binary');
  const decoded = decodeText(buffer, { preferred: undefined });
  const ini = parseIni(decoded.text);
  const name = iniGet(ini, 'Character', 'name', '').trim();
  const parts = {
    hair_front: iniGet(ini, 'Parts', 'hair_front', '').trim(),
    hair_back: iniGet(ini, 'Parts', 'hair_back', '').trim(),
    head: iniGet(ini, 'Parts', 'head', '').trim(),
    face: iniGet(ini, 'Parts', 'face', '').trim(),
    eye: iniGet(ini, 'Parts', 'eye', '').trim(),
    body: iniGet(ini, 'Parts', 'body', '').trim(),
    accessory: iniGet(ini, 'Parts', 'accessory', '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  };
  const colors = {
    hair: parseColorGroup(ini, 'hair'),
    eye: parseColorGroup(ini, 'eye'),
    body: parseColorGroup(ini, 'body'),
    skin: parseSkinGroup(ini),
    bg: normalizeRgb(iniGet(ini, 'Color', 'bg_rgb', '255,255,255'), [255, 255, 255]),
  };
  const warnings = [];
  if (decoded.encoding !== 'cp932' && decoded.encoding !== 'utf-8') {
    warnings.push(`File was decoded as ${decoded.encoding}.`);
  }
  if (!name) warnings.push('Missing [Character] name.');
  return {
    name,
    parts,
    colors,
    encoding: decoded.encoding,
    warnings,
    rawText: decoded.text,
  };
}

function parseColorGroup(ini, prefix) {
  const palette = iniInt(ini, 'Color', `${prefix}_rgb`, 0);
  const gray = iniInt(ini, 'Color', `${prefix}_gray`, 3);
  const customRaw = iniGet(ini, 'Color', `custom_${prefix}_rgb`, '');
  let custom = null;
  let legacy = false;
  if (customRaw) {
    const nums = customRaw.split(',').map((v) => Number.parseInt(v.trim(), 10));
    if (nums.length >= 4 && nums.slice(0, 4).every(Number.isFinite)) {
      custom = { r: nums[0], g: nums[1], b: nums[2], w: nums[3] };
    }
  }
  if (!custom) legacy = palette >= 8;
  return {
    palette,
    gray,
    custom: custom ?? { r: 64, g: 64, b: 64, w: 50 },
    legacy,
  };
}

function parseSkinGroup(ini) {
  return {
    palette: iniInt(ini, 'Color', 'skin_rgb', 0),
    gray: iniInt(ini, 'Color', 'skin_gray', 3),
  };
}

export function buildCpd({ templateId, parts, colors, comment }) {
  const p = { ...EMPTY_PARTS, ...(parts || {}) };
  const c = colors || {};
  const hair = c.hair || {};
  const eye = c.eye || {};
  const body = c.body || {};
  const skin = c.skin || {};
  const bg = normalizeRgb(c.bg, [255, 255, 255]);
  const custom = (v) => {
    const q = v?.custom || {};
    return `${clamp(q.r ?? 64, 0, 255)},${clamp(q.g ?? 64, 0, 255)},${clamp(q.b ?? 64, 0, 255)},${clamp(q.w ?? 50, 0, 100)}`;
  };
  const text = serializeIni([
    {
      name: 'Character',
      entries: [
        ['name', templateId],
      ],
    },
    {
      name: 'Parts',
      entries: [
        ['hair_front', p.hair_front ?? ''],
        ['hair_back', p.hair_back ?? ''],
        ['head', p.head ?? ''],
        ['face', p.face ?? ''],
        ['eye', p.eye ?? ''],
        ['body', p.body ?? ''],
        ['accessory', Array.isArray(p.accessory) ? p.accessory.join(',') : String(p.accessory ?? '')],
      ],
    },
    {
      name: 'Color',
      entries: [
        ['hair_rgb', clamp(hair.palette, 0, 8)],
        ['hair_gray', clamp(hair.gray, 0, 6)],
        ['custom_hair_rgb', custom(hair)],
        ['eye_rgb', clamp(eye.palette, 0, 8)],
        ['eye_gray', clamp(eye.gray, 0, 6)],
        ['custom_eye_rgb', custom(eye)],
        ['skin_rgb', clamp(skin.palette, 0, 5)],
        ['skin_gray', clamp(skin.gray, 0, 6)],
        ['body_rgb', clamp(body.palette, 0, 8)],
        ['body_gray', clamp(body.gray, 0, 6)],
        ['custom_body_rgb', custom(body)],
        ['bg_rgb', `${bg[0]},${bg[1]},${bg[2]}`],
      ],
    },
  ]);
  const encoded = encodeCompatibleText(text, 'cp932');
  return {
    buffer: encoded.buffer,
    encoding: encoded.encoding,
    lossy: encoded.lossy,
    text,
  };
}

function clamp(v, lo, hi) {
  const n = Number.isFinite(+v) ? Math.trunc(+v) : lo;
  return Math.max(lo, Math.min(hi, n));
}
