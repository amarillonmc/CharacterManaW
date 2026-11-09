import { I18N, detectLanguage, t, applyI18n } from './i18n.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clone = (v) => JSON.parse(JSON.stringify(v));
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  config: null,
  templates: [],
  template: null,
  current: null,
  startupState: null,
  lang: detectLanguage(),
  theme: localStorage.getItem('cnw:theme') || 'light',
  activeCategory: 'hair_front',
  search: '',
  partsLimit: 250,
  zoom: 1,
  fit: true,
  previewTransparent: false,
  renderTimer: null,
  renderAbort: null,
  previewUrl: null,
  lastRenderState: null,
  randomOptions: loadJson('cnw:randomOptions', { hair: 1, head: 0, face: 1, eye: 1, body: 1, accessory: 0, color: 1, custom: 0 }),
  llm: loadJson('cnw:llm', {}),
  variant: { axes: ['face', 'body'], values: {}, plan: null, items: [], selected: new Set(), previewed: false },
  pickedFiles: [],
  importing: false,
  templateRequest: 0,
  promptImage: null,
  promptImageStatus: '',
  promptImageRequest: 0,
};

const els = {};
const CATEGORY_ORDER = ['hair_front', 'hair_back', 'head', 'face', 'eye', 'body', 'accessory'];
const COLOR_KEYS = ['hair', 'eye', 'skin', 'body'];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheEls();
  applyTheme();
  bindStaticEvents();
  populateLanguage();
  applyI18n(document, state.lang);
  try {
    state.config = await api('/api/config');
    populateLlmOptions();
    await loadTemplates();
    const saved = localStorage.getItem('cnw:lastTemplate');
    const pick = state.templates.find((t) => t.id === saved && !t.error) || state.templates.find((t) => !t.error) || state.templates[0];
    if (pick) await selectTemplate(pick.id);
  } catch (err) {
    showToast(err.message || t(state.lang, 'networkError'), 'error');
  }
}

function cacheEls() {
  const ids = [
    'brandSub', 'templateSelect', 'importBtn', 'infoBtn', 'languageSelect', 'themeBtn',
    'categoryTabs', 'partsSearch', 'partsCount', 'partsList', 'partsMoreWrap', 'partsMoreBtn',
    'accessoryDock', 'accessoryCount', 'accessoryList', 'partsHint',
    'zoomOut', 'zoomIn', 'zoomLabel', 'zoomFit', 'flipBtn', 'transparentPreviewBtn', 'randomBtn', 'resetBtn',
    'stageViewport', 'checker', 'previewImage', 'renderSpinner', 'renderStatus', 'canvasSize', 'layerCount',
    'colorSections', 'eyeLayerToggle', 'faceLayerToggle', 'bgColor', 'accessoryMax', 'randomOptionsBtn',
    'loadCpdBtn', 'saveCpdBtn', 'variantsBtn', 'promptBtn', 'exportBtn', 'templateMeta',
    'cpdFileInput', 'templateFilesInput', 'toasts',
    'exportDialog', 'exportForm', 'exportFormat', 'exportScale', 'exportQuality', 'exportAntialias', 'antialiasRow',
    'exportFilename', 'exportTransparent', 'exportNote', 'exportSubmit', 'qualityRow',
    'variantsDialog', 'variantsClose', 'variantsCancel', 'variantAxes', 'variantPlanBtn', 'variantPlanInfo',
    'variantValues', 'variantPreviewBtn', 'variantSelectAll', 'variantSelectNone', 'variantGrid', 'variantStatus',
    'variantExportBtn', 'variantExportAllBtn', 'variantSelectionInfo',
    'promptDialog', 'promptClose', 'promptCancel', 'llmProvider', 'llmModel', 'llmBaseUrl', 'llmApiKey',
    'llmTarget', 'llmLanguage', 'llmDescription', 'llmRememberKey', 'llmTemperature', 'llmMaxTokens',
    'llmGenerate', 'llmStatus', 'llmPromptOut', 'llmNegativeOut', 'llmTagsOut', 'llmNotesOut', 'llmDownload',
    'llmUsePreview', 'llmPreviewImg', 'llmPreviewStatus',
    'importDialog', 'importClose', 'importCancel', 'pickFolderBtn', 'uploadFolderBtn', 'pickedFolderInfo',
    'importPath', 'importId', 'importPathBtn', 'importStatus', 'deleteTemplateBtn', 'importFolderPane', 'importPathPane',
    'infoDialog', 'infoClose', 'infoClose2', 'infoMeta', 'infoReadme', 'creditsText', 'creditsBtn',
    'randomDialog', 'randomClose', 'randomCancel', 'randomOptions', 'randomGo', 'randomOptionsBtn',
  ];
  for (const id of ids) els[id] = document.getElementById(id);
}

