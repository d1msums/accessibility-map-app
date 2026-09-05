'use strict';
/**
 * Photo evidence check.
 *
 * Two tiers, so the demo never depends on a paid API being reachable:
 *
 *  1. Basic check (always on, zero dependencies): decodes JPEG/PNG/WebP headers,
 *     rejects non-images, tiny images (< 320 px) and huge payloads. Produces a
 *     human-readable summary ("JPEG 1600×1200").
 *
 *  2. AI check (optional): if GEMINI_API_KEY is set, the photo is sent to Gemini
 *     with the claimed report type and we ask for a strict JSON verdict:
 *        { match: boolean, confidence: 0..1, sees: "short description" }
 *     A confident mismatch lowers the report's evidence base (see store.js) and
 *     flags it for community review. We never auto-delete — humans decide.
 *
 * The result object is stored on the report and rendered in the UI so users see
 * exactly which check ran ("AI photo check" vs "Basic check").
 */

const { typeInfo } = require('./catalogue');

const MAX_BYTES = 6 * 1024 * 1024;
const MIN_DIM = 320;

function parseDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl || '');
  if (!m) return null;
  const mime = m[1].toLowerCase().replace('jpg', 'jpeg');
  const buf = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
  return { mime, buf };
}

function dimensions(buf, mime) {
  try {
    if (mime === 'image/png' && buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        }
        const len = buf.readUInt16BE(i + 2);
        i += 2 + len;
      }
    }
    if (mime === 'image/webp' && buf.toString('ascii', 0, 4) === 'RIFF') {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
      if (chunk === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    }
  } catch { /* fall through */ }
  return null;
}

function basicCheck(dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return { ok: false, reason: 'not_an_image' };
  if (parsed.buf.length > MAX_BYTES) return { ok: false, reason: 'too_large' };
  const dim = dimensions(parsed.buf, parsed.mime);
  if (!dim) return { ok: false, reason: 'unreadable' };
  if (dim.w < MIN_DIM || dim.h < MIN_DIM) return { ok: false, reason: 'too_small', dim };
  return { ok: true, mime: parsed.mime, bytes: parsed.buf.length, dim, base64: parsed.buf.toString('base64') };
}

async function geminiCheck({ base64, mime, type }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const info = typeInfo(type);
  const prompt = `You are verifying a crowdsourced accessibility report in Malaysia.
The reporter claims this photo shows: "${info.en}" (${info.kind}).
Answer ONLY with compact JSON: {"match": true|false, "confidence": 0..1, "sees": "<=12 words describing what the photo shows"}.
"match" is true only if the photo plausibly shows that specific condition.`;
  const body = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: base64 } }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const json = JSON.parse(text.replace(/^```json|```$/g, '').trim());
    return { provider: `gemini:${model}`, match: !!json.match, confidence: Math.max(0, Math.min(1, Number(json.confidence) || 0)), sees: String(json.sees || '').slice(0, 120) };
  } catch (err) {
    return { provider: `gemini:${model}`, error: err.message };
  } finally {
    clearTimeout(t);
  }
}

/** Full pipeline. Returns { ok, summary, ai, penalty, flagged } */
async function checkPhoto(dataUrl, type) {
  const basic = basicCheck(dataUrl);
  if (!basic.ok) return { ok: false, reason: basic.reason, summary: `Rejected: ${basic.reason.replace('_', ' ')}` };
  const summary = `${basic.mime.split('/')[1].toUpperCase()} ${basic.dim.w}×${basic.dim.h}`;
  const ai = await geminiCheck({ base64: basic.base64, mime: basic.mime, type });
  let penalty = 0, flagged = false;
  if (ai && !ai.error && !ai.match && ai.confidence >= 0.7) { penalty = 15; flagged = true; }
  return { ok: true, summary, dim: basic.dim, bytes: basic.bytes, ai, penalty, flagged, enabled: !!process.env.GEMINI_API_KEY };
}

module.exports = { checkPhoto, basicCheck, parseDataUrl, dimensions, MAX_BYTES, MIN_DIM };
