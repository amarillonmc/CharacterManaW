import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { generatePrompt, parseImageDataUrl, buildPromptContext } from '../server/llm.js';

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==';

test('parseImageDataUrl accepts a PNG data URL', () => {
  const image = parseImageDataUrl(`data:image/png;base64,${ONE_PIXEL_PNG}`);
  assert.equal(image.mimeType, 'image/png');
  assert.ok(image.bytes > 0);
  assert.equal(image.data, ONE_PIXEL_PNG);
});

test('parseImageDataUrl rejects invalid or oversized references', () => {
  assert.equal(parseImageDataUrl(null), null);
  assert.throws(() => parseImageDataUrl('data:text/plain;base64,aGVsbG8='), /data URL/);
  assert.throws(() => parseImageDataUrl('data:image/png;base64,aGVsbG8='), /do not match/);
  const huge = Buffer.alloc(8 * 1024 * 1024 + 1);
  assert.throws(() => parseImageDataUrl(`data:image/png;base64,${huge.toString('base64')}`), /too large/);
});

test('prompt context tells the model to use an attached preview image', () => {
  const base = {
    state: {},
    template: { id: 'default', name: 'default', size: { x: 300, y: 400 } },
    description: '',
  };
  const withImage = buildPromptContext(base, { targetKey: 'generic', target: { label: 'Generic', style: '' }, language: 'en', hasImage: true });
  assert.match(withImage.system, /preview image/i);
  assert.match(withImage.user, /primary visual reference/i);
  const without = buildPromptContext(base, { targetKey: 'generic', target: { label: 'Generic', style: '' }, language: 'en', hasImage: false });
  assert.doesNotMatch(without.system, /preview image/i);
  assert.doesNotMatch(without.user, /primary visual reference/i);
});

test('OpenAI-compatible request carries the reference image as image_url', async () => {
  let captured = null;
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      captured = JSON.parse(body);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ prompt: 'derived prompt', negative_prompt: '', tags: ['image'], notes: '' }) } }] }));
    });
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  try {
    const result = await generatePrompt({
      provider: 'openai',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: 'test',
      model: 'mock',
      target: 'gpt-image',
      language: 'en',
      image: `data:image/png;base64,${ONE_PIXEL_PNG}`,
      state: {},
      template: { id: 'default', name: 'default', size: { x: 300, y: 400 } },
    });
    assert.equal(result.prompt, 'derived prompt');
    assert.equal(result.usedReferenceImage, true);
    const content = captured.messages[1].content;
    assert.ok(Array.isArray(content));
    assert.equal(content[0].type, 'text');
    assert.equal(content[1].type, 'image_url');
    assert.match(content[1].image_url.url, /^data:image\/png;base64,/);
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
});