function bindStaticEvents() {
  els.languageSelect.addEventListener('change', () => switchLanguage(els.languageSelect.value));
  els.themeBtn.addEventListener('click', toggleTheme);
  els.templateSelect.addEventListener('change', () => selectTemplate(els.templateSelect.value));
  els.importBtn.addEventListener('click', openImportDialog);
  els.infoBtn.addEventListener('click', openInfoDialog);
  els.creditsBtn.addEventListener('click', openInfoDialog);

  els.categoryTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-category]');
    if (!btn) return;
    state.activeCategory = btn.dataset.category;
    state.search = '';
    state.partsLimit = 250;
    els.partsSearch.value = '';
    renderCategoryTabs();
    renderPartsList();
  });
  els.partsSearch.addEventListener('input', () => {
    state.search = els.partsSearch.value.trim().toLowerCase();
    state.partsLimit = 250;
    renderPartsList();
  });
  els.partsMoreBtn.addEventListener('click', () => {
    state.partsLimit += 300;
    renderPartsList();
  });
  els.partsList.addEventListener('click', onPartClick);
  els.accessoryList.addEventListener('click', onAccessoryDockClick);

  els.zoomOut.addEventListener('click', () => setZoom(state.zoom - 0.1, false));
  els.zoomIn.addEventListener('click', () => setZoom(state.zoom + 0.1, false));
  els.zoomLabel.addEventListener('click', () => setZoom(1, false));
  els.zoomFit.addEventListener('click', () => { state.fit = true; applyZoom(); });
  els.flipBtn.addEventListener('click', () => {
    state.current.options.flip = !state.current.options.flip;
    updateOptionUi();
    scheduleRender();
    saveLocalSoon();
  });
  els.transparentPreviewBtn.addEventListener('click', () => {
    state.previewTransparent = !state.previewTransparent;
    els.checker.classList.toggle('transparent', state.previewTransparent);
    els.transparentPreviewBtn.classList.toggle('primary', state.previewTransparent);
    scheduleRender();
  });
  els.randomBtn.addEventListener('click', randomizeNow);
  els.resetBtn.addEventListener('click', (e) => showResetMenu(e.currentTarget));
  els.eyeLayerToggle.addEventListener('change', () => {
    state.current.options.eyeLayer = els.eyeLayerToggle.checked;
    scheduleRender();
    saveLocalSoon();
  });
  els.faceLayerToggle.addEventListener('change', () => {
    state.current.options.faceLayer = els.faceLayerToggle.checked;
    scheduleRender();
    saveLocalSoon();
  });
  els.bgColor.addEventListener('input', () => {
    const rgb = hexToRgb(els.bgColor.value);
    state.current.colors.bg = rgb;
    scheduleRender();
    saveLocalSoon();
    updateColorSectionSwatches();
  });
  els.accessoryMax.addEventListener('change', () => {
    const max = clampInt(els.accessoryMax.value, 0, 32, 6);
    state.current.options.accessoryMax = max;
    if (state.current.parts.accessory.length > max) state.current.parts.accessory = state.current.parts.accessory.slice(0, max);
    renderAccessoryDock();
    renderPartsList();
    scheduleRender();
    saveLocalSoon();
  });
  els.randomOptionsBtn.addEventListener('click', openRandomOptions);

  els.loadCpdBtn.addEventListener('click', () => els.cpdFileInput.click());
  els.cpdFileInput.addEventListener('change', loadCpdFile);
  els.saveCpdBtn.addEventListener('click', saveCpd);
  els.exportBtn.addEventListener('click', openExportDialog);
  els.exportForm.addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.id !== 'exportSubmit') return;
    e.preventDefault();
    exportImage();
  });
  els.exportFormat.addEventListener('change', updateExportDialog);
  els.exportDialog.addEventListener('close', () => {});
  els.variantsBtn.addEventListener('click', openVariantsDialog);
  els.promptBtn.addEventListener('click', openPromptDialog);

  els.variantsClose.addEventListener('click', () => els.variantsDialog.close());
  els.variantsCancel.addEventListener('click', () => els.variantsDialog.close());
  els.variantPlanBtn.addEventListener('click', planVariants);
  els.variantPreviewBtn.addEventListener('click', previewVariants);
  els.variantSelectAll.addEventListener('click', () => {
    for (const item of state.variant.items) state.variant.selected.add(item.index);
    renderVariantGrid();
  });
  els.variantSelectNone.addEventListener('click', () => {
    state.variant.selected.clear();
    renderVariantGrid();
  });
  els.variantExportBtn.addEventListener('click', () => exportVariants(false));
  els.variantExportAllBtn.addEventListener('click', () => exportVariants(true));
  els.variantAxes.addEventListener('change', onVariantAxisChange);
  els.variantValues.addEventListener('change', onVariantValueChange);
  els.variantValues.addEventListener('click', onVariantValueTools);

  els.promptClose.addEventListener('click', () => els.promptDialog.close());
  els.promptCancel.addEventListener('click', () => els.promptDialog.close());
  els.promptDialog.addEventListener('close', () => {
    state.promptImageRequest++;
    state.promptImage = null;
    state.promptImageStatus = '';
    els.llmPreviewImg.removeAttribute('src');
  });
  els.llmProvider.addEventListener('change', () => setProviderDefaults(true));
  els.llmGenerate.addEventListener('click', generatePrompt);
  els.llmDownload.addEventListener('click', downloadPromptJson);
  document.addEventListener('click', onCopyButton);

  els.importClose.addEventListener('click', () => els.importDialog.close());
  els.importCancel.addEventListener('click', () => els.importDialog.close());
  els.importDialog.addEventListener('click', (e) => { if (e.target === els.importDialog) els.importDialog.close(); });
  els.pickFolderBtn.addEventListener('click', () => els.templateFilesInput.click());
  els.templateFilesInput.addEventListener('change', onTemplateFolderPicked);
  els.uploadFolderBtn.addEventListener('click', uploadTemplateFolder);
  els.importPathBtn.addEventListener('click', importTemplatePath);
  els.deleteTemplateBtn.addEventListener('click', deleteCurrentTemplate);
  $$('[data-import-tab]').forEach((btn) => btn.addEventListener('click', () => switchImportTab(btn.dataset.importTab)));

  els.infoClose.addEventListener('click', () => els.infoDialog.close());
  els.infoClose2.addEventListener('click', () => els.infoDialog.close());

  els.randomClose.addEventListener('click', () => els.randomDialog.close());
  els.randomCancel.addEventListener('click', () => els.randomDialog.close());
  els.randomGo.addEventListener('click', randomizeFromDialog);

  for (const d of ['exportDialog', 'variantsDialog', 'promptDialog', 'importDialog', 'infoDialog', 'randomDialog']) {
    els[d].addEventListener('click', (e) => { if (e.target === els[d]) els[d].close(); });
  }
  window.addEventListener('resize', () => { if (state.fit) applyZoom(); });
  window.addEventListener('beforeunload', saveLocalNow);
}

function populateLanguage() {
  els.languageSelect.value = state.lang;
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : state.lang;
  els.brandSub.textContent = state.lang === 'ja' ? 'ドレスアップ・スタジオ' : state.lang === 'zh' ? '换装工作室' : 'Dress-up studio';
}

function switchLanguage(lang) {
  if (!I18N[lang]) return;
  state.lang = lang;
  localStorage.setItem('cnw:language', lang);
  populateLanguage();
  applyI18n(document, lang);
  renderCategoryTabs();
  renderPartsList();
  renderAccessoryDock();
  buildColorSections();
  updateOptionUi();
  updateTemplateMeta();
  updateRenderStatus();
  populateLlmOptions();
  buildVariantAxes();
  buildVariantValues();
  updateVariantInfo();
  updatePromptPreviewStatus();
  if (state.previewUrl) els.previewImage.alt = t(lang, 'preview');
}

async function loadConfig() {
  state.config = await api('/api/config');
  populateLlmOptions();
}

async function loadTemplates() {
  const res = await api('/api/templates?refresh=1');
  state.templates = res.templates || [];
  els.templateSelect.innerHTML = '';
  for (const tmpl of state.templates) {
    const opt = document.createElement('option');
    opt.value = tmpl.id;
    opt.textContent = `${tmpl.name || tmpl.id}${tmpl.bundled ? ` · ${t(state.lang, 'bundled')}` : ''}${tmpl.error ? ' ⚠' : ''}`;
    els.templateSelect.appendChild(opt);
  }
}

async function selectTemplate(id) {
  const requestId = ++state.templateRequest;
  const meta = await api(`/api/templates/${encodeURIComponent(id)}`);
  if (requestId !== state.templateRequest) return;
  state.template = meta.template;
  state.activeCategory = state.template.categories?.hair_front?.names?.length ? 'hair_front' : firstCategory();
  state.search = '';
  state.partsLimit = 250;
  els.partsSearch.value = '';
  const saved = loadJson(`cnw:state:${id}`, null);
  state.current = normalizeClientState(state.template, saved || {
    templateId: id,
    parts: state.template.defaults.parts,
    colors: state.template.defaults.colors,
    options: { flip: false, eyeLayer: false, faceLayer: false, accessoryMax: state.template.defaults?.options?.accessoryMax ?? 6 },
  });
  state.startupState = clone(state.current);
  state.variant = { axes: ['face', 'body'].filter((a) => state.template.categories?.[a]?.names?.length), values: {}, plan: null, items: [], selected: new Set(), previewed: false };
  localStorage.setItem('cnw:lastTemplate', id);
  els.templateSelect.value = id;
  els.bgColor.value = rgbToHex(state.current.colors.bg);
  els.accessoryMax.value = String(state.current.options.accessoryMax);
  els.eyeLayerToggle.checked = !!state.current.options.eyeLayer;
  els.faceLayerToggle.checked = !!state.current.options.faceLayer;
  els.deleteTemplateBtn.hidden = !!state.template.bundled;
  els.partsSearch.placeholder = t(state.lang, 'searchParts');
  renderCategoryTabs();
  renderPartsList();
  renderAccessoryDock();
  buildColorSections();
  updateOptionUi();
  updateTemplateMeta();
  updateRenderStatus();
  scheduleRender(0);
}

function normalizeClientState(template, input) {
  const defaults = template.defaults;
  const parts = {};
  for (const cat of CATEGORY_ORDER) {
    const meta = template.categories?.[cat];
    if (!meta) continue;
    if (cat === 'accessory') {
      const list = Array.isArray(input?.parts?.accessory) ? input.parts.accessory : defaults.parts.accessory || [];
      const max = clampInt(input?.options?.accessoryMax, 0, 32, 6);
      parts.accessory = list.filter((n) => meta.names.includes(n)).slice(0, max);
    } else {
      const wanted = input?.parts?.[cat];
      parts[cat] = meta.names.includes(wanted) ? wanted : (defaults.parts[cat] || meta.names[0] || '');
    }
  }
  const colors = {
    hair: normalizeColor(input?.colors?.hair, defaults.colors.hair),
    eye: normalizeColor(input?.colors?.eye, defaults.colors.eye),
    body: normalizeColor(input?.colors?.body, defaults.colors.body),
    skin: normalizeSkin(input?.colors?.skin, defaults.colors.skin),
    bg: normalizeBg(input?.colors?.bg, defaults.colors.bg),
  };
  return {
    templateId: template.id,
    parts,
    colors,
    options: {
      flip: !!input?.options?.flip,
      eyeLayer: !!input?.options?.eyeLayer,
      faceLayer: !!input?.options?.faceLayer,
      accessoryMax: clampInt(input?.options?.accessoryMax, 0, 32, 6),
    },
  };
}

