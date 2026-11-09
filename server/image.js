import pngjs from 'pngjs';
import sharp from 'sharp';
import zlib from 'node:zlib';

const { PNG } = pngjs;

export function encodePng(data, width, height) {
  const png = new PNG({ width, height });
  png.data = Buffer.from(data);
  return PNG.sync.write(png, { colorType: 6, inputColorType: 6, deflateLevel: 6 });
}

export function encodePngRgb(data, width, height) {
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }
  const png = new PNG({ width, height });
  png.data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgb[i * 3];
    png.data[i * 4 + 1] = rgb[i * 3 + 1];
    png.data[i * 4 + 2] = rgb[i * 3 + 2];
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png, { colorType: 2, inputColorType: 6, deflateLevel: 6 });
}

export function encodeBmp24(data, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelSize = rowSize * height;
  const fileSize = 14 + 40 + pixelSize;
  const buf = Buffer.alloc(fileSize);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelSize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    let off = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const i = (srcY * width + x) * 4;
      buf[off++] = data[i + 2];
      buf[off++] = data[i + 1];
      buf[off++] = data[i];
    }
  }
  return buf;
}

export async function encodeJpeg(data, width, height, quality = 80, background = [255, 255, 255]) {
  const rgb = flattenToRgb(data, width, height, background);
  return sharp(rgb, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: clamp(Math.round(quality), 1, 100), mozjpeg: true })
    .toBuffer();
}

export async function encodeGif(data, width, height, background = [255, 255, 255]) {
  const rgb = flattenToRgb(data, width, height, background);
  return sharp(rgb, { raw: { width, height, channels: 3 } })
    .gif({ colours: 256, effort: 7 })
    .toBuffer();
}

export async function encodePna(data, width, height) {
  const gray = Buffer.alloc(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) gray[j] = data[i + 3];
  // Encode a real 8-bit grayscale PNG (color type 0), as expected by PNA
  // consumers such as SSP.  sharp may expand grayscale to RGB, so write the
  // chunks directly.
  return encodeGrayscalePng(gray, width, height);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

export function encodeGrayscalePng(gray, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width + 1);
    raw[row] = 0;
    gray.copy(raw, row + 1, y * width, (y + 1) * width);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Build a 24-bit surface image with a transparent colour key.  The key is
 * selected from a small list of colours not present in the image.  Fully
 * transparent pixels and pixels whose alpha is below `threshold` become key
 * coloured.  This mirrors the original's "no antialiasing" palette threshold
 * closely enough for SSP and is deterministic.
 */
export function makeSurface(data, width, height, threshold = 105) {
  const used = new Set();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] >= threshold) {
      used.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
  }
  const candidates = [0xff00ff, 0x00ff00, 0x00ffff, 0xffff00, 0x010101, 0xfefefe, 0x7f007f, 0x007f7f];
  let key = candidates.find((c) => !used.has(c));
  if (key === undefined) {
    for (let c = 1; c < 0x1000000; c++) {
      if (!used.has(c) && (c & 0xff) !== 0 && ((c >> 8) & 0xff) !== 0 && ((c >> 16) & 0xff) !== 0) {
        key = c;
        break;
      }
    }
  }
  if (key === undefined) key = 0xff00ff;
  const out = Buffer.alloc(width * height * 3);
  const kr = (key >> 16) & 0xff;
  const kg = (key >> 8) & 0xff;
  const kb = key & 0xff;
  let o = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < threshold) {
      out[o++] = kr;
      out[o++] = kg;
      out[o++] = kb;
    } else {
      out[o++] = data[i];
      out[o++] = data[i + 1];
      out[o++] = data[i + 2];
    }
  }
  // The original forces the top-left pixel to the key colour.
  out[0] = kr;
  out[1] = kg;
  out[2] = kb;
  return { rgb: out, key: [kr, kg, kb] };
}

export async function encodeSurfacePng(data, width, height, threshold = 105) {
  const { rgb, key } = makeSurface(data, width, height, threshold);
  const buf = await sharp(rgb, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 6 }).toBuffer();
  return { buffer: buf, key };
}

export async function resizePng(data, width, height, targetWidth, targetHeight = null, fit = 'inside') {
  let img = sharp(data, { raw: { width, height, channels: 4 } });
  if (fit === 'fill') {
    img = img.resize(targetWidth, targetHeight, { fit: 'fill' });
  } else {
    img = img.resize({ width: targetWidth, height: targetHeight, fit: 'inside', withoutEnlargement: true });
  }
  return img.png({ compressionLevel: 6 }).toBuffer();
}

export function flattenToRgb(data, width, height, background = [255, 255, 255]) {
  const out = Buffer.alloc(width * height * 3);
  const [br, bg, bb] = background;
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    const a = data[i + 3] / 255;
    if (a >= 1) {
      out[j] = data[i];
      out[j + 1] = data[i + 1];
      out[j + 2] = data[i + 2];
    } else if (a <= 0) {
      out[j] = br;
      out[j + 1] = bg;
      out[j + 2] = bb;
    } else {
      out[j] = clamp(Math.round(data[i] * a + br * (1 - a)), 0, 255);
      out[j + 1] = clamp(Math.round(data[i + 1] * a + bg * (1 - a)), 0, 255);
      out[j + 2] = clamp(Math.round(data[i + 2] * a + bb * (1 - a)), 0, 255);
    }
  }
  return out;
}

export function thresholdAlpha(data, threshold = 105) {
  const out = Buffer.from(data);
  for (let i = 3; i < out.length; i += 4) {
    out[i] = out[i] >= threshold ? 255 : 0;
  }
  return out;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
