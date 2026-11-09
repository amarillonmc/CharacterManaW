import { paletteLabel, normalizeColors } from './colors.js';
import { CATEGORIES } from './constants.js';

const TARGETS = {
  'gpt-image': {
    label: 'GPT-Image',
    style: 'natural-language, concise but specific; describe composition, clothing, colors, lighting, camera, and background. Do not rely on negative prompts.',
    negative: false,
  },
  'nano-banana': {
    label: 'Nano Banana / Gemini Image',
    style: 'natural-language image description; keep identity details explicit; include framing and background. Avoid tag soup.',
    negative: false,
  },
  'z-image': {
    label: 'Z-Image',
    style: 'anime-oriented prompt with comma-separated visual tags plus a short natural-language sentence. Include quality tags only when useful.',
    negative: true,
  },
  anima: {
    label: 'Anima',
    style: 'anime tag prompt: character, hair, eyes, outfit, accessories, pose, background, style; use danbooru-like tags where appropriate.',
    negative: true,
  },
  lumina: {
    label: 'Lumina',
    style: 'descriptive natural-language prompt with clear subject, attire, colors, pose, setting and lighting.',
    negative: true,
  },
  generic: {
    label: 'Generic image model',
    style: 'clear natural-language prompt plus optional tags; suitable for most text-to-image models.',
    negative: true,
  },
};

export async function generatePrompt(input = {}) {
  const provider = normalizeProvider(input.provider);
  const targetKey = TARGETS[input.target] ? input.target : 'generic';
  const target = TARGETS[targetKey];
  const apiKey = String(input.apiKey ?? '').trim();
  if (!apiKey) throw new LlmError('API key is required.', 'missing_key');
  const baseUrl = String(input.baseUrl ?? '').trim() || defaultBaseUrl(provider);
  if (!/^https?:\/\//i.test(baseUrl)) throw new LlmError('Base URL must be http(s).', 'invalid_base_url');
  const model = String(input.model ?? '').trim() || defaultModel(provider);
  const temperature = clampNumber(input.temperature, 0, 2, 0.7);
  const maxTokens = clampNumber(input.maxTokens, 128, 8192, 900);
  const language = ['ja', 'zh', 'en'].includes(input.language) ? input.language : 'en';
  const context = buildPromptContext(input, { targetKey, target, language });
  const messages = [
    { role: 'system', content: context.system },
    { role: 'user', content: context.user },
  ];
  const started = Date.now();
  let text;
  if (provider === 'anthropic') {
    text = await callAnthropic({ baseUrl, apiKey, model, temperature, maxTokens, messages });
  } else if (provider === 'gemini') {
    text = await callGemini({ baseUrl, apiKey, model, temperature, maxTokens, messages });
  } else {
    text = await callOpenAICompatible({ baseUrl, apiKey, model, temperature, maxTokens, messages });
  }
  const parsed = parsePromptResponse(text);
  return {
    ...parsed,
    provider,
    model,
    target: targetKey,
    targetLabel: target.label,
    latencyMs: Date.now() - started,
  };
}

export function buildPromptContext(input, { targetKey, target, language }) {
  const s = input.state || {};
  const template = input.template || {};
  const colors = normalizeColors(s.colors || {});
  const parts = s.parts || {};
  const templateName = template.displayName || template.name || template.id || s.templateId || 'character';
  const size = template.size || { x: 300, y: 400 };
  const lines = [];
  lines.push(`Template: ${templateName} (${template.id || s.templateId || 'unknown'}), canvas ${size.x}x${size.y}.`);
  for (const def of CATEGORIES) {
    const value = def.multiple ? (Array.isArray(parts[def.id]) ? parts[def.id].join(', ') : '') : parts[def.id];
    if (value) lines.push(`${def.label.en}: ${value}`);
  }
  lines.push(`Hair color: ${paletteLabel(colors.hair.palette, 'en')}${colors.hair.mode === 'custom' ? ` custom RGB(${colors.hair.custom.r},${colors.hair.custom.g},${colors.hair.custom.b}) weight ${colors.hair.custom.w}` : ''}, brightness ${colors.hair.gray}.`);
  lines.push(`Eye color: ${paletteLabel(colors.eye.palette, 'en')}${colors.eye.mode === 'custom' ? ` custom RGB(${colors.eye.custom.r},${colors.eye.custom.g},${colors.eye.custom.b}) weight ${colors.eye.custom.w}` : ''}, brightness ${colors.eye.gray}.`);
  lines.push(`Skin: palette ${colors.skin.palette}, brightness ${colors.skin.gray}.`);
  lines.push(`Outfit color: ${paletteLabel(colors.body.palette, 'en')}${colors.body.mode === 'custom' ? ` custom RGB(${colors.body.custom.r},${colors.body.custom.g},${colors.body.custom.b}) weight ${colors.body.custom.w}` : ''}, brightness ${colors.body.gray}.`);
  lines.push(`Background color: rgb(${colors.bg.join(',')}).`);
  if (template.readme) {
    const excerpt = String(template.readme).replace(/\s+/g, ' ').slice(0, 600);
    if (excerpt) lines.push(`Template readme excerpt: ${excerpt}`);
  }
  const userDescription = String(input.description ?? '').trim();
  const languageName = language === 'ja' ? 'Japanese' : language === 'zh' ? 'Chinese' : 'English';
  const system = `You are a prompt engineer for text-to-image models. You turn a dress-up character's exact component data into an image-generation prompt.
Target model: ${target.label}. ${target.style}
Write the answer in ${languageName}.
Return ONLY a JSON object with these keys:
{"prompt": string, "negative_prompt": string, "tags": string[], "notes": string}
Rules:
- Preserve the character's visual identity: hair style, eye style, outfit, accessories, colors.
- Do not invent copyrighted characters or artists unless the user explicitly asks.
- ${target.negative ? 'Provide a useful negative_prompt.' : 'Use an empty negative_prompt and put constraints in prompt.'}
- Keep the prompt self-contained and ready to paste into the target model.
- If the user's description is empty, describe a neutral full-body character-sheet presentation on a simple background.`;
  const user = `Character component data:\n${lines.join('\n')}\n\nUser request:\n${userDescription || '(none; create a neutral character-sheet prompt)'}`;
  return { system, user };
}

async function callOpenAICompatible({ baseUrl, apiKey, model, temperature, maxTokens, messages }) {
  const url = joinUrl(baseUrl, '/chat/completions');
  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  }, 120000);
  const json = await readJson(res);
  if (!res.ok) throw new LlmError(providerError(json, res.status), 'provider_error');
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => p?.text ?? '').join('');
  throw new LlmError('Provider returned no text.', 'empty_response');
}