function normalizeColor(input, fallback) {
  const src = input || fallback || {};
  return {
    palette: clampInt(src.palette, 0, 8, fallback?.palette ?? 0),
    gray: clampInt(src.gray, 0, 6, fallback?.gray ?? 3),
    custom: {
      r: clampInt(src.custom?.r, 0, 128, fallback?.custom?.r ?? 64),
      g: clampInt(src.custom?.g, 0, 128, fallback?.custom?.g ?? 64),
      b: clampInt(src.custom?.b, 0, 128, fallback?.custom?.b ?? 64),
      w: clampInt(src.custom?.w, 0, 100, fallback?.custom?.w ?? 50),
    },
  };
}

function normalizeSkin(input, fallback) {
  const src = input || fallback || {};
  return {
    palette: clampInt(src.palette, 0, 5, fallback?.palette ?? 0),
    gray: clampInt(src.gray, 0, 6, fallback?.gray ?? 3),
  };
}

function normalizeBg(input, fallback) {
  if (Array.isArray(input) && input.length >= 3) return input.slice(0, 3).map((v) => clampInt(v, 0, 255, 255));
  if (typeof input === 'string') return hexToRgb(input);
  return (fallback || [255, 255, 255]).slice();
}

function firstCategory() {
  return CATEGORY_ORDER.find((c) => state.template.categories?.[c]?.names?.length) || 'hair_front';
}

/* ---------------- parts ---------------- */

function renderCategoryTabs() {
  els.categoryTabs.innerHTML = '';
  for (const id of CATEGORY_ORDER) {
    const meta = state.template?.categories?.[id];
    if (!meta) continue;
    const btn = document.createElement('button');
    btn.className = `tab${id === state.activeCategory ? ' active' : ''}`;
    btn.dataset.category = id;
    btn.innerHTML = `${escapeHtml(labelForCategory(id))}<span class="tab-count">${meta.names.length}</span>`;
    els.categoryTabs.appendChild(btn);
  }
}

