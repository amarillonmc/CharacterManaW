import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { decodeText } from './encoding.js';
import { iniGet, iniInt, parseIni } from './ini.js';
import { CATEGORIES, DEFAULT_CONFIG, DEFAULT_TEMPLATE_ID, LOCALES } from './constants.js';
import { normalizeColors, normalizeRgb } from './colors.js';

const IMAGE_EXT = /\.png$/i;
const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

export class TemplateError extends Error {
  constructor(message, code = 'template_error') {
    super(message);
    this.name = 'TemplateError';
    this.code = code;
  }
}

export class TemplateLibrary {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.dataRoot = path.join(baseDir, 'data');
    this.defaultRoot = path.join(this.dataRoot, DEFAULT_TEMPLATE_ID);
    this.libraryRoot = path.join(this.dataRoot, 'library');
    this.cache = new Map();
  }

  async ensureDirs() {
    await fs.mkdir(this.libraryRoot, { recursive: true });
  }

  async listTemplates({ refresh = false } = {}) {
    if (refresh) this.cache.clear();
    const out = [];
    const defaultTemplate = await this.tryLoad(this.defaultRoot, DEFAULT_TEMPLATE_ID, true);
    if (defaultTemplate) out.push(defaultTemplate);
    let entries = [];
    try {
      entries = await fs.readdir(this.libraryRoot, { withFileTypes: true });
    } catch {
      entries = [];
    }
    entries.sort((a, b) => collator.compare(a.name, b.name));
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
      const t = await this.tryLoad(path.join(this.libraryRoot, ent.name), ent.name, false);
      if (t) out.push(t);
    }
    return out;
  }

  async tryLoad(dir, id, bundled) {
    try {
      return await this.loadTemplate(dir, id, bundled);
    } catch (err) {
      const warning = err?.message || String(err);
      const broken = {
        id,
        name: id,
        bundled,
        dir,
        error: warning,
        size: { x: 300, y: 400 },
        categories: {},
        parts: {},
        colors: {},
        defaults: { parts: {}, colors: {} },
        readme: '',
        warnings: [warning],
        broken: true,
      };
      broken.public = {
        id,
        name: id,
        bundled: !!bundled,
        size: { x: 300, y: 400 },
        encoding: null,
        categories: {},
        defaults: { parts: {}, colors: {} },
        readme: '',
        warnings: [warning],
        error: warning,
      };
      return broken;
    }
  }

  async getTemplate(id, { refresh = false } = {}) {
    if (refresh) this.cache.delete(id);
    if (this.cache.has(id)) {
      const entry = this.cache.get(id);
      if (entry && !entry.broken) return entry;
    }
    if (id === DEFAULT_TEMPLATE_ID) {
      const t = await this.loadTemplate(this.defaultRoot, DEFAULT_TEMPLATE_ID, true);
      this.cache.set(id, t);
      return t;
    }
    const safe = sanitizeId(id);
    if (!safe || safe !== id) throw new TemplateError('Invalid template id.', 'invalid_id');
    const dir = path.join(this.libraryRoot, safe);
    const t = await this.loadTemplate(dir, safe, false);
    this.cache.set(id, t);
    return t;
  }

  async loadTemplate(dir, id, bundled) {
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat || !stat.isDirectory()) throw new TemplateError(`Template directory not found: ${id}`, 'not_found');
    const iniFile = await this.findFileCaseInsensitive(dir, 'character.ini');
    if (!iniFile) throw new TemplateError('character.ini was not found.', 'missing_character_ini');
    const iniBuf = await fs.readFile(iniFile);
    const decoded = decodeText(iniBuf);
    const ini = parseIni(decoded.text);
    const sizeX = positiveInt(iniInt(ini, 'Size', 'size_x', 0), 300);
    const sizeY = positiveInt(iniInt(ini, 'Size', 'size_y', 0), 400);

    const categories = {};
    for (const def of CATEGORIES) {
      categories[def.id] = await this.scanCategory(dir, def);
    }

    const defaultParts = {};
    for (const def of CATEGORIES) {
      const raw = iniGet(ini, 'Parts', def.id, '').trim();
      if (def.multiple) {
        defaultParts[def.id] = raw
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
          .filter((name) => categories[def.id].parts.some((p) => p.name === name));
      } else {
        const names = categories[def.id].parts.map((p) => p.name);
        defaultParts[def.id] = names.includes(raw) ? raw : names[0] ?? '';
      }
    }

    // Normalize defaults immediately so ver-2 palettes 9/10 are converted to
    // their ver-3 custom-colour equivalents before the public template is sent
    // to the browser.
    const defaultColors = normalizeColors({
      hair: parseDefaultColor(ini, 'hair'),
      eye: parseDefaultColor(ini, 'eye'),
      body: parseDefaultColor(ini, 'body'),
      skin: parseDefaultSkin(ini),
      bg: normalizeRgb(iniGet(ini, 'Color', 'bg_rgb', '255,255,255'), [255, 255, 255]),
    });

    const readme = await this.readReadme(dir);
    const warnings = [];
    if (decoded.encoding !== 'cp932' && decoded.encoding !== 'utf-8') {
      warnings.push(`character.ini decoded as ${decoded.encoding}`);
    }
    for (const def of CATEGORIES) {
      if (!categories[def.id].parts.length) {
        warnings.push(`No parts in ${def.id}`);
      }
    }

    const internal = {
      id,
      name: id,
      displayName: iniGet(ini, 'Character', 'name', '').trim() || id,
      bundled,
      dir,
      size: { x: sizeX, y: sizeY },
      encoding: decoded.encoding,
      categories,
      parts: defaultParts,
      colors: defaultColors,
      defaults: {
        parts: defaultParts,
        colors: defaultColors,
      },
      readme,
      warnings,
      iniText: decoded.text,
      config: { ...DEFAULT_CONFIG },
    };
    internal.public = publicTemplate(internal);
    return internal;
  }

  async scanCategory(rootDir, def) {
    const baseDir = await findDirCaseInsensitive(rootDir, def.listLayer);
    const result = {
      id: def.id,
      listLayer: def.listLayer,
      layers: def.layers.slice(),
      parts: [],
      names: [],
      optional: def.optional ?? true,
      multiple: !!def.multiple,
      hasBase: !!baseDir,
      special: {},
    };
    if (!baseDir) return result;

    const files = await listPngFiles(baseDir);
    // Map by stem, case-insensitive.  Windows treats A.png and A.PNG as
    // distinct names; the original app would list both.  We keep the first
    // one for a stable, portable model.
    const byStem = new Map();
    for (const f of files) {
      const stem = f.name.replace(IMAGE_EXT, '');
      const key = stem.toLowerCase();
      if (!byStem.has(key)) {
        byStem.set(key, { name: stem, file: f.name, stem, key });
      }
    }
    const entries = Array.from(byStem.values()).sort((a, b) => collator.compare(a.file, b.file));
    entries.forEach((entry, index) => {
      entry.index = index;
      entry.markers = markersForName(entry.name);
      entry.layers = {};
    });

    // Optional folders are resolved by exact stem.  A missing optional layer
    // simply means that this part does not contribute an image there.
    for (const layerId of def.layers) {
      const layerDir = await findDirCaseInsensitive(rootDir, layerId);
      if (!layerDir) continue;
      const layerFiles = await listPngFiles(layerDir);
      const layerByStem = new Map();
      for (const f of layerFiles) {
        const stem = f.name.replace(IMAGE_EXT, '');
        const key = stem.toLowerCase();
        if (!layerByStem.has(key)) layerByStem.set(key, f);
      }
      for (const entry of entries) {
        const f = layerByStem.get(entry.key);
        if (f) entry.layers[layerId] = f.name;
      }
    }
    result.parts = entries;
    result.names = entries.map((e) => e.name);
    if (def.id === 'eye') {
      result.special.eyeColorFolder = !!(await findDirCaseInsensitive(rootDir, 'eye_color'));
    }
    return result;
  }

  async readReadme(dir) {
    const candidates = ['readme.txt', 'readme', 'README.txt', 'README'];
    for (const name of candidates) {
      const p = await this.findFileCaseInsensitive(dir, name);
      if (!p) continue;
      try {
        const buf = await fs.readFile(p);
        if (!buf.length) continue;
        return decodeText(buf).text;
      } catch {
        // ignore
      }
    }
    return '';
  }

  async findFileCaseInsensitive(dir, wanted) {
    const files = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const lower = wanted.toLowerCase();
    const found = files.find((e) => e.isFile() && e.name.toLowerCase() === lower);
    return found ? path.join(dir, found.name) : null;
  }

  async importFromDirectory(sourceDir, { id, copy = true } = {}) {
    const src = path.resolve(sourceDir);
    const st = await fs.stat(src).catch(() => null);
    if (!st || !st.isDirectory()) throw new TemplateError('Source directory not found.', 'source_not_found');
    const ini = await this.findFileCaseInsensitive(src, 'character.ini');
    if (!ini) throw new TemplateError('The selected folder does not contain character.ini.', 'missing_character_ini');
    await this.ensureDirs();
    let safe = sanitizeId(id || path.basename(src)) || `template-${Date.now()}`;
    if (safe === DEFAULT_TEMPLATE_ID) safe = `${safe}-imported`;
    let dest = path.join(this.libraryRoot, safe);
    let n = 1;
    while (fsSync.existsSync(dest)) {
      safe = `${sanitizeId(id || path.basename(src)) || 'template'}-${n++}`;
      dest = path.join(this.libraryRoot, safe);
    }
    if (path.resolve(dest).startsWith(`${path.resolve(src)}${path.sep}`)) {
      throw new TemplateError('Destination directory is inside the source directory.', 'unsafe_destination');
    }
    if (copy) {
      await fs.cp(src, dest, {
        recursive: true,
        force: false,
        errorOnExist: true,
        filter: (p) => {
          const rel = path.relative(src, p);
          if (!rel) return true;
          const base = path.basename(rel);
          if (base === '.git' || base === 'node_modules' || base === '.DS_Store') return false;
          return true;
        },
      });
    } else {
      throw new TemplateError('Linking external directories is not enabled.', 'not_supported');
    }
    this.cache.delete(safe);
    return this.getTemplate(safe, { refresh: true });
  }

  async importFiles(files, { id, relativePaths = [] } = {}) {
    await this.ensureDirs();
    // Browsers send webkitRelativePath values with the selected folder at the
    // front.  If every uploaded path shares that prefix, strip it so files
    // land directly in the template root.  Direct API callers that already
    // use root-relative paths are unaffected.
    if (Array.isArray(relativePaths) && relativePaths.length) {
      const normalized = relativePaths.map((p) => String(p ?? '').replaceAll('\\', '/').replace(/^\/+/, ''));
      const roots = normalized.map((p) => p.split('/')[0]);
      if (roots.every((r) => r === roots[0]) && normalized.some((p) => p.includes('/'))) {
        relativePaths = normalized.map((p) => p.split('/').slice(1).join('/'));
      }
    }
    const safeBase = sanitizeId(id) || `upload-${Date.now()}`;
    let safe = safeBase === DEFAULT_TEMPLATE_ID ? `${safeBase}-imported` : safeBase;
    let dest = path.join(this.libraryRoot, safe);
    let n = 1;
    while (fsSync.existsSync(dest)) {
      safe = `${safeBase}-${n++}`;
      dest = path.join(this.libraryRoot, safe);
    }
    await fs.mkdir(dest, { recursive: true });
    let hasIni = false;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const rel = normalizeUploadPath(relativePaths[i] || file.originalname || file.filename);
        if (!rel) continue;
        const target = path.join(dest, rel);
        const relCheck = path.relative(dest, target);
        if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
          throw new TemplateError('Unsafe upload path.', 'unsafe_path');
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        await moveFile(file.path, target);
        if (path.basename(rel).toLowerCase() === 'character.ini') hasIni = true;
      }
      if (!hasIni) {
        const found = await this.findFileCaseInsensitive(dest, 'character.ini');
        if (!found) throw new TemplateError('Uploaded template does not contain character.ini.', 'missing_character_ini');
      }
    } catch (err) {
      await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
    this.cache.delete(safe);
    return this.getTemplate(safe, { refresh: true });
  }

  async deleteTemplate(id) {
    const safe = sanitizeId(id);
    if (!safe || safe === DEFAULT_TEMPLATE_ID) throw new TemplateError('The bundled default template cannot be deleted.', 'protected');
    const dir = path.join(this.libraryRoot, safe);
    if (!fsSync.existsSync(dir)) throw new TemplateError('Template not found.', 'not_found');
    await fs.rm(dir, { recursive: true, force: true });
    this.cache.delete(safe);
    return true;
  }
}

