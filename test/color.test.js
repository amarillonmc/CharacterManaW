import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTransform, grayBlend, shadeValue, normalizeColors } from '../server/colors.js';

test('grayBlend matches the original imgctl DLL for the measured sample', () => {
  assert.deepEqual(grayBlend(10, 100, 200, 255), [85, 85, 85]);
  assert.deepEqual(grayBlend(10, 100, 200, 128), [48, 92, 142]);
  assert.deepEqual(grayBlend(10, 100, 200, 0), [10, 100, 200]);
});

test('ShadeDIB is a rounded per-channel multiply', () => {
  assert.equal(shadeValue(150, 950), 143);
  assert.equal(shadeValue(240, 1200), 255);
  assert.equal(shadeValue(7, 900), 6);
});

test('ReplaceDIB selects source channels modulo three', () => {
  const src = Buffer.from([10, 100, 200, 255]);
  const out = applyTransform(src, 1, 1, {
    type: 'standard',
    channels: [2, 0, 0],
    gamma: [1000, 1000, 1000],
    desaturate: 0,
  }, 0);
  assert.deepEqual([...out], [200, 10, 10, 255]);
});

test('GammaDIB uses the original power curve', () => {
  const src = Buffer.from([128, 128, 128, 255]);
  const out = applyTransform(src, 1, 1, {
    type: 'standard',
    channels: [0, 0, 0],
    gamma: [500, 500, 500],
    desaturate: 0,
  }, 0);
  assert.deepEqual([...out], [64, 64, 64, 255]);
});

test('custom colour path applies gamma, tone, and global tone', () => {
  const src = Buffer.from([128, 128, 128, 255]);
  const out = applyTransform(src, 1, 1, {
    type: 'custom',
    channels: [0, 0, 0],
    gamma: [1000, 1000, 1000],
    custom: { r: 10, g: 20, b: 30, w: 50 },
    desaturate: 0,
  }, 2);
  assert.deepEqual([...out], [140, 150, 160, 255]);
});

test('skin shade uses independent R/G/B multipliers', () => {
  const src = Buffer.from([240, 160, 150, 255]);
  const out = applyTransform(src, 1, 1, {
    type: 'skin',
    shade: [750, 750, 1500],
    gamma: 1000,
  }, 0);
  assert.deepEqual([...out], [180, 120, 225, 255]);
});

test('alpha channel is preserved by colour transforms', () => {
  const src = Buffer.from([10, 20, 30, 77]);
  const out = applyTransform(src, 1, 1, { type: 'none' }, 2);
  assert.equal(out[3], 77);
});

test('ver-2 palette 9 converts to the compatibility custom brown', () => {
  const c = normalizeColors({ hair: { palette: 9, gray: 0, legacy: true } });
  assert.equal(c.hair.palette, 8);
  assert.equal(c.hair.mode, 'custom');
  assert.deepEqual(c.hair.custom, { r: 112, g: 34, b: 0, w: 50 });
});

test('normalization fills missing custom colours and legacy fields', () => {
  const c = normalizeColors({
    hair: { palette: 8, gray: 0, custom: { r: 128, g: 64, b: 29, w: 80 } },
    eye: { palette: 2, gray: 3 },
    body: { palette: 0, gray: 3 },
    skin: { palette: 5, gray: 6 },
    bg: [1, 2, 3],
  });
  assert.equal(c.hair.mode, 'custom');
  assert.deepEqual(c.hair.gamma, [1600, 1600, 1600]);
  assert.deepEqual(c.skin.shade, [750, 750, 1500]);
  assert.equal(c.skin.gamma, 700);
  assert.deepEqual(c.bg, [1, 2, 3]);
});