function renderPartsList() {
  if (!state.template || !state.current) return;
  const category = state.activeCategory;
  const meta = state.template.categories?.[category];
  if (!meta) {
    els.partsList.innerHTML = `<div class="empty-note">${escapeHtml(t(state.lang, 'categoryEmpty'))}</div>`;
    return;
  }
  const all = meta.names;
  const filtered = state.search ? all.filter((n) => n.toLowerCase().includes(state.search)) : all;
  const shown = filtered.slice(0, state.partsLimit);
  els.partsCount.textContent = state.search ? `${filtered.length}/${all.length}` : String(all.length);
  els.partsMoreWrap.hidden = filtered.length <= shown.length;
  els.partsList.innerHTML = '';
  if (!shown.length) {
    els.partsList.innerHTML = `<div class="empty-note">${escapeHtml(t(state.lang, 'noResults'))}</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  const selectedAccessories = new Set(state.current.parts.accessory);
  for (const name of shown) {
    const active = category === 'accessory'
      ? selectedAccessories.has(name)
      : state.current.parts[category] === name;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `part-item${active ? ' active selected' : ''}${category === 'accessory' ? ' is-accessory' : ''}`;
    btn.dataset.category = category;
    btn.dataset.name = name;
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', String(active));
    const img = document.createElement('img');
    img.className = 'part-thumb';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.src = `/api/templates/${encodeURIComponent(state.template.id)}/thumb/${encodeURIComponent(category)}/${encodeURIComponent(name)}?w=72`;
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
    const span = document.createElement('span');
    span.className = 'part-name';
    span.textContent = name;
    span.title = name;
    const check = document.createElement('span');
    check.className = 'part-check';
    check.textContent = '✓';
    btn.append(img, span, check);
    frag.appendChild(btn);
  }
  els.partsList.appendChild(frag);
}

function onPartClick(e) {
  const btn = e.target.closest('.part-item');
  if (!btn) return;
  const category = btn.dataset.category;
  const name = btn.dataset.name;
  if (!category || !name) return;
  if (category === 'accessory') {
    const list = state.current.parts.accessory;
    const idx = list.indexOf(name);
    if (idx >= 0) list.splice(idx, 1);
    else {
      if (list.length >= state.current.options.accessoryMax) {
        showToast(t(state.lang, 'accessoryLimit', { max: state.current.options.accessoryMax }), 'error');
        return;
      }
      list.push(name);
    }
    renderPartsList();
    renderAccessoryDock();
  } else {
    state.current.parts[category] = name;
    $$('.part-item', els.partsList).forEach((el) => {
      if (el.dataset.category !== category) return;
      const active = el.dataset.name === name;
      el.classList.toggle('active', active);
      el.setAttribute('aria-selected', String(active));
    });
  }
  scheduleRender();
  saveLocalSoon();
}

function renderAccessoryDock() {
  if (!state.current) return;
  const list = state.current.parts.accessory;
  els.accessoryCount.textContent = `${list.length}/${state.current.options.accessoryMax}`;
  els.accessoryList.innerHTML = '';
  if (!list.length) {
    els.accessoryList.innerHTML = `<div class="empty-note">${escapeHtml(t(state.lang, 'noAccessories'))}</div>`;
    return;
  }
  list.forEach((name, index) => {
    const row = document.createElement('div');
    row.className = 'acc-item';
    row.dataset.index = String(index);
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = '';
    img.src = `/api/templates/${encodeURIComponent(state.template.id)}/thumb/accessory/${encodeURIComponent(name)}?w=56`;
    const span = document.createElement('span');
    span.className = 'name';
    span.textContent = name;
    span.title = name;
    const up = document.createElement('button');
    up.type = 'button';
    up.dataset.action = 'up';
    up.dataset.index = String(index);
    up.textContent = '↑';
    up.title = 'Up';
    up.disabled = index === 0;
    const down = document.createElement('button');
    down.type = 'button';
    down.dataset.action = 'down';
    down.dataset.index = String(index);
    down.textContent = '↓';
    down.title = 'Down';
    down.disabled = index === list.length - 1;
    const del = document.createElement('button');
    del.type = 'button';
    del.dataset.action = 'remove';
    del.dataset.index = String(index);
    del.textContent = '×';
    del.title = 'Remove';
    row.append(img, span, up, down, del);
    els.accessoryList.appendChild(row);
  });
}

function onAccessoryDockClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const index = Number(btn.dataset.index);
  const list = state.current.parts.accessory;
  if (btn.dataset.action === 'remove') list.splice(index, 1);
  else if (btn.dataset.action === 'up' && index > 0) [list[index - 1], list[index]] = [list[index], list[index - 1]];
  else if (btn.dataset.action === 'down' && index < list.length - 1) [list[index + 1], list[index]] = [list[index], list[index + 1]];
  renderAccessoryDock();
  renderPartsList();
  scheduleRender();
  saveLocalSoon();
}

/* ---------------- colors ---------------- */

function buildColorSections() {
  if (!state.current) return;
  els.colorSections.innerHTML = '';
  for (const key of COLOR_KEYS) {
    if (key === 'skin') els.colorSections.appendChild(buildSkinSection());
    else els.colorSections.appendChild(buildColorSection(key));
  }
  updateColorSectionSwatches();
}

function buildColorSection(key) {
  const colors = state.current.colors[key];
  const section = document.createElement('section');
  section.className = 'color-section';
  section.dataset.colorKey = key;
  const title = key === 'hair' ? t(state.lang, 'hair') : key === 'eye' ? t(state.lang, 'eyes') : t(state.lang, 'outfit');
  const head = document.createElement('div');
  head.className = 'color-head';
  head.innerHTML = `<h3>${escapeHtml(title)}</h3><div class="swatch" data-role="head-swatch"></div>`;
  section.appendChild(head);
  const swatches = document.createElement('div');
  swatches.className = 'swatches';
  const paletteKeys = ['blue', 'violet', 'red', 'yellow', 'green', 'cyan', 'black', 'white', 'custom'];
  paletteKeys.forEach((pk, index) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `swatch-btn${index === colors.palette ? ' active' : ''}${pk === 'custom' ? ' custom' : ''}`;
    b.dataset.palette = String(index);
    b.dataset.colorKey = key;
    b.title = t(state.lang, `palette.${pk}`);
    b.style.background = pk === 'custom' ? '' : paletteCss(index);
    b.addEventListener('click', () => {
      colors.palette = index;
      if (index === 8 && !colors.custom) colors.custom = { r: 64, g: 64, b: 64, w: 50 };
      buildColorSections();
      updateColorSectionSwatches();
      scheduleRender();
      saveLocalSoon();
    });
    swatches.appendChild(b);
  });
  section.appendChild(swatches);
  const bright = document.createElement('div');
  bright.className = 'brightness-row';
  const brightLabel = document.createElement('span');
  brightLabel.className = 'swatch-label';
  brightLabel.textContent = t(state.lang, 'brightness');
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.max = '6';
  range.step = '1';
  range.value = String(colors.gray);
  const val = document.createElement('span');
  val.className = 'swatch-label';
  val.textContent = brightnessName(colors.gray);
  range.addEventListener('input', () => {
    colors.gray = Number(range.value);
    val.textContent = brightnessName(colors.gray);
    updateColorSectionSwatches();
    scheduleRender();
    saveLocalSoon();
  });
  bright.append(brightLabel, range, val);
  if (colors.palette !== 8) section.appendChild(bright);
  if (colors.palette === 8) {
    const row = document.createElement('div');
    row.className = 'custom-row';
    for (const ch of ['r', 'g', 'b', 'w']) {
      const label = document.createElement('label');
      label.innerHTML = `<span>${ch.toUpperCase()}</span><input type="range" min="0" max="${ch === 'w' ? 100 : 128}" value="${colors.custom?.[ch] ?? (ch === 'w' ? 50 : 64)}"><span>${colors.custom?.[ch] ?? (ch === 'w' ? 50 : 64)}</span>`;
      const input = label.querySelector('input');
      const out = label.querySelectorAll('span')[1];
      input.addEventListener('input', () => {
        colors.custom[ch] = Number(input.value);
        out.textContent = input.value;
        updateColorSectionSwatches();
        scheduleRender();
        saveLocalSoon();
      });
      row.appendChild(label);
    }
    section.appendChild(row);
    const hint = document.createElement('p');
    hint.className = 'muted small';
    hint.textContent = t(state.lang, 'customColorHint');
    section.appendChild(hint);
  }
  return section;
}

function buildSkinSection() {
  const colors = state.current.colors.skin;
  const section = document.createElement('section');
  section.className = 'color-section';
  section.dataset.colorKey = 'skin';
  const head = document.createElement('div');
  head.className = 'color-head';
  head.innerHTML = `<h3>${escapeHtml(t(state.lang, 'skin'))}</h3><div class="swatch" data-role="head-swatch"></div>`;
  section.appendChild(head);
  const swatches = document.createElement('div');
  swatches.className = 'swatches';
  const skinColors = ['#f1c9a8', '#c68b5e', '#e7c76a', '#c98b5b', '#d7b6ae', '#9a8fc4'];
  const skinKeys = ['standard', 'brown', 'yellow', 'tan', 'sick', 'demon'];
  skinColors.forEach((css, index) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `swatch-btn${index === colors.palette ? ' active' : ''}`;
    b.style.background = css;
    b.title = t(state.lang, `skinPalette.${skinKeys[index]}`);
    b.addEventListener('click', () => {
      colors.palette = index;
      buildColorSections();
      updateColorSectionSwatches();
      scheduleRender();
      saveLocalSoon();
    });
    swatches.appendChild(b);
  });
  section.appendChild(swatches);
  const bright = document.createElement('div');
  bright.className = 'brightness-row';
  const brightLabel = document.createElement('span');
  brightLabel.className = 'swatch-label';
  brightLabel.textContent = t(state.lang, 'brightness');
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0'; range.max = '6'; range.step = '1';
  range.value = String(colors.gray);
  const val = document.createElement('span');
  val.className = 'swatch-label';
  val.textContent = brightnessName(colors.gray);
  range.addEventListener('input', () => {
    colors.gray = Number(range.value);
    val.textContent = brightnessName(colors.gray);
    updateColorSectionSwatches();
    scheduleRender();
    saveLocalSoon();
  });
  bright.append(brightLabel, range, val);
  section.appendChild(bright);
  return section;
}

function updateColorSectionSwatches() {
  if (!state.current) return;
  for (const section of $$('.color-section', els.colorSections)) {
    const key = section.dataset.colorKey;
    const swatch = section.querySelector('[data-role="head-swatch"]');
    if (!swatch) continue;
    if (key === 'skin') swatch.style.background = ['#f1c9a8', '#c68b5e', '#e7c76a', '#c98b5b', '#d7b6ae', '#9a8fc4'][state.current.colors.skin.palette] || '#fff';
    else {
      const c = state.current.colors[key];
      swatch.style.background = c.palette === 8
        ? `rgb(${c.custom.r * 2},${c.custom.g * 2},${c.custom.b * 2})`
        : paletteCss(c.palette);
    }
    section.querySelectorAll('.swatch-btn').forEach((btn) => {
      const p = Number(btn.dataset.palette);
      if (Number.isFinite(p)) btn.classList.toggle('active', p === (key === 'skin' ? state.current.colors.skin.palette : state.current.colors[key].palette));
    });
  }
}

function paletteCss(index) {
  return ['#6f8fd8', '#9b6fd0', '#c9563e', '#d6b33f', '#6f9f63', '#54a9bd', '#25231f', '#f5f1e8'][index] || '#888';
}

function brightnessName(index) {
  const arr = t(state.lang, 'brightnessNames');
  return Array.isArray(arr) ? (arr[index] ?? String(index)) : String(index);
}

/* ---------------- options ---------------- */

function updateOptionUi() {
  if (!state.current) return;
  els.flipBtn.classList.toggle('primary', !!state.current.options.flip);
  els.eyeLayerToggle.checked = !!state.current.options.eyeLayer;
  els.faceLayerToggle.checked = !!state.current.options.faceLayer;
  els.accessoryMax.value = String(state.current.options.accessoryMax);
  els.bgColor.value = rgbToHex(state.current.colors.bg);
  els.accessoryCount.textContent = `${state.current.parts.accessory.length}/${state.current.options.accessoryMax}`;
  els.transparentPreviewBtn.classList.toggle('primary', state.previewTransparent);
  els.checker.classList.toggle('transparent', state.previewTransparent);
}

function updateTemplateMeta() {
  if (!state.template) return;
  const tmeta = state.template;
  const bits = [`<strong>${escapeHtml(tmeta.name)}</strong>`, `<code>${escapeHtml(tmeta.id)}</code>`, `${tmeta.size.x}×${tmeta.size.y}`, tmeta.encoding || t(state.lang, 'unknown')];
  if (tmeta.warnings?.length) bits.push(`<span title="${escapeHtml(tmeta.warnings.join('\n'))}">⚠ ${tmeta.warnings.length}</span>`);
  els.templateMeta.innerHTML = bits.join(' · ');
}

function updateRenderStatus(text) {
  els.renderStatus.textContent = text ?? t(state.lang, 'ready');
}

/* ---------------- render ---------------- */

function scheduleRender(delay = 80) {
  clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(renderPreview, delay);
}

async function renderPreview() {
  if (!state.current || !state.template) return;
  if (state.renderAbort) state.renderAbort.abort();
  const controller = new AbortController();
  state.renderAbort = controller;
  els.renderSpinner.hidden = false;
  updateRenderStatus(t(state.lang, 'rendering'));
  const started = performance.now();
  try {
    const res = await fetch('/api/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        templateId: state.template.id,
        state: state.current,
        mode: state.previewTransparent ? 'alpha' : 'normal',
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = URL.createObjectURL(blob);
    await loadImage(state.previewUrl);
    const layers = res.headers.get('X-Layer-Count');
    els.layerCount.textContent = layers ? t(state.lang, 'layers', { n: layers }) : '';
    updateRenderStatus(`${Math.round(performance.now() - started)} ms`);
    state.lastRenderState = clone(state.current);
  } catch (err) {
    if (err.name === 'AbortError') return;
    updateRenderStatus(t(state.lang, 'renderError'));
    showToast(`${t(state.lang, 'renderError')}: ${err.message}`, 'error');
  } finally {
    if (state.renderAbort === controller) els.renderSpinner.hidden = true;
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = els.previewImage;
    img.onload = () => {
      els.canvasSize.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
      applyZoom();
      resolve();
    };
    img.onerror = reject;
    img.src = url;
  });
}

function applyZoom() {
  const img = els.previewImage;
  if (!img.naturalWidth) return;
  let scale = state.zoom;
  if (state.fit) {
    const vp = els.stageViewport.getBoundingClientRect();
    const pad = 44;
    scale = Math.min((vp.width - pad) / img.naturalWidth, (vp.height - pad) / img.naturalHeight, 1.6);
    scale = Math.max(0.1, scale);
    state.zoom = scale;
  }
  img.style.width = `${Math.round(img.naturalWidth * scale)}px`;
  img.style.height = `${Math.round(img.naturalHeight * scale)}px`;
  els.zoomLabel.textContent = `${Math.round(scale * 100)}%`;
}

function setZoom(z, fit) {
  state.fit = !!fit;
  state.zoom = Math.max(0.1, Math.min(4, z));
  applyZoom();
  els.zoomFit.classList.toggle('primary', state.fit);
}

/* ---------------- persistence ---------------- */

function saveLocalSoon() {
  clearTimeout(saveLocalSoon._timer);
  saveLocalSoon._timer = setTimeout(saveLocalNow, 250);
}

function saveLocalNow() {
  if (!state.template || !state.current) return;
  try {
    localStorage.setItem(`cnw:state:${state.template.id}`, JSON.stringify(state.current));
  } catch {
    // ignore quota
  }
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/* ---------------- reset / random ---------------- */

function showResetMenu(anchor) {
  document.querySelectorAll('.popmenu').forEach((m) => m.remove());
  const menu = document.createElement('div');
  menu.className = 'popmenu';
  menu.style.position = 'fixed';
  menu.style.zIndex = '60';
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(window.innerWidth - 230, r.left)}px`;
  menu.style.top = `${Math.min(window.innerHeight - 100, r.bottom + 6)}px`;
  menu.innerHTML = `<button data-reset="defaults">${escapeHtml(t(state.lang, 'resetDefaults'))}</button><button data-reset="startup">${escapeHtml(t(state.lang, 'resetStartup'))}</button>`;
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-reset]');
    if (!b) return;
    if (b.dataset.reset === 'defaults') {
      state.current = normalizeClientState(state.template, {
        parts: state.template.defaults.parts,
        colors: state.template.defaults.colors,
        options: { ...state.current.options, flip: false },
      });
    } else {
      state.current = clone(state.startupState);
    }
    applyCurrentToUi();
    scheduleRender(0);
    saveLocalNow();
    showToast(t(state.lang, 'resetDone'), 'success');
    menu.remove();
  });
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
}

