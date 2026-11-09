import archiver from 'archiver';
import { CATEGORIES } from './constants.js';
import { normalizeState } from './state.js';
import { renderCharacter } from './render.js';
import { encodePng } from './image.js';

const VARIANT_AXES = ['hair_front', 'hair_back', 'head', 'face', 'eye', 'body'];
export const MAX_VARIANT_COMBINATIONS = 2000;
export const MAX_PREVIEW = 36;

export function planVariants(template, state, input = {}) {
  const s = normalizeState(template, state);
  const requestedAxes = Array.isArray(input.axes) ? input.axes.filter((a) => VARIANT_AXES.includes(a)) : [];
  const axes = requestedAxes.length ? requestedAxes : ['face'];
  const valuesByAxis = {};
  const warnings = [];
  for (const axis of axes) {
    const cat = template.categories[axis];
    const all = cat?.names ?? [];
    const requested = Array.isArray(input.values?.[axis]) ? input.values[axis] : all;
    let values = requested.filter((name) => all.includes(name));
    if (!values.length) values = all.slice(0, 1);
    if (values.length > 200) {
      warnings.push(`${axis}: limited to 200 values`);
      values = values.slice(0, 200);
    }
    valuesByAxis[axis] = values;
  }

  const limit = clampInt(input.limit, 1, MAX_VARIANT_COMBINATIONS, 512);
  const total = axes.reduce((n, axis) => n * valuesByAxis[axis].length, 1);
  const combos = [];
  let truncated = false;
  const recurse = (idx, chosen) => {
    if (truncated) return;
    if (idx >= axes.length) {
      if (combos.length >= limit) {
        truncated = total > limit;
        return;
      }
      const variantState = {
        ...s,
        parts: { ...s.parts, accessory: s.parts.accessory.slice() },
        colors: JSON.parse(JSON.stringify(s.colors)),
        options: { ...s.options },
      };
      for (let i = 0; i < axes.length; i++) variantState.parts[axes[i]] = chosen[i];
      const label = axes.map((a, i) => `${a}:${chosen[i]}`).join(' | ');
      combos.push({
        index: combos.length,
        parts: Object.fromEntries(axes.map((a, i) => [a, chosen[i]])),
        label,
        state: variantState,
      });
      return;
    }
    for (const value of valuesByAxis[axes[idx]]) {
      chosen[idx] = value;
      recurse(idx + 1, chosen);
      if (truncated) return;
    }
  };
  recurse(0, []);
  return {
    axes,
    values: valuesByAxis,
    count: combos.length,
    truncated,
    limit,
    combinations: combos,
    warnings,
  };
}

export async function renderVariantPreviews(template, state, input = {}) {
  const plan = planVariants(template, state, input);
  const selected = selectCombinations(plan, input.indices);
  const items = [];
  for (const c of selected.slice(0, MAX_PREVIEW)) {
    const rendered = await renderCharacter(template, c.state, {
      mode: input.mode === 'alpha' ? 'alpha' : 'normal',
      tone: 2,
    });
    const thumb = await makePreviewPng(rendered, clampInt(input.previewWidth, 32, 1024, 240));
    items.push({
      index: c.index,
      label: c.label,
      parts: c.parts,
      state: c.state,
      png: thumb.toString('base64'),
    });
  }
  return {
    axes: plan.axes,
    values: plan.values,
    count: plan.count,
    truncated: plan.truncated,
    previewCount: items.length,
    items,
    warnings: plan.warnings,
  };
}

export async function exportVariantZip(res, template, state, input = {}) {
  const plan = planVariants(template, state, input);
  const selected = selectCombinations(plan, input.indices);
  if (!selected.length) throw new Error('No variants selected.');
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('warning', (err) => {
    if (err.code !== 'ENOENT') archive.emit('error', err);
  });
  archive.pipe(res);
  const manifest = {
    app: 'character-nantoka-web',
    template: { id: template.id, name: template.displayName || template.name, size: template.size },
    axes: plan.axes,
    values: plan.values,
    count: selected.length,
    totalAvailable: plan.count,
    truncated: plan.truncated,
    generatedAt: new Date().toISOString(),
    variants: [],
  };
  let done = 0;
  for (const c of selected) {
    const rendered = await renderCharacter(template, c.state, {
      mode: input.mode === 'alpha' ? 'alpha' : 'normal',
      tone: 2,
    });
    let png;
    if (input.format === 'bmp') {
      const { encodeBmp24 } = await import('./image.js');
      png = encodeBmp24(rendered.data, rendered.width, rendered.height);
    } else {
      png = encodePng(rendered.data, rendered.width, rendered.height);
    }
    const ext = input.format === 'bmp' ? 'bmp' : 'png';
    const name = safeVariantFilename(template, c, ext);
    archive.append(png, { name });
    manifest.variants.push({ index: c.index, file: name, label: c.label, parts: c.parts, state: c.state });
    done++;
    if (done % 10 === 0) await new Promise((r) => setImmediate(r));
  }
  archive.append(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), { name: 'variants.json' });
  archive.append(Buffer.from(buildCsv(manifest), 'utf8'), { name: 'variants.csv' });
  await archive.finalize();
}

function selectCombinations(plan, indices) {
  if (!Array.isArray(indices) || !indices.length) return plan.combinations;
  const set = new Set(indices.map((v) => Number(v)).filter(Number.isFinite));
  return plan.combinations.filter((c) => set.has(c.index));
}

async function makePreviewPng(rendered, targetWidth) {
  const sharp = (await import('sharp')).default;
  const buf = await sharp(rendered.data, { raw: { width: rendered.width, height: rendered.height, channels: 4 } })
    .resize({ width: targetWidth, withoutEnlargement: true })
    .png({ compressionLevel: 6 })
    .toBuffer();
  return buf;
}

function safeVariantFilename(template, combo, ext) {
  const parts = [
    template.id,
    ...combo.parts.face ? [combo.parts.face] : [],
    ...combo.parts.body ? [combo.parts.body] : [],
    `v${String(combo.index + 1).padStart(3, '0')}`,
  ];
  const base = parts
    .join('_')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  return `${base || 'variant'}.${ext}`;
}

function buildCsv(manifest) {
  const header = ['index', 'file', 'label', 'face', 'eye', 'hair_front', 'hair_back', 'body'];
  const rows = [header.join(',')];
  for (const v of manifest.variants) {
    const p = v.parts || {};
    rows.push([
      v.index,
      csv(v.file),
      csv(v.label),
      csv(p.face ?? ''),
      csv(p.eye ?? ''),
      csv(p.hair_front ?? ''),
      csv(p.hair_back ?? ''),
      csv(p.body ?? ''),
    ].join(','));
  }
  return rows.join('\r\n');
}

function csv(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function clampInt(v, lo, hi, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}