function publicTemplate(t) {
  const categories = {};
  for (const def of CATEGORIES) {
    const c = t.categories[def.id];
    categories[def.id] = {
      id: def.id,
      label: def.label,
      names: c?.names ?? [],
      layers: c?.layers ?? def.layers,
      hasBase: !!c?.hasBase,
      multiple: !!def.multiple,
      special: c?.special ?? {},
    };
  }
  return {
    id: t.id,
    name: t.displayName || t.name,
    bundled: !!t.bundled,
    size: t.size,
    encoding: t.encoding,
    categories,
    defaults: {
      parts: t.defaults.parts,
      colors: t.defaults.colors,
    },
    readme: t.readme,
    warnings: t.warnings,
  };
}

function parseDefaultColor(ini, prefix) {
  const palette = iniInt(ini, 'Color', `${prefix}_rgb`, 0);
  const gray = iniInt(ini, 'Color', `${prefix}_gray`, 3);
  const raw = iniGet(ini, 'Color', `custom_${prefix}_rgb`, '');
  const nums = raw ? raw.split(',').map((v) => Number.parseInt(v.trim(), 10)) : [];
  const custom = nums.length >= 4 && nums.slice(0, 4).every(Number.isFinite)
    ? { r: clamp(nums[0], 0, 255), g: clamp(nums[1], 0, 255), b: clamp(nums[2], 0, 255), w: clamp(nums[3], 0, 100) }
    : { r: 64, g: 64, b: 64, w: 50 };
  return {
    palette: clamp(palette, 0, 10),
    gray: clamp(gray, 0, 6),
    custom,
  };
}