function applyCurrentToUi() {
  els.bgColor.value = rgbToHex(state.current.colors.bg);
  els.accessoryMax.value = String(state.current.options.accessoryMax);
  els.eyeLayerToggle.checked = !!state.current.options.eyeLayer;
  els.faceLayerToggle.checked = !!state.current.options.faceLayer;
  renderPartsList();
  renderAccessoryDock();
  buildColorSections();
  updateOptionUi();
}

function randomizeNow() {
  randomize(state.randomOptions);
  if (els.randomDialog.open) els.randomDialog.close();
}

function openRandomOptions() {
  els.randomOptions.innerHTML = '';
  const defs = [
    ['hair', t(state.lang, 'randomHair')],
    ['head', t(state.lang, 'randomHead')],
    ['face', t(state.lang, 'randomFace')],
    ['eye', t(state.lang, 'randomEye')],
    ['body', t(state.lang, 'randomBody')],
    ['accessory', t(state.lang, 'randomAccessory')],
    ['color', t(state.lang, 'randomColor')],
    ['custom', t(state.lang, 'randomCustomColor')],
  ];
  for (const [key, label] of defs) {
    const lab = document.createElement('label');
    lab.innerHTML = `<input type="checkbox" data-random-key="${key}" ${state.randomOptions[key] ? 'checked' : ''}> <span>${escapeHtml(label)}</span>`;
    els.randomOptions.appendChild(lab);
  }
  els.randomDialog.showModal();
}

function randomizeFromDialog() {
  for (const input of $$('[data-random-key]', els.randomOptions)) state.randomOptions[input.dataset.randomKey] = input.checked ? 1 : 0;
  localStorage.setItem('cnw:randomOptions', JSON.stringify(state.randomOptions));
  randomize(state.randomOptions);
  els.randomDialog.close();
}

function randomize(opts) {
  if (!state.current || !state.template) return;
  const tmeta = state.template;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  for (const key of ['hair_front', 'hair_back', 'head', 'face', 'eye', 'body']) {
    const flag = key === 'hair_front' || key === 'hair_back' ? opts.hair : opts[key];
    const names = tmeta.categories?.[key]?.names || [];
    if (flag && names.length) state.current.parts[key] = pick(names);
  }
  state.current.parts.accessory = [];
  if (opts.accessory) {
    const names = tmeta.categories?.accessory?.names || [];
    for (let i = 0; i < 6; i++) {
      if (Math.random() < 1 / 3 && names.length && state.current.parts.accessory.length < state.current.options.accessoryMax) {
        state.current.parts.accessory.push(pick(names));
      }
    }
  }
  if (opts.color) {
    for (const key of ['hair', 'eye', 'body']) {
      if (opts.custom) {
        state.current.colors[key] = {
          palette: 8,
          gray: 3,
          custom: {
            r: Math.floor(Math.random() * 129),
            g: Math.floor(Math.random() * 129),
            b: Math.floor(Math.random() * 129),
            w: 20 + Math.floor(Math.random() * 61),
          },
        };
      } else {
        state.current.colors[key].palette = Math.floor(Math.random() * 8);
        state.current.colors[key].gray = Math.floor(Math.random() * 7);
      }
    }
    const skinPalette = Math.random() < 1 / 15 ? 5 : Math.floor(Math.random() * 5);
    state.current.colors.skin = { palette: skinPalette, gray: Math.floor(Math.random() * 7) };
  }
  applyCurrentToUi();
  scheduleRender(0);
  saveLocalNow();
  showToast(t(state.lang, 'randomize'), 'success');
}

/* ---------------- template import ---------------- */

function openImportDialog() {
  switchImportTab('folder');
  els.importStatus.textContent = '';
  els.pickedFolderInfo.textContent = '';
  els.uploadFolderBtn.disabled = true;
  state.pickedFiles = [];
  els.importDialog.showModal();
}

function switchImportTab(tab) {
  $$('[data-import-tab]').forEach((b) => b.classList.toggle('active', b.dataset.importTab === tab));
  els.importFolderPane.hidden = tab !== 'folder';
  els.importPathPane.hidden = tab !== 'path';
}

function onTemplateFolderPicked() {
  state.pickedFiles = Array.from(els.templateFilesInput.files || []);
  els.uploadFolderBtn.disabled = !state.pickedFiles.length;
  if (state.pickedFiles.length) {
    const root = state.pickedFiles[0].webkitRelativePath?.split('/')[0] || state.pickedFiles[0].name;
    els.pickedFolderInfo.textContent = `${root} — ${state.pickedFiles.length} files`;
  } else {
    els.pickedFolderInfo.textContent = t(state.lang, 'noFiles');
  }
}