async function callAnthropic({ baseUrl, apiKey, model, temperature, maxTokens, messages }) {
  const url = joinUrl(baseUrl, '/v1/messages');
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const userMessages = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages: userMessages }),
  }, 120000);
  const json = await readJson(res);
  if (!res.ok) throw new LlmError(providerError(json, res.status), 'provider_error');
  const blocks = json?.content;
  if (Array.isArray(blocks)) return blocks.map((b) => b?.text ?? '').join('');
  throw new LlmError('Provider returned no text.', 'empty_response');
}

async function callGemini({ baseUrl, apiKey, model, temperature, maxTokens, messages }) {
  const url = `${joinUrl(baseUrl, `/models/${encodeURIComponent(model)}:generateContent`)}?key=${encodeURIComponent(apiKey)}`;
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const user = messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n');
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    }),
  }, 120000);
  const json = await readJson(res);
  if (!res.ok) throw new LlmError(providerError(json, res.status), 'provider_error');
  const parts = json?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) return parts.map((p) => p?.text ?? '').join('');
  throw new LlmError('Provider returned no text.', 'empty_response');
}

function parsePromptResponse(text) {
  let raw = String(text ?? '').trim();
  // Strip markdown fences.
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  let obj = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        obj = JSON.parse(raw.slice(start, end + 1));
      } catch {
        obj = null;
      }
    }
  }
  if (!obj || typeof obj !== 'object') {
    return { prompt: raw, negative_prompt: '', tags: [], notes: 'The provider did not return JSON; the raw text is used as the prompt.' };
  }
  return {
    prompt: String(obj.prompt ?? obj.positive_prompt ?? raw).trim(),
    negative_prompt: String(obj.negative_prompt ?? obj.negative ?? '').trim(),
    tags: Array.isArray(obj.tags) ? obj.tags.map(String).slice(0, 80) : [],
    notes: String(obj.notes ?? '').trim(),
  };
}

function normalizeProvider(p) {
  if (p === 'anthropic' || p === 'gemini' || p === 'openai') return p;
  return 'openai';
}

function defaultBaseUrl(provider) {
  if (provider === 'anthropic') return 'https://api.anthropic.com';
  if (provider === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta';
  return 'https://api.openai.com/v1';
}

function defaultModel(provider) {
  if (provider === 'anthropic') return 'claude-3-5-sonnet-latest';
  if (provider === 'gemini') return 'gemini-2.0-flash';
  return 'gpt-4o-mini';
}

function joinUrl(base, suffix) {
  return `${base.replace(/\/+$/, '')}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw new LlmError('LLM request timed out.', 'timeout');
    throw new LlmError(`LLM request failed: ${err?.message || err}`, 'network_error');
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function providerError(json, status) {
  const msg = json?.error?.message || json?.message || json?.raw || `HTTP ${status}`;
  return `Provider error: ${String(msg).slice(0, 600)}`;
}

function clampNumber(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

export class LlmError extends Error {
  constructor(message, code = 'llm_error') {
    super(message);
    this.name = 'LlmError';
    this.code = code;
  }
}