function parseDefaultSkin(ini) {
  return {
    palette: clamp(iniInt(ini, 'Color', 'skin_rgb', 0), 0, 5),
    gray: clamp(iniInt(ini, 'Color', 'skin_gray', 3), 0, 6),
  };
}

async function findDirCaseInsensitive(rootDir, wanted) {
  const lower = wanted.toLowerCase();
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const found = entries.find((e) => e.isDirectory() && e.name.toLowerCase() === lower);
  return found ? path.join(rootDir, found.name) : null;
}

async function listPngFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && IMAGE_EXT.test(e.name))
    .map((e) => ({ name: e.name }))
    .sort((a, b) => collator.compare(a.name, b.name));
}

function markersForName(name) {
  const out = [];
  if (/[（(]髪[）)]/.test(name)) out.push('hair');
  if (/[（(]瞳[）)]/.test(name)) out.push('eye');
  if (/[（(]肌[）)]/.test(name)) out.push('skin');
  if (/[（(]服[）)]/.test(name)) out.push('body');
  return out;
}

export function sanitizeId(id) {
  const value = String(id ?? '').trim();
  if (!value) return '';
  if (value === '.' || value === '..') return '';
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(value)) return '';
  if (value.length > 120) return '';
  return value;
}

function normalizeUploadPath(p) {
  const s = String(p ?? '').replaceAll('\\', '/');
  const parts = s.split('/').filter((x) => x && x !== '.');
  if (parts.some((x) => x === '..')) return '';
  return parts.join('/');
}

async function moveFile(src, dest) {
  try {
    await fs.rename(src, dest);
  } catch (err) {
    if (err?.code === 'EXDEV') {
      await fs.copyFile(src, dest);
      await fs.unlink(src).catch(() => {});
    } else {
      throw err;
    }
  }
}

function positiveInt(v, fallback) {
  return Number.isFinite(v) && v > 0 ? Math.min(4096, Math.trunc(v)) : fallback;
}

function clamp(v, lo, hi) {
  const n = Number.isFinite(+v) ? Math.trunc(+v) : lo;
  return Math.max(lo, Math.min(hi, n));
}

export function listLocaleLabels() {
  return LOCALES.slice();
}
