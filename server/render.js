import fs from 'node:fs/promises';
import path from 'node:path';
import pngjs from 'pngjs';
import {
  applyAccessoryTransforms,
  applyTransform,
  normalizeColors,
  colorSignature,
  transformForKind,
} from './colors.js';
import { ACCESSORY_LAYERS, CATEGORIES } from './constants.js';

const { PNG } = pngjs;

export class RenderError extends Error {
  constructor(message, code = 'render_error') {
    super(message);
    this.name = 'RenderError';
    this.code = code;
  }
}

const decodedCache = new Map();
const transformedCache = new Map();
const MAX_DECODED_BYTES = 220 * 1024 * 1024;
const MAX_TRANSFORMED_BYTES = 160 * 1024 * 1024;
let decodedBytes = 0;
let transformedBytes = 0;

export async function renderCharacter(template, state, options = {}) {
  const size = template.size || { x: 300, y: 400 };
  const width = Math.max(1, Math.min(4096, size.x | 0));
  const height = Math.max(1, Math.min(4096, size.y | 0));
  const mode = options.mode === 'alpha' ? 'alpha' : 'normal';
  const colors = normalizeColors(state.colors);
  const parts = normalizeParts(state.parts);
  const descriptors = buildLayerDescriptors(template, parts, state.options || {});
  const tone = Number.isFinite(+options.tone) ? +options.tone : 2;

  let canvas;
  if (mode === 'alpha') {
    canvas = Buffer.alloc(width * height * 4, 0);
  } else {
    const [r, g, b] = colors.bg;
    canvas = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      canvas[o] = r;
      canvas[o + 1] = g;
      canvas[o + 2] = b;
      canvas[o + 3] = 255;
    }
  }

  const layers = [];
  for (const d of descriptors) {
    try {
      const decoded = await loadPng(d.filePath);
      let data;
      if (d.transformKind === 'accessory') {
        data = getTransformedAccessory(d, decoded, colors, tone);
      } else {
        const transform = d.transformKind === 'none'
          ? { type: 'none' }
          : transformForKind(colors, d.transformKind);
        data = getTransformed(d, decoded, transform, tone);
      }
      compositeOver(canvas, width, height, data, decoded.width, decoded.height);
      layers.push({
        layer: d.layerId,
        category: d.categoryId,
        part: d.partName,
        width: decoded.width,
        height: decoded.height,
      });
    } catch (err) {
      if (err?.code === 'ENOENT') continue;
      throw err;
    }
  }

  if (state.options?.flip) flipHorizontal(canvas, width, height);
  if (mode === 'normal') {
    for (let i = 3; i < canvas.length; i += 4) canvas[i] = 255;
  }
  return { width, height, data: canvas, layers, mode, descriptors };
}

export function buildLayerDescriptors(template, parts, options = {}) {
  const out = [];
  const aux = { template, parts, out, options };
  const addAccessory = (layerId) => {
    const list = parts.accessory || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const name = list[i];
      const part = findPart(template, 'accessory', name);
      if (!part || !part.layers[layerId]) continue;
      out.push({
        kind: 'accessory',
        categoryId: 'accessory',
        partName: name,
        layerId,
        filePath: pathForLayer(template, layerId, part.layers[layerId]),
        transformKind: 'accessory',
        markers: part.markers,
      });
    }
  };
  const addMain = (categoryId, layerId, transformType) => {
    const name = parts[categoryId];
    if (!name) return;
    const part = findPart(template, categoryId, name);
    if (!part || !part.layers[layerId]) return;
    out.push({
      kind: 'main',
      categoryId,
      partName: name,
      layerId,
      filePath: pathForLayer(template, layerId, part.layers[layerId]),
      transformKind: transformType,
      markers: part.markers,
    });
  };

  addAccessory('accessory_back');
  addMain('hair_back', 'hair_back', 'hair');
  addMain('hair_back', 'hair_back_accessory', 'none');
  addMain('body', 'body_back', 'skin');
  addAccessory('accessory_underwear');
  addMain('body', 'body_front', 'none');
  addMain('body', 'body_front_color', 'body');
  addMain('body', 'body_front_accessory', 'none');
  addAccessory('accessory_middle_back');
  addMain('head', 'head', 'skin');
  addAccessory('accessory_middle_front');
  addMain('face', 'face_back', 'none');
  const faceLayer = !!options.faceLayer;
  const eyeLayer = !!options.eyeLayer;
  if (faceLayer) {
    addMain('face', 'face_front', 'none');
    addMain('face', 'face_haircolor', 'hair');
  }
  if (eyeLayer) {
    addMain('eye', 'eye', eyeIsColorable(template) ? 'eye' : 'none');
    addMain('eye', 'eye_color', 'eye');
  }
  addMain('hair_front', 'hair_front', 'hair');
  addMain('hair_front', 'hair_front_accessory', 'none');
  if (!faceLayer) {
    addMain('face', 'face_front', 'none');
    addMain('face', 'face_haircolor', 'hair');
  }
  if (!eyeLayer) {
    addMain('eye', 'eye', eyeIsColorable(template) ? 'eye' : 'none');
    addMain('eye', 'eye_color', 'eye');
  }
  addAccessory('accessory_front');
  return out;
}