async function uploadTemplateFolder() {
  if (!state.pickedFiles.length) return showToast(t(state.lang, 'noFiles'), 'error');
  if (state.importing) return;
  state.importing = true;
  els.importStatus.textContent = t(state.lang, 'uploading');
  try {
    const form = new FormData();
    const paths = [];
    const root = state.pickedFiles[0].webkitRelativePath?.split('/')[0] || 'template';
    for (const file of state.pickedFiles) {
      form.append('files', file, file.name);
      const rel = file.webkitRelativePath || file.name;
      const parts = rel.split('/');
      // webkitRelativePath starts with the selected folder name.  The server
      // stores the folder contents at the template root, so strip that prefix.
      paths.push(parts.length > 1 && parts[0] === root ? parts.slice(1).join('/') : rel);
    }
    form.append('relativePaths', JSON.stringify(paths));
    form.append('id', root);
    const res = await fetch('/api/templates/upload', { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
    await loadTemplates();
    await selectTemplate(json.template.id);
    els.importDialog.close();
    showToast(t(state.lang, 'templateImported'), 'success');
  } catch (err) {
    els.importStatus.textContent = err.message;
    showToast(err.message, 'error');
  } finally {
    state.importing = false;
  }
}

async function importTemplatePath() {
  const source = els.importPath.value.trim();
  if (!source) return showToast(t(state.lang, 'missingPath'), 'error');
  if (state.importing) return;
  state.importing = true;
  els.importStatus.textContent = t(state.lang, 'importing');
  try {
    const res = await api('/api/templates/import', {
      method: 'POST',
      body: JSON.stringify({ path: source, id: els.importId.value.trim() || undefined }),
    });
    await loadTemplates();
    await selectTemplate(res.template.id);
    els.importDialog.close();
    showToast(t(state.lang, 'templateImported'), 'success');
  } catch (err) {
    els.importStatus.textContent = err.message;
    showToast(err.message, 'error');
  } finally {
    state.importing = false;
  }
}

async function deleteCurrentTemplate() {
  if (!state.template || state.template.bundled) return;
  if (!confirm(t(state.lang, 'confirmDelete'))) return;
  try {
    await api(`/api/templates/${encodeURIComponent(state.template.id)}`, { method: 'DELETE' });
    localStorage.removeItem(`cnw:state:${state.template.id}`);
    await loadTemplates();
    const next = state.templates.find((t) => !t.error) || state.templates[0];
    if (next) await selectTemplate(next.id);
    els.importDialog.close();
    showToast(t(state.lang, 'templateDeleted'), 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ---------------- CPD ---------------- */

async function loadCpdFile() {
  const file = els.cpdFileInput.files?.[0];
  els.cpdFileInput.value = '';
  if (!file || !state.template) return;
  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/cpd/import?templateId=${encodeURIComponent(state.template.id)}`, { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
    state.current = normalizeClientState(state.template, json.state);
    state.startupState = clone(state.current);
    applyCurrentToUi();
    scheduleRender(0);
    saveLocalNow();
    if (json.name && json.name !== state.template.id) showToast(t(state.lang, 'cpdWrongTemplate'), 'error');
    else showToast(json.warnings?.length ? t(state.lang, 'cpdWarnings', { n: json.warnings.length }) : t(state.lang, 'loaded'), 'success');
  } catch (err) {
    showToast(`${t(state.lang, 'loaded')}: ${err.message}`, 'error');
  }
}

async function saveCpd() {
  if (!state.template || !state.current) return;
  try {
    const res = await fetch('/api/cpd/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId: state.template.id, state: state.current }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json?.error?.message || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    downloadBlob(blob, `${safeName(state.template.id)}.cpd`);
    const lossy = res.headers.get('X-CPD-Lossy') === '1';
    showToast(lossy ? `${t(state.lang, 'saved')} (UTF-8 fallback)` : t(state.lang, 'saved'), lossy ? 'error' : 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ---------------- export ---------------- */

function openExportDialog() {
  if (!state.current) return;
  updateExportDialog();
  els.exportFilename.value = `${state.template.id}_${timestamp()}`;
  els.exportDialog.showModal();
}

function updateExportDialog() {
  const fmt = els.exportFormat.value;
  const transparent = fmt === 'png';
  els.exportTransparent.disabled = !transparent;
  if (!transparent) els.exportTransparent.checked = false;
  els.exportQuality.disabled = !(fmt === 'jpg' || fmt === 'jpeg');
  els.qualityRow.hidden = !(fmt === 'jpg' || fmt === 'jpeg');
  const ukagaka = fmt === 'ukagaka';
  els.antialiasRow.hidden = !ukagaka;
  els.exportNote.textContent = ukagaka
    ? 'ZIP: surface PNG + PNA + RGBA PNG.'
    : t(state.lang, 'exportNote');
}

async function exportImage() {
  const fmt = els.exportFormat.value;
  const body = {
    templateId: state.template.id,
    state: state.current,
    format: fmt,
    transparent: els.exportTransparent.checked,
    scale: Number(els.exportScale.value) || 1,
    quality: Number(els.exportQuality.value) || 80,
    antialias: Number(els.exportAntialias.value) || 0,
    filename: els.exportFilename.value.trim() || undefined,
  };
  const btn = els.exportSubmit;
  btn.disabled = true;
  showToast(t(state.lang, 'exportPreparing'));
  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json?.error?.message || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const name = filenameFromDisposition(res.headers.get('content-disposition')) || `${safeName(body.filename || state.template.id)}.${fmt === 'ukagaka' ? 'zip' : fmt === 'jpg' ? 'jpg' : fmt}`;
    downloadBlob(blob, name);
    els.exportDialog.close();
    showToast(t(state.lang, 'exported'), 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- variants ---------------- */

function openVariantsDialog() {
  if (!state.current || !state.template) return;
  state.variant = {
    axes: ['face', 'body'].filter((a) => state.template.categories?.[a]?.names?.length),
    values: {},
    plan: null,
    items: [],
    selected: new Set(),
    previewed: false,
  };
  for (const axis of state.variant.axes) state.variant.values[axis] = new Set(state.template.categories[axis].names);
  buildVariantAxes();
  buildVariantValues();
  updateVariantInfo();
  els.variantGrid.innerHTML = `<div class="empty-grid">${escapeHtml(t(state.lang, 'variantNoPreview'))}</div>`;
  els.variantStatus.textContent = '';
  els.variantsDialog.showModal();
}

function buildVariantAxes() {
  if (!state.template) return;
  els.variantAxes.innerHTML = '';
  for (const axis of ['hair_front', 'hair_back', 'head', 'face', 'eye', 'body']) {
    const meta = state.template.categories?.[axis];
    if (!meta?.names?.length) continue;
    const checked = state.variant.axes.includes(axis);
    const row = document.createElement('label');
    row.className = 'axis-row';
    const current = state.current.parts[axis] || '';
    row.innerHTML = `<input type="checkbox" data-axis="${axis}" ${checked ? 'checked' : ''}>
      <span class="axis-name">${escapeHtml(labelForCategory(axis))}</span>
      <span class="current" title="${escapeHtml(current)}">${escapeHtml(current)}</span>`;
    els.variantAxes.appendChild(row);
  }
}

function onVariantAxisChange(e) {
  const input = e.target.closest('[data-axis]');
  if (!input) return;
  const axis = input.dataset.axis;
  if (input.checked) {
    if (!state.variant.axes.includes(axis)) state.variant.axes.push(axis);
    const order = ['hair_front', 'hair_back', 'head', 'face', 'eye', 'body'];
    state.variant.axes.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (!state.variant.values[axis]) state.variant.values[axis] = new Set(state.template.categories[axis].names);
  } else {
    state.variant.axes = state.variant.axes.filter((a) => a !== axis);
  }
  state.variant.plan = null;
  state.variant.items = [];
  state.variant.selected.clear();
  state.variant.previewed = false;
  buildVariantValues();
  updateVariantInfo();
  els.variantGrid.innerHTML = `<div class="empty-grid">${escapeHtml(t(state.lang, 'variantNoPreview'))}</div>`;
}

function buildVariantValues() {
  els.variantValues.innerHTML = '';
  for (const axis of state.variant.axes) {
    const names = state.template.categories?.[axis]?.names || [];
    if (!state.variant.values[axis]) state.variant.values[axis] = new Set(names);
    const set = state.variant.values[axis];
    const group = document.createElement('div');
    group.className = 'value-group';
    group.dataset.axis = axis;
    group.innerHTML = `<h4><span>${escapeHtml(labelForCategory(axis))}</span><span class="value-tools"><button type="button" class="link-btn" data-value-action="all" data-axis="${axis}">${escapeHtml(t(state.lang, 'selectAll'))}</button><button type="button" class="link-btn" data-value-action="none" data-axis="${axis}">${escapeHtml(t(state.lang, 'clear'))}</button></span></h4>`;
    const list = document.createElement('div');
    list.className = 'value-list';
    for (const name of names) {
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.axis = axis;
      cb.value = name;
      cb.checked = set.has(name);
      const span = document.createElement('span');
      span.textContent = name;
      span.title = name;
      lab.append(cb, span);
      list.appendChild(lab);
    }
    group.appendChild(list);
    els.variantValues.appendChild(group);
  }
}

function onVariantValueChange(e) {
  const cb = e.target.closest('input[type="checkbox"][data-axis]');
  if (!cb) return;
  const axis = cb.dataset.axis;
  if (!state.variant.values[axis]) state.variant.values[axis] = new Set();
  if (cb.checked) state.variant.values[axis].add(cb.value);
  else state.variant.values[axis].delete(cb.value);
  state.variant.plan = null;
  state.variant.items = [];
  state.variant.selected.clear();
  state.variant.previewed = false;
  updateVariantInfo();
}

function onVariantValueTools(e) {
  const btn = e.target.closest('[data-value-action]');
  if (!btn) return;
  const axis = btn.dataset.axis;
  const all = btn.dataset.valueAction === 'all';
  const names = state.template.categories[axis].names;
  state.variant.values[axis] = new Set(all ? names : []);
  for (const cb of $$(`input[type="checkbox"][data-axis="${CSS.escape(axis)}"]`, els.variantValues)) cb.checked = all;
  state.variant.plan = null;
  state.variant.items = [];
  state.variant.selected.clear();
  state.variant.previewed = false;
  updateVariantInfo();
}

function variantRequest(limit = 512) {
  const values = {};
  for (const axis of state.variant.axes) values[axis] = Array.from(state.variant.values[axis] || []);
  return {
    templateId: state.template.id,
    state: state.current,
    axes: state.variant.axes,
    values,
    limit,
  };
}

async function planVariants() {
  if (!state.variant.axes.length) {
    els.variantPlanInfo.textContent = t(state.lang, 'categoryEmpty');
    return;
  }
  els.variantPlanInfo.textContent = t(state.lang, 'loading');
  try {
    const res = await api('/api/variants/plan', { method: 'POST', body: JSON.stringify(variantRequest()) });
    state.variant.plan = res;
    state.variant.items = [];
    state.variant.selected.clear();
    state.variant.previewed = false;
    updateVariantInfo();
    if (res.warnings?.length) showToast(res.warnings.join('\n'), 'error');
  } catch (err) {
    els.variantPlanInfo.textContent = err.message;
    showToast(err.message, 'error');
  }
}

function updateVariantInfo() {
  const plan = state.variant.plan;
  if (plan) {
    const trunc = plan.truncated ? t(state.lang, 'variantTruncated', { limit: plan.limit }) : '';
    els.variantPlanInfo.textContent = t(state.lang, 'variantPlan', { count: plan.count, trunc });
  } else {
    els.variantPlanInfo.textContent = '';
  }
  updateVariantSelectionInfo();
}

function updateVariantSelectionInfo() {
  const n = state.variant.selected.size;
  const total = state.variant.plan?.count ?? 0;
  els.variantSelectionInfo.textContent = n ? t(state.lang, 'variantSelected', { n }) : t(state.lang, 'variantAll', { n: total });
  els.variantStatus.textContent = state.variant.previewed ? `${state.variant.items.length} / ${total}` : '';
  els.variantExportBtn.disabled = n === 0;
}

async function previewVariants() {
  if (!state.variant.plan) await planVariants();
  if (!state.variant.plan) return;
  const count = state.variant.plan.count;
  const previewCount = Math.min(24, count);
  const indices = Array.from({ length: previewCount }, (_, i) =>
    count <= previewCount ? i : Math.floor((i * count) / previewCount),
  );
  els.variantStatus.textContent = t(state.lang, 'variantPreviewing');
  try {
    const res = await api('/api/variants/preview', {
      method: 'POST',
      body: JSON.stringify({ ...variantRequest(), indices, previewWidth: 220 }),
    });
    state.variant.items = res.items || [];
    state.variant.selected = new Set(state.variant.items.map((i) => i.index));
    state.variant.previewed = true;
    renderVariantGrid();
    els.variantStatus.textContent = `${state.variant.items.length} / ${res.count}`;
    if (res.warnings?.length) showToast(res.warnings.join('\n'), 'error');
  } catch (err) {
    els.variantStatus.textContent = err.message;
    showToast(err.message, 'error');
  }
}

function renderVariantGrid() {
  els.variantGrid.innerHTML = '';
  if (!state.variant.items.length) {
    els.variantGrid.innerHTML = `<div class="empty-grid">${escapeHtml(t(state.lang, 'variantNoPreview'))}</div>`;
    updateVariantSelectionInfo();
    return;
  }
  for (const item of state.variant.items) {
    const card = document.createElement('label');
    card.className = `variant-card${state.variant.selected.has(item.index) ? ' selected' : ''}`;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.variant.selected.has(item.index);
    cb.dataset.index = String(item.index);
    cb.addEventListener('change', () => {
      if (cb.checked) state.variant.selected.add(item.index);
      else state.variant.selected.delete(item.index);
      card.classList.toggle('selected', cb.checked);
      updateVariantSelectionInfo();
    });
    const img = document.createElement('img');
    img.src = `data:image/png;base64,${item.png}`;
    img.alt = item.label;
    const label = document.createElement('div');
    label.className = 'vc-label';
    label.textContent = item.label;
    label.title = item.label;
    card.append(img, cb, label);
    els.variantGrid.appendChild(card);
  }
  updateVariantSelectionInfo();
}

async function exportVariants(all = false) {
  if (!state.variant.plan) await planVariants();
  if (!state.variant.plan) return;
  const indices = all || !state.variant.selected.size ? undefined : Array.from(state.variant.selected);
  els.variantExportBtn.disabled = true;
  showToast(t(state.lang, 'variantExporting'));
  try {
    const res = await fetch('/api/variants/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...variantRequest(all ? 2000 : 512), indices, format: 'png' }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json?.error?.message || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    downloadBlob(blob, `${safeName(state.template.id)}_variants.zip`);
    els.variantsDialog.close();
    showToast(t(state.lang, 'exported'), 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    els.variantExportBtn.disabled = false;
  }
}

/* ---------------- prompt studio ---------------- */

function populateLlmOptions() {
  if (!state.config) return;
  if (els.llmProvider.options.length === 0) {
    for (const p of state.config.llm.providers) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      els.llmProvider.appendChild(opt);
    }
  }
  if (els.llmTarget.options.length === 0) {
    for (const p of state.config.llm.targets) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      els.llmTarget.appendChild(opt);
    }
  }
}

function openPromptDialog() {
  if (!state.current || !state.template) return;
  populateLlmOptions();
  const prefs = state.llm || {};
  els.llmProvider.value = prefs.provider || 'openai';
  els.llmTarget.value = prefs.target || 'gpt-image';
  els.llmLanguage.value = prefs.promptLanguage || state.lang;
  els.llmTemperature.value = String(prefs.temperature ?? 0.7);
  els.llmMaxTokens.value = String(prefs.maxTokens ?? 900);
  els.llmModel.value = prefs.model || '';
  els.llmBaseUrl.value = prefs.baseUrl || '';
  setProviderDefaults(false);
  const key = sessionStorage.getItem('cnw:llmKey');
  if (key) {
    els.llmApiKey.value = key;
    els.llmRememberKey.checked = true;
  }
  els.llmStatus.textContent = '';
  els.llmPromptOut.value = '';
  els.llmNegativeOut.value = '';
  els.llmTagsOut.value = '';
  els.llmNotesOut.textContent = '';
  els.promptDialog.showModal();
  preparePromptPreview();
}

async function preparePromptPreview() {
  const requestId = ++state.promptImageRequest;
  state.promptImage = null;
  state.promptImageStatus = 'preparing';
  els.llmPreviewImg.removeAttribute('src');
  els.llmUsePreview.checked = false;
  els.llmUsePreview.disabled = true;
  els.llmGenerate.disabled = true;
  updatePromptPreviewStatus();
  try {
    const res = await fetch('/api/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId: state.template.id, state: state.current, mode: 'normal' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await downscalePromptImage(await res.blob(), 1024);
    const dataUrl = await blobToDataUrl(blob);
    if (requestId !== state.promptImageRequest) return;
    state.promptImage = { dataUrl, blob };
    state.promptImageStatus = 'attached';
    els.llmPreviewImg.src = dataUrl;
    els.llmUsePreview.disabled = false;
    els.llmUsePreview.checked = true;
    els.llmGenerate.disabled = false;
    updatePromptPreviewStatus();
  } catch {
    if (requestId !== state.promptImageRequest) return;
    state.promptImageStatus = 'unavailable';
    els.llmGenerate.disabled = false;
    updatePromptPreviewStatus();
  }
}

function updatePromptPreviewStatus() {
  const keys = { preparing: 'previewPreparing', attached: 'previewAttached', unavailable: 'previewUnavailable' };
  els.llmPreviewStatus.textContent = keys[state.promptImageStatus] ? t(state.lang, keys[state.promptImageStatus]) : '';
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

async function downscalePromptImage(blob, maxSide) {
  if (typeof createImageBitmap !== 'function') return blob;
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) {
      bitmap.close?.();
      return blob;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close?.();
      return blob;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const resized = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return resized || blob;
  } catch {
    bitmap?.close?.();
    return blob;
  }
}

function setProviderDefaults(force) {
  if (!state.config) return;
  const p = state.config.llm.providers.find((x) => x.id === els.llmProvider.value) || state.config.llm.providers[0];
  if (force || !els.llmBaseUrl.value) els.llmBaseUrl.value = p.defaultBaseUrl;
  if (force || !els.llmModel.value) els.llmModel.value = p.defaultModel;
}

async function generatePrompt() {
  if (state.promptImageStatus === 'preparing') {
    return showToast(t(state.lang, 'previewNotReady'), 'error');
  }
  const apiKey = els.llmApiKey.value.trim();
  if (!apiKey) return showToast(t(state.lang, 'promptMissingKey'), 'error');
  const usePreviewImage = els.llmUsePreview.checked;
  if (usePreviewImage && !state.promptImage?.dataUrl) {
    return showToast(t(state.lang, 'previewNotReady'), 'error');
  }
  if (els.llmRememberKey.checked) sessionStorage.setItem('cnw:llmKey', apiKey);
  else sessionStorage.removeItem('cnw:llmKey');
  state.llm = {
    provider: els.llmProvider.value,
    model: els.llmModel.value.trim(),
    baseUrl: els.llmBaseUrl.value.trim(),
    target: els.llmTarget.value,
    promptLanguage: els.llmLanguage.value,
    temperature: Number(els.llmTemperature.value) || 0.7,
    maxTokens: Number(els.llmMaxTokens.value) || 900,
  };
  localStorage.setItem('cnw:llm', JSON.stringify(state.llm));
  els.llmGenerate.disabled = true;
  els.llmStatus.textContent = t(state.lang, 'promptGenerating');
  try {
    const res = await api('/api/llm/prompt', {
      method: 'POST',
      body: JSON.stringify({
        templateId: state.template.id,
        state: state.current,
        provider: state.llm.provider,
        apiKey,
        baseUrl: state.llm.baseUrl,
        model: state.llm.model,
        temperature: state.llm.temperature,
        maxTokens: state.llm.maxTokens,
        target: state.llm.target,
        language: state.llm.promptLanguage,
        description: els.llmDescription.value,
        image: usePreviewImage ? state.promptImage.dataUrl : undefined,
      }),
    });
    els.llmPromptOut.value = res.prompt || '';
    els.llmNegativeOut.value = res.negative_prompt || '';
    els.llmTagsOut.value = Array.isArray(res.tags) ? res.tags.join(', ') : '';
    els.llmNotesOut.textContent = res.notes || '';
    els.llmStatus.textContent = `${t(state.lang, 'promptDone')} · ${res.provider}/${res.model}${res.usedReferenceImage ? ` · ${t(state.lang, 'promptImageUsed')}` : ''} · ${res.latencyMs} ms`;
  } catch (err) {
    els.llmStatus.textContent = err.message;
    showToast(`${t(state.lang, 'promptError')}: ${err.message}`, 'error');
  } finally {
    els.llmGenerate.disabled = false;
  }
}

function downloadPromptJson() {
  const data = {
    prompt: els.llmPromptOut.value,
    negative_prompt: els.llmNegativeOut.value,
    tags: els.llmTagsOut.value.split(',').map((s) => s.trim()).filter(Boolean),
    notes: els.llmNotesOut.textContent,
    target: els.llmTarget.value,
    usedReferenceImage: els.llmUsePreview.checked && !!state.promptImage,
    generatedAt: new Date().toISOString(),
  };
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'prompt.json');
}

/* ---------------- info ---------------- */

function openInfoDialog() {
  if (!state.template) return;
  const tmeta = state.template;
  const items = [
    ['ID', tmeta.id],
    ['Name', tmeta.name],
    [t(state.lang, 'encoding'), tmeta.encoding || t(state.lang, 'unknown')],
    ['Size', `${tmeta.size.x} × ${tmeta.size.y}`],
    [t(state.lang, 'bundled'), tmeta.bundled ? 'yes' : 'no'],
    [t(state.lang, 'warnings'), String(tmeta.warnings?.length || 0)],
  ];
  els.infoMeta.innerHTML = items.map(([k, v]) => `<div class="kv"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div></div>`).join('');
  els.infoReadme.textContent = tmeta.readme || t(state.lang, 'noReadme');
  els.creditsText.textContent = t(state.lang, 'creditsText');
  els.infoDialog.showModal();
}

/* ---------------- copy / toast / utils ---------------- */

function onCopyButton(e) {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const target = document.getElementById(btn.dataset.copy);
  if (!target) return;
  const text = target.value ?? target.textContent ?? '';
  if (!navigator.clipboard?.writeText) {
    showToast(t(state.lang, 'copyFailed'), 'error');
    return;
  }
  navigator.clipboard.writeText(text).then(() => showToast(t(state.lang, 'copyDone'), 'success')).catch(() => showToast(t(state.lang, 'copyFailed'), 'error'));
}

function showToast(message, type = 'info', timeout = 3600) {
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' error' : type === 'success' ? ' success' : ''}`;
  el.textContent = message;
  els.toasts.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s';
    setTimeout(() => el.remove(), 220);
  }, timeout);
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function filenameFromDisposition(header) {
  if (!header) return null;
  const m = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (m) {
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  }
  const m2 = /filename="([^"]+)"/i.exec(header);
  return m2 ? m2[1] : null;
}

function api(path, opts = {}) {
  return fetch(path, {
    headers: opts.body ? { 'content-type': 'application/json', ...(opts.headers || {}) } : (opts.headers || {}),
    ...opts,
  }).then(async (res) => {
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      const msg = json?.error?.message || text || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.code = json?.error?.code;
      throw err;
    }
    return json;
  });
}

function labelForCategory(id) {
  const meta = state.template?.categories?.[id];
  if (meta?.label) return meta.label[state.lang] || meta.label.ja || id;
  return id;
}

function clampInt(v, lo, hi, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}

function rgbToHex(rgb) {
  const [r, g, b] = normalizeBg(rgb);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function safeName(name) {
  return String(name || 'character').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 100) || 'character';
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme === 'dark' ? 'dark' : 'light';
  els.themeBtn.textContent = state.theme === 'dark' ? '☀' : '◐';
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('cnw:theme', state.theme);
  applyTheme();
  if (state.current) scheduleRender(0);
}
