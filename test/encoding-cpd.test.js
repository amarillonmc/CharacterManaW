import test from 'node:test';
import assert from 'node:assert/strict';
import iconv from 'iconv-lite';
import { decodeText, encodeCompatibleText } from '../server/encoding.js';
import { buildCpd, parseCpd } from '../server/cpd.js';
import { parseIni, serializeIni } from '../server/ini.js';

test('decodes Shift-JIS character.ini text', () => {
  const text = '[Parts]\r\nhair_front=ナチュラル\r\nface=笑い(口閉じ)\r\n';
  const decoded = decodeText(iconv.encode(text, 'cp932'));
  assert.equal(decoded.encoding, 'cp932');
  assert.match(decoded.text, /ナチュラル/);
  assert.match(decoded.text, /笑い\(口閉じ\)/);
});

test('decodes UTF-8 and UTF-16LE with BOM', () => {
  const text = '[Character]\r\nname=テスト\r\n';
  assert.equal(decodeText(Buffer.from(text, 'utf8')).encoding, 'utf-8');
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(text, 'utf-16le')]);
  assert.equal(decodeText(utf16).encoding, 'utf-16le');
  assert.match(decodeText(utf16).text, /テスト/);
});

test('detects UTF-16LE without a BOM', () => {
  const text = '[Parts]\r\nhair_front=ナチュラル\r\n';
  const decoded = decodeText(iconv.encode(text, 'utf-16le'));
  assert.equal(decoded.encoding, 'utf-16le');
  assert.match(decoded.text, /ナチュラル/);
});

test('falls back to UTF-8 when CP932 cannot represent a name', () => {
  const out = encodeCompatibleText('name=😀', 'cp932');
  assert.equal(out.lossy, true);
  assert.equal(out.encoding, 'utf-8');
  assert.deepEqual([...out.buffer.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test('INI parser is case-insensitive and ignores comments', () => {
  const ini = parseIni('; comment\r\n[Parts]\r\nHair_Front = ナチュラル\r\n');
  assert.equal(ini.parts.hair_front, ' ナチュラル');
});

test('INI parser does not pollute Object.prototype', () => {
  const ini = parseIni('[__proto__]\nPolluted=yes\n');
  assert.equal({}.Polluted, undefined);
  assert.equal(ini.__proto__?.polluted, 'yes');
});

test('INI writer uses CRLF and no blank sections', () => {
  const text = serializeIni([{ name: 'A', entries: [['x', '1']] }, { name: 'B', entries: [['y', '2']] }]);
  assert.equal(text, '[A]\r\nx=1\r\n[B]\r\ny=2\r\n');
});

test('CPD round-trips Japanese parts and custom colours as CP932', () => {
  const cpd = buildCpd({
    templateId: 'default',
    parts: {
      hair_front: 'ナチュラル',
      hair_back: 'セミロング',
      head: '普通な顔1',
      face: '笑い(口閉じ)',
      eye: '普通な目1',
      body: 'セーラー服1',
      accessory: ['もみあげ内向き3(髪)'],
    },
    colors: {
      hair: { palette: 8, gray: 3, custom: { r: 128, g: 64, b: 29, w: 80 } },
      eye: { palette: 2, gray: 3, custom: { r: 64, g: 64, b: 64, w: 50 } },
      body: { palette: 0, gray: 3, custom: { r: 64, g: 64, b: 64, w: 50 } },
      skin: { palette: 0, gray: 3 },
      bg: [255, 255, 255],
    },
  });
  assert.equal(cpd.encoding, 'cp932');
  const parsed = parseCpd(cpd.buffer);
  assert.equal(parsed.name, 'default');
  assert.equal(parsed.parts.hair_front, 'ナチュラル');
  assert.deepEqual(parsed.parts.accessory, ['もみあげ内向き3(髪)']);
  assert.deepEqual(parsed.colors.hair.custom, { r: 128, g: 64, b: 29, w: 80 });
  assert.equal(parsed.colors.body.palette, 0);
});