function eyeIsColorable(template) {
  return !template.categories?.eye?.special?.eyeColorFolder;
}

export function findPart(template, categoryId, name) {
  const cat = template.categories?.[categoryId];
  if (!cat) return null;
  const key = String(name ?? '').toLowerCase();
  return cat.parts.find((p) => p.name.toLowerCase() === key || p.stem?.toLowerCase() === key) || null;
}

function pathForLayer(template, layerId, fileName) {
  return path.join(template.dir, layerId, fileName);
}

function normalizeParts(parts) {
  const out = {};
  for (const def of CATEGORIES) {
    if (def.multiple) {
      out[def.id] = Array.isArray(parts?.[def.id]) ? parts[def.id].filter(Boolean).map(String) : [];
    } else {
      out[def.id] = parts?.[def.id] ? String(parts[def.id]) : '';
    }
  }
  return out;
}

async function loadPng(filePath) {
  const st = await fs.stat(filePath);
  const cached = decodedCache.get(filePath);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    cached.last = Date.now();
    return cached;
  }
  const buf = await fs.readFile(filePath);
  const png = PNG.sync.read(buf);
  const entry = {
    width: png.width,
    height: png.height,
    data: Buffer.from(png.data),
    mtimeMs: st.mtimeMs,
    size: st.size,
    bytes: png.data.length,
    last: Date.now(),
  };
  if (cached) decodedBytes -= cached.bytes;
  decodedCache.set(filePath, entry);
  decodedBytes += entry.bytes;
  trimCache(decodedCache, MAX_DECODED_BYTES, (e) => e.bytes, (v) => {
    decodedBytes = Math.max(0, decodedBytes - v);
  });
  return entry;
}

function getTransformed(d, decoded, transform, tone) {
  const t = transform.type;
  const version = `${decoded.mtimeMs}:${decoded.size}`;
  if (!t || t === 'none') {
    const key = `${d.filePath}|${version}|none|${tone}`;
    return cacheTransform(key, decoded, () => applyTransform(decoded.data, decoded.width, decoded.height, { type: 'none' }, tone));
  }
  if (t === 'skin') {
    const key = `${d.filePath}|${version}|skin|${tone}|${JSON.stringify(transform)}`;
    return cacheTransform(key, decoded, () => applyTransform(decoded.data, decoded.width, decoded.height, transform, tone));
  }
  const key = `${d.filePath}|${version}|${t}|${tone}|${JSON.stringify(transform)}`;
  return cacheTransform(key, decoded, () => applyTransform(decoded.data, decoded.width, decoded.height, transform, tone));
}

function getTransformedAccessory(d, decoded, colors, tone) {
  const key = `${d.filePath}|${decoded.mtimeMs}:${decoded.size}|acc|${colorSignature(colors)}|${tone}`;
  return cacheTransform(key, decoded, () =>
    applyAccessoryTransforms(decoded.data, decoded.width, decoded.height, colors, d.partName, tone),
  );
}

function cacheTransform(key, decoded, producer) {
  const hit = transformedCache.get(key);
  if (hit) {
    hit.last = Date.now();
    return hit.data;
  }
  const data = producer();
  const entry = { data, bytes: data.length, width: decoded.width, height: decoded.height, last: Date.now() };
  transformedCache.set(key, entry);
  transformedBytes += entry.bytes;
  trimCache(transformedCache, MAX_TRANSFORMED_BYTES, (e) => e.bytes, (v) => {
    transformedBytes = Math.max(0, transformedBytes - v);
  });
  return data;
}

