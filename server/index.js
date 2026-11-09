import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TemplateLibrary, TemplateError, sanitizeId } from './templates.js';
import { normalizeState, stateFromCpd, stateToCpd, defaultState } from './state.js';
import { renderCharacter, renderPartThumbnail, RenderError } from './render.js';
import { encodePng, encodePngRgb, encodeBmp24, encodeJpeg, encodeGif, encodePna, encodeSurfacePng, flattenToRgb } from './image.js';
import { buildCpd, parseCpd } from './cpd.js';
import { generatePrompt, LlmError } from './llm.js';
import { planVariants, renderVariantPreviews, exportVariantZip, MAX_VARIANT_COMBINATIONS } from './variants.js';
import { APP_NAME, APP_VERSION, DEFAULT_CONFIG, DEFAULT_TEMPLATE_ID, LOCALES, ANTIALIASING_THRESHOLD } from './constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseDir = path.resolve(__dirname, '..');
const webDir = path.join(baseDir, 'web');
const tmpDir = path.join(baseDir, 'data', 'tmp');
await fs.mkdir(tmpDir, { recursive: true });

const library = new TemplateLibrary(baseDir);
await library.ensureDirs();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);
app.use(express.json({ limit: '16mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

const upload = multer({
  dest: tmpDir,
  limits: { fileSize: 64 * 1024 * 1024, files: 20000, fields: 20, fieldSize: 16 * 1024 * 1024 },
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: APP_NAME, version: APP_VERSION, uptime: process.uptime() });
});

app.get('/api/config', (req, res) => {
  res.json({
    appName: APP_NAME,
    version: APP_VERSION,
    defaultTemplateId: DEFAULT_TEMPLATE_ID,
    locales: LOCALES,
    config: DEFAULT_CONFIG,
    maxVariants: MAX_VARIANT_COMBINATIONS,
    antialiasThresholds: ANTIALIASING_THRESHOLD,
    allowLocalImport: allowLocalImport(req),
    llm: {
      providers: [
        { id: 'openai', label: 'OpenAI compatible', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
        { id: 'anthropic', label: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com', defaultModel: 'claude-3-5-sonnet-latest' },
        { id: 'gemini', label: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.0-flash' },
      ],
      targets: [
        { id: 'gpt-image', label: 'GPT-Image' },
        { id: 'nano-banana', label: 'Nano Banana' },
        { id: 'z-image', label: 'Z-Image' },
        { id: 'anima', label: 'Anima' },
        { id: 'lumina', label: 'Lumina' },
        { id: 'generic', label: 'Generic' },
      ],
    },
  });
});

app.get('/api/templates', async (req, res, next) => {
  try {
    const list = await library.listTemplates({ refresh: req.query.refresh === '1' });
    res.json({ templates: list.map((t) => t.public ?? t) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/templates/:id', async (req, res, next) => {
  try {
    const t = await library.getTemplate(req.params.id);
    res.json({ template: t.public });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/templates/:id', async (req, res, next) => {
  try {
    await library.deleteTemplate(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/templates/import', async (req, res, next) => {
  try {
    if (!allowLocalImport(req)) throw new HttpError(403, 'Local path import is disabled.', 'local_import_disabled');
    const source = String(req.body?.path ?? '').trim();
    if (!source) throw new HttpError(400, 'Missing path.', 'missing_path');
    const t = await library.importFromDirectory(source, { id: req.body?.id });
    res.json({ template: t.public });
  } catch (err) {
    next(err);
  }
});

app.post('/api/templates/upload', upload.array('files', 20000), async (req, res, next) => {
  let files = [];
  try {
    files = req.files || [];
    if (!files.length) throw new HttpError(400, 'No files uploaded.', 'no_files');
    let relativePaths = req.body?.relativePaths;
    if (typeof relativePaths === 'string') {
      try {
        relativePaths = JSON.parse(relativePaths);
      } catch {
        relativePaths = null;
      }
    }
    if (!Array.isArray(relativePaths)) relativePaths = files.map((f) => f.originalname);
    const t = await library.importFiles(files, {
      id: req.body?.id || req.body?.relativeRoot,
      relativePaths,
    });
    res.json({ template: t.public });
  } catch (err) {
    next(err);
  } finally {
    cleanupTmp(files);
  }
});

app.get('/api/templates/:id/thumb/:category/:name', async (req, res, next) => {
  try {
    const t = await library.getTemplate(req.params.id);
    const category = req.params.category;
    const name = req.params.name;
    const target = clampInt(req.query.w, 32, 256, 96);
    const png = await renderPartThumbnail(t, category, name, t.defaults.colors, target);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(png);
  } catch (err) {
    next(err);
  }
});

app.post('/api/render', async (req, res, next) => {
  try {
    const template = await resolveTemplate(req);
    const state = normalizeState(template, req.body?.state ?? req.body);
    const mode = req.body?.mode === 'alpha' ? 'alpha' : 'normal';
    const rendered = await renderCharacter(template, state, { mode, tone: 2 });
    const png = mode === 'alpha'
      ? encodePng(rendered.data, rendered.width, rendered.height)
      : encodePngRgb(rendered.data, rendered.width, rendered.height);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Layer-Count', String(rendered.layers.length));
    res.send(png);
  } catch (err) {
    next(err);
  }
});

app.post('/api/export', async (req, res, next) => {
  try {
    const template = await resolveTemplate(req);
    const state = normalizeState(template, req.body?.state ?? req.body);
    const transparent = !!req.body?.transparent;
    const ukagaka = !!req.body?.ukagaka;
    const format = String(req.body?.format || (ukagaka ? 'ukagaka' : 'png')).toLowerCase();
    const alphaMode = (transparent && format === 'png') || format === 'pna' || ukagaka || format === 'ukagaka' || format === 'surface';
    const mode = alphaMode ? 'alpha' : 'normal';
    const rendered = await renderCharacter(template, state, { mode, tone: 2 });
    let data = rendered.data;
    let width = rendered.width;
    let height = rendered.height;
    const scale = clampInt(req.body?.scale, 1, 8, 1);
    if (scale !== 1) {
      const sharp = (await import('sharp')).default;
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      data = await sharp(data, { raw: { width: rendered.width, height: rendered.height, channels: 4 } })
        .resize({ width, height, kernel: 'nearest' })
        .ensureAlpha()
        .raw()
        .toBuffer();
    }
    const bg = state.colors.bg;
    const baseName = exportBaseName(template, req.body?.filename, format);

    if (ukagaka || format === 'ukagaka' || format === 'surface') {
      const level = clampInt(req.body?.antialias, 0, 5, DEFAULT_CONFIG.no_antialiasing);
      const threshold = ANTIALIASING_THRESHOLD[level];
      const surface = await encodeSurfacePng(data, width, height, threshold);
      const pna = await encodePna(data, width, height);
      const zipName = `${baseName}_ukagaka.zip`;
      const archive = (await import('archiver')).default('zip', { zlib: { level: 6 } });
      res.setHeader('Content-Type', 'application/zip');
      sendAttachment(res, zipName, 'application/zip');
      archive.on('error', (err) => res.destroy(err));
      archive.pipe(res);
      archive.append(surface.buffer, { name: `${baseName}_surface.png` });
      archive.append(pna, { name: `${baseName}_surface.pna` });
      archive.append(encodePng(data, width, height), { name: `${baseName}_surface_rgba.png` });
      archive.append(JSON.stringify({ colorKey: surface.key, width, height, threshold }, null, 2), { name: `${baseName}_surface.json` });
      await archive.finalize();
      return;
    }

    let body;
    let mime;
    let ext;
    switch (format) {
      case 'bmp':
        body = encodeBmp24(data, width, height);
        mime = 'image/bmp'; ext = 'bmp';
        break;
      case 'jpg':
      case 'jpeg':
        body = await encodeJpeg(data, width, height, clampInt(req.body?.quality, 1, 100, DEFAULT_CONFIG.jpeg_quality), bg);
        mime = 'image/jpeg'; ext = 'jpg';
        break;
      case 'gif':
        body = await encodeGif(data, width, height, bg);
        mime = 'image/gif'; ext = 'gif';
        break;
      case 'pna':
        body = await encodePna(data, width, height);
        mime = 'image/png'; ext = 'pna';
        break;
      case 'png':
      default:
        body = transparent ? encodePng(data, width, height) : encodePngRgb(data, width, height);
        mime = 'image/png'; ext = 'png';
        break;
    }
    res.setHeader('Content-Type', mime);
    sendAttachment(res, `${baseName}.${ext}`, mime);
    res.send(body);
  } catch (err) {
    next(err);
  }
});

app.post('/api/cpd/export', async (req, res, next) => {
  try {
    const template = await resolveTemplate(req);
    const state = normalizeState(template, req.body?.state ?? req.body);
    const cpd = buildCpd({
      templateId: template.id,
      parts: state.parts,
      colors: stateToCpd(template, state).colors,
    });
    const name = `${safeFilename(template.id)}.cpd`;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-CPD-Encoding', cpd.encoding);
    res.setHeader('X-CPD-Lossy', cpd.lossy ? '1' : '0');
    sendAttachment(res, name, 'application/octet-stream');
    res.send(cpd.buffer);
  } catch (err) {
    next(err);
  }
});

const cpdUpload = multer({ dest: tmpDir, limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
app.post('/api/cpd/import', cpdUpload.single('file'), async (req, res, next) => {
  try {
    const template = await resolveTemplate(req);
    if (!req.file) throw new HttpError(400, 'No .cpd file uploaded.', 'no_file');
    const buf = await fs.readFile(req.file.path);
    const cpd = parseCpd(buf);
    const state = stateFromCpd(template, cpd);
    res.json({
      state,
      name: cpd.name,
      encoding: cpd.encoding,
      warnings: cpd.warnings,
      parts: cpd.parts,
    });
  } catch (err) {
    next(err);
  } finally {
    if (req.file) fs.unlink(req.file.path).catch(() => {});
  }
});

app.get('/api/state/default/:id', async (req, res, next) => {
  try {
    const t = await library.getTemplate(req.params.id);
    res.json({ state: defaultState(t) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/variants/plan', async (req, res, next) => {
  try {
    const template = await resolveTemplate(req);
    const state = normalizeState(template, req.body?.state ?? req.body);
    const plan = planVariants(template, state, req.body);
    res.json({
      axes: plan.axes,
      values: plan.values,
      count: plan.count,
      truncated: plan.truncated,
      limit: plan.limit,
      warnings: plan.warnings,
      combinations: plan.combinations.map((c) => ({ index: c.index, parts: c.parts, label: c.label })),
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/variants/preview', async (req, res, next) => {
  try {
    const template = await resolveTemplate(req);
    const state = normalizeState(template, req.body?.state ?? req.body);
    const result = await renderVariantPreviews(template, state, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/variants/export', async (req, res, next) => {
  try {
    const template = await resolveTemplate(req);
    const state = normalizeState(template, req.body?.state ?? req.body);
    res.setHeader('Content-Type', 'application/zip');
    sendAttachment(res, `${safeFilename(template.id)}_variants.zip`, 'application/zip');
    await exportVariantZip(res, template, state, req.body);
  } catch (err) {
    if (!res.headersSent) next(err);
    else res.destroy(err);
  }
});

app.post('/api/llm/prompt', async (req, res, next) => {
  try {
    const template = await resolveTemplate(req);
    const state = normalizeState(template, req.body?.state ?? req.body);
    const description = String(req.body?.description ?? '').slice(0, 5000);
    const result = await generatePrompt({
      provider: req.body?.provider,
      apiKey: req.body?.apiKey,
      baseUrl: req.body?.baseUrl,
      model: req.body?.model,
      temperature: req.body?.temperature,
      maxTokens: req.body?.maxTokens,
      target: req.body?.target,
      language: req.body?.language,
      description,
      image: req.body?.image,
      state,
      template: template.public,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.use(express.static(webDir, {
  extensions: ['html'],
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
}));

app.get('*', async (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(webDir, 'index.html'));
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err?.status || statusForError(err);
  const code = err?.code || 'error';
  const message = String(err?.message || 'Internal error');
  if (status >= 500) {
    console.error('[error]', req.method, req.path, err?.stack || err);
  }
  res.status(status).json({ error: { code, message } });
});

const port = clampInt(process.env.PORT, 1, 65535, 8787);
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => {
  console.log(`${APP_NAME} v${APP_VERSION}`);
  console.log(`Listening on http://${host}:${port}`);
  console.log(`Bundled template: data/default`);
});
server.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exitCode = 1;
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
async function shutdown(signal) {
  console.log(`\n${signal}: shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
}

async function resolveTemplate(req) {
  const id = req.params?.id || req.body?.templateId || req.body?.state?.templateId || req.query?.templateId || DEFAULT_TEMPLATE_ID;
  return library.getTemplate(id);
}

function allowLocalImport(req) {
  if (process.env.ALLOW_LOCAL_IMPORT === '1') return true;
  if (process.env.ALLOW_LOCAL_IMPORT === '0') return false;
  const addr = req.socket?.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function cleanupTmp(files) {
  for (const f of files || []) {
    if (f?.path) fs.unlink(f.path).catch(() => {});
  }
}

function sendAttachment(res, filename, mime) {
  const ascii = String(filename).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`);
  res.setHeader('Content-Type', mime);
}

function exportBaseName(template, requested, format) {
  if (requested && String(requested).trim()) return safeFilename(String(requested).replace(/\.[a-z0-9]+$/i, ''));
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_');
  return `${safeFilename(template.id)}_${stamp}`;
}

function safeFilename(name) {
  return String(name || 'character')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'character';
}

function statusForError(err) {
  if (err instanceof TemplateError) return err.code === 'not_found' ? 404 : 400;
  if (err instanceof RenderError) return 400;
  if (err instanceof LlmError) return ['missing_key', 'invalid_image', 'invalid_base_url'].includes(err.code) ? 400 : 502;
  if (err instanceof HttpError) return err.status;
  if (err?.name === 'MulterError') return 400;
  return 500;
}

class HttpError extends Error {
  constructor(status, message, code = 'http_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function clampInt(v, lo, hi, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}

export { app, library, server };
