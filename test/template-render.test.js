import test from 'node:test';
import assert from 'node:assert/strict';
import { TemplateLibrary } from '../server/templates.js';
import { renderCharacter, compositeOver, flipHorizontal } from '../server/render.js';
import { defaultState } from '../server/state.js';
import { planVariants } from '../server/variants.js';

const lib = new TemplateLibrary(process.cwd());

test('bundled default template exposes the original categories', async () => {
  const t = await lib.getTemplate('default');
  assert.equal(t.size.x, 300);
  assert.equal(t.size.y, 400);
  assert.equal(t.encoding, 'cp932');
  assert.equal(t.categories.hair_front.parts.length, 44);
  assert.equal(t.categories.eye.parts.length, 1114);
  assert.equal(t.categories.accessory.parts.length, 298);
  assert.equal(t.defaults.parts.hair_front, 'ナチュラル');
});

test('default render has ten layers and a white opaque corner', async () => {
  const t = await lib.getTemplate('default');
  const state = defaultState(t);
  const r = await renderCharacter(t, state, { mode: 'normal' });
  assert.equal(r.width, 300);
  assert.equal(r.height, 400);
  assert.equal(r.layers.length, 10);
  assert.deepEqual([...r.data.subarray(0, 4)], [255, 255, 255, 255]);
});

test('transparent render starts with zero alpha', async () => {
  const t = await lib.getTemplate('default');
  const state = defaultState(t);
  const r = await renderCharacter(t, state, { mode: 'alpha' });
  assert.equal(r.data[3], 0);
});

test('compositeOver blends straight alpha', () => {
  const dst = Buffer.from([0, 0, 0, 255]);
  const src = Buffer.from([255, 0, 0, 128]);
  compositeOver(dst, 1, 1, src, 1, 1);
  assert.equal(dst[0], 128);
  assert.equal(dst[1], 0);
  assert.equal(dst[2], 0);
  assert.equal(dst[3], 255);
});

test('flipHorizontal swaps edge pixels', () => {
  const data = Buffer.from([
    1, 2, 3, 255,
    4, 5, 6, 255,
    7, 8, 9, 255,
  ]);
  flipHorizontal(data, 3, 1);
  assert.deepEqual([...data], [
    7, 8, 9, 255,
    4, 5, 6, 255,
    1, 2, 3, 255,
  ]);
});

test('variant planner produces the cartesian product and respects the cap', async () => {
  const t = await lib.getTemplate('default');
  const state = defaultState(t);
  const face = t.categories.face.names.slice(0, 2);
  const body = t.categories.body.names.slice(0, 3);
  const plan = planVariants(t, state, { axes: ['face', 'body'], values: { face, body }, limit: 100 });
  assert.equal(plan.count, 6);
  assert.equal(plan.combinations[0].parts.face, face[0]);
  assert.equal(plan.combinations[0].parts.body, body[0]);
  assert.equal(plan.combinations[5].parts.body, body[2]);
  const exact = planVariants(t, state, { axes: ['face', 'body'], values: { face, body }, limit: 6 });
  assert.equal(exact.count, 6);
  assert.equal(exact.truncated, false);
  const capped = planVariants(t, state, { axes: ['face', 'body'], values: { face, body }, limit: 4 });
  assert.equal(capped.count, 4);
  assert.equal(capped.truncated, true);
});