function trimCache(map, maxBytes, sizeOf, onRemove) {
  let total = 0;
  for (const v of map.values()) total += sizeOf(v);
  if (total <= maxBytes) return;
  const entries = Array.from(map.entries()).sort((a, b) => (a[1].last || 0) - (b[1].last || 0));
  for (const [k, v] of entries) {
    if (total <= maxBytes) break;
    map.delete(k);
    total -= sizeOf(v);
    onRemove(sizeOf(v));
  }
}

export function compositeOver(dst, dw, dh, src, sw, sh) {
  const w = Math.min(dw, sw);
  const h = Math.min(dh, sh);
  for (let y = 0; y < h; y++) {
    const srcRow = y * sw * 4;
    const dstRow = y * dw * 4;
    for (let x = 0; x < w; x++) {
      const si = srcRow + x * 4;
      const di = dstRow + x * 4;
      const sa = src[si + 3];
      if (sa === 0) continue;
      if (sa === 255) {
        dst[di] = src[si];
        dst[di + 1] = src[si + 1];
        dst[di + 2] = src[si + 2];
        dst[di + 3] = 255;
        continue;
      }
      const da = dst[di + 3];
      if (da === 0) {
        dst[di] = src[si];
        dst[di + 1] = src[si + 1];
        dst[di + 2] = src[si + 2];
        dst[di + 3] = sa;
        continue;
      }
      const saN = sa / 255;
      const daN = da / 255;
      const outA = saN + daN * (1 - saN);
      if (outA <= 0) {
        dst[di] = 0;
        dst[di + 1] = 0;
        dst[di + 2] = 0;
        dst[di + 3] = 0;
        continue;
      }
      dst[di] = clampByte(Math.round((src[si] * saN + dst[di] * daN * (1 - saN)) / outA));
      dst[di + 1] = clampByte(Math.round((src[si + 1] * saN + dst[di + 1] * daN * (1 - saN)) / outA));
      dst[di + 2] = clampByte(Math.round((src[si + 2] * saN + dst[di + 2] * daN * (1 - saN)) / outA));
      dst[di + 3] = clampByte(Math.round(outA * 255));
    }
  }
}

export function flipHorizontal(data, width, height) {
  const row = width * 4;
  const tmp = Buffer.alloc(row);
  for (let y = 0; y < height; y++) {
    const off = y * row;
    for (let x = 0; x < Math.floor(width / 2); x++) {
      const a = off + x * 4;
      const b = off + (width - 1 - x) * 4;
      data.copy(tmp, 0, a, a + 4);
      data.copy(data, a, b, b + 4);
      tmp.copy(data, b, 0, 4);
    }
  }
}

export function copyCanvas(canvas) {
  return Buffer.from(canvas);
}

const thumbnailCache = new Map();
const MAX_THUMBNAILS = 4000;

export async function renderPartThumbnail(template, categoryId, partName, colorsInput, target = 96) {
  const colors = normalizeColors(colorsInput);
  const key = `${template.id}|${categoryId}|${partName}|${target}|${colorSignature(colors)}`;
  const hit = thumbnailCache.get(key);
  if (hit) {
    hit.last = Date.now();
    return hit.buffer;
  }
  const parts = {};
  for (const def of CATEGORIES) parts[def.id] = def.multiple ? [] : '';
  if (categoryId === 'accessory') parts.accessory = [partName];
  else parts[categoryId] = partName;
  const state = {
    parts,
    colors,
    options: { flip: false, eyeLayer: false, faceLayer: false, accessoryMax: 32 },
  };
  const rendered = await renderCharacter(template, state, { mode: 'alpha', tone: 2 });
  const sharp = (await import('sharp')).default;
  const buffer = await sharp(rendered.data, { raw: { width: rendered.width, height: rendered.height, channels: 4 } })
    .resize({ width: target, height: target, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 6 })
    .toBuffer();
  thumbnailCache.set(key, { buffer, last: Date.now() });
  if (thumbnailCache.size > MAX_THUMBNAILS) {
    const oldest = Array.from(thumbnailCache.entries()).sort((a, b) => a[1].last - b[1].last).slice(0, 500);
    for (const [k] of oldest) thumbnailCache.delete(k);
  }
  return buffer;
}

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}
