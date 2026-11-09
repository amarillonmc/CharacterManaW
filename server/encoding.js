import iconv from 'iconv-lite';

export function hasBom(buf) {
  return (
    (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) ||
    (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) ||
    (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff)
  );
}

export function decodeText(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length === 0) return { text: '', encoding: 'utf-8', confidence: 1 };

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString('utf8'), encoding: 'utf-8', confidence: 1 };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: iconv.decode(buffer.subarray(2), 'utf-16le'), encoding: 'utf-16le', confidence: 1 };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { text: iconv.decode(buffer.subarray(2), 'utf-16be'), encoding: 'utf-16be', confidence: 1 };
  }

  const preferred = normalizeEncoding(options.preferred);
  if (preferred) {
    return { text: iconv.decode(buffer, preferred), encoding: preferred, confidence: 1 };
  }

  // Some Windows editors write UTF-16LE without a BOM.  Detect the
  // alternating-NUL signature before falling through to a legacy code page.
  const utf16 = guessUtf16NoBom(buffer);
  if (utf16) {
    const text = iconv.decode(buffer, utf16);
    if (!text.includes('\u0000')) return { text, encoding: utf16, confidence: 0.9 };
  }

  // Strict UTF-8 first.  CP932 text with many Japanese characters is rarely
  // valid UTF-8, while real UTF-8 templates are common in modern packs.
  const utf8 = tryStrictUtf8(buffer);
  if (utf8 !== null && looksLikeUtf8Text(utf8)) {
    return { text: utf8, encoding: 'utf-8', confidence: 0.95 };
  }

  // Japanese legacy encodings.  CP932 is by far the most common for this app.
  // A short CP932/EUC-JP structural score is more predictable than a generic
  // charset detector for these small INI files.
  const cp932 = iconv.decode(buffer, 'cp932');
  const eucjp = iconv.decode(buffer, 'euc-jp');
  const cpScore = japaneseScore(cp932, buffer, 'cp932');
  const eucScore = japaneseScore(eucjp, buffer, 'euc-jp');
  if (cpScore >= eucScore) {
    return { text: cp932, encoding: 'cp932', confidence: Math.min(0.9, 0.4 + cpScore / 100) };
  }
  return { text: eucjp, encoding: 'euc-jp', confidence: Math.min(0.9, 0.4 + eucScore / 100) };
}

export function encodeText(text, encoding = 'cp932') {
  const enc = normalizeEncoding(encoding) || 'cp932';
  return iconv.encode(String(text ?? ''), enc);
}

export function encodeCompatibleText(text, preferred = 'cp932') {
  const value = String(text ?? '');
  const enc = normalizeEncoding(preferred) || 'cp932';
  if (enc === 'utf-8') {
    return { buffer: Buffer.from(value, 'utf8'), encoding: 'utf-8', lossy: false };
  }
  if (enc === 'utf-16le' || enc === 'utf-16be') {
    return { buffer: iconv.encode(value, enc), encoding: enc, lossy: false };
  }
  const encoded = iconv.encode(value, enc);
  const roundtrip = iconv.decode(encoded, enc);
  if (roundtrip === value) {
    return { buffer: encoded, encoding: enc, lossy: false };
  }
  // Fall back to UTF-8 with BOM so our own reader can round-trip data that
  // the legacy ANSI code page cannot represent.  The UI warns the user.
  return { buffer: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(value, 'utf8')]), encoding: 'utf-8', lossy: true };
}

export function normalizeEncoding(name) {
  if (!name) return null;
  const n = String(name).toLowerCase().replace(/[_\s]/g, '-');
  if (n === 'shift-jis' || n === 'shift_jis' || n === 'sjis' || n === 'cp932' || n === 'ms932' || n === 'windows-31j') return 'cp932';
  if (n === 'euc-jp' || n === 'eucjp') return 'euc-jp';
  if (n === 'utf-8' || n === 'utf8') return 'utf-8';
  if (n === 'utf-16le' || n === 'utf-16-le') return 'utf-16le';
  if (n === 'utf-16be' || n === 'utf-16-be') return 'utf-16be';
  if (n === 'ascii' || n === 'us-ascii') return 'utf-8';
  return null;
}

function guessUtf16NoBom(buffer) {
  if (buffer.length < 4 || buffer.length % 2 !== 0) return null;
  let leZeros = 0;
  let beZeros = 0;
  const units = buffer.length / 2;
  for (let i = 0; i < buffer.length; i += 2) {
    if (buffer[i + 1] === 0) leZeros++;
    if (buffer[i] === 0) beZeros++;
  }
  if (leZeros / units > 0.35 && leZeros > beZeros * 1.5) return 'utf-16le';
  if (beZeros / units > 0.35 && beZeros > leZeros * 1.5) return 'utf-16be';
  return null;
}

function tryStrictUtf8(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function looksLikeUtf8Text(text) {
  if (!text) return true;
  // A lone NUL or a high ratio of replacement-looking control bytes is a
  // sign that this was actually a legacy Japanese byte stream.
  if (text.includes('\u0000')) return false;
  const jp = (text.match(/[\u3040-\u30ff\u3400-\u9fff]/g) || []).length;
  if (jp > 0) return true;
  // Pure ASCII is safe.
  return /^[\x09\x0a\x0d\x20-\x7e]*$/.test(text);
}

function japaneseScore(text, buffer, encoding) {
  let score = 0;
  const jp = (text.match(/[\u3040-\u30ff\u3400-\u9fff]/g) || []).length;
  score += jp * 4;
  const bad = (text.match(/\ufffd/g) || []).length;
  score -= bad * 10;
  if (encoding === 'cp932') {
    // Common CP932 lead/trail byte structure.
    let pairs = 0;
    for (let i = 0; i < buffer.length - 1; i++) {
      const b = buffer[i];
      if ((b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xef)) {
        const t = buffer[i + 1];
        if (t >= 0x40 && t <= 0xfc && t !== 0x7f) {
          pairs++;
          i++;
        }
      }
    }
    score += Math.min(40, pairs);
  } else if (encoding === 'euc-jp') {
    let pairs = 0;
    for (let i = 0; i < buffer.length - 1; i++) {
      if (buffer[i] >= 0xa1 && buffer[i] <= 0xfe && buffer[i + 1] >= 0xa1 && buffer[i + 1] <= 0xfe) {
        pairs++;
        i++;
      }
    }
    score += Math.min(40, pairs);
  }
  return Math.max(0, score);
}

export function detectFilenameEncoding(nameBuffer) {
  // ZIP entry names without the UTF-8 flag are usually CP437.  For these
  // Japanese template packs CP932 is the useful fallback.
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(nameBuffer);
    if (looksLikeUtf8Text(utf8)) return utf8;
  } catch {
    // ignore
  }
  return iconv.decode(nameBuffer, 'cp932');
}
