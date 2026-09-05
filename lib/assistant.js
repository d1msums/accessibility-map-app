'use strict';
/**
 * KitaBantu assistant — Gemini-powered brain for the in-app voice helper and
 * the on-site camera assessment.
 *
 *   chat({ text, lang, ctx })  -> { say, action, lang }
 *       action ∈ { type: 'navigate', query } | { type: 'find_places', query, kind }
 *              | { type: 'open_request', id } | { type: 'next_step' } | { type: 'repeat' }
 *              | { type: 'open_camera' } | { type: 'stop' } | { type: 'none' }
 *   assess({ dataUrl, question, need, place, lang })  -> structured accessibility verdict
 *
 * Model: GEMINI_MODEL (default gemini-3.6-flash). Thinking is kept minimal for
 * latency; the camera assessment gets a low budget because it is safety relevant.
 */
const MODEL = () => process.env.GEMINI_MODEL || 'gemini-3.6-flash';
// Free-tier keys are limited per model (≈20 req/min); on 429 we hop to the next model.
const FALLBACKS = () => [MODEL(), 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'].filter((m, i, a) => a.indexOf(m) === i);
const KEY = () => process.env.GEMINI_API_KEY || '';
const enabled = () => !!KEY();
const cooldown = new Map(); // model -> timestamp until which it is rate-limited
let lastGood = null; // the model that answered most recently — tried first (free tier is spiky, 503s are per model)
function order() { const list = FALLBACKS(); return lastGood && list.includes(lastGood) ? [lastGood, ...list.filter((m) => m !== lastGood)] : list; }

async function callModel(model, body, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY() }, body: JSON.stringify(body), signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error?.message || `Gemini ${res.status}`); e.status = res.status; throw e; }
    return data;
  } finally { clearTimeout(t); }
}

function parseOut(data, model) {
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('') || '{}';
  return { json: JSON.parse(text.replace(/^```json|```$/g, '').trim()), usage: data.usageMetadata || null, model };
}
function noteFailure(model, err) {
  if (err.status === 429) { const m = /retry in ([\d.]+)s/i.exec(err.message); cooldown.set(model, Date.now() + Math.min(60e3, (m ? Number(m[1]) : 20) * 1000)); }
  else if (err.status === 503 || err.status === 500) cooldown.set(model, Date.now() + 30e3); // "high demand"
  else if (err.name === 'AbortError') cooldown.set(model, Date.now() + 20e3); // too slow right now
  if (lastGood === model) lastGood = null;
}

/**
 * Hedged generation: the free tier answers in <1 s or not at all (429/503/hangs), so instead of
 * trying models strictly one after another we start the next candidate after `hedgeMs` while the
 * previous is still in flight; the first successful answer wins, failures start the next immediately.
 */
function generate(parts, { schema = null, thinking = 'minimal', temperature = 0.3, timeoutMs = 25000, hedgeMs = 5000, system = null } = {}) {
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: thinking } },
  };
  if (schema) body.generationConfig.responseSchema = schema;
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  let models = order().filter((m) => (cooldown.get(m) || 0) <= Date.now());
  if (!models.length) models = order(); // everything is cooling down: try anyway rather than fail instantly
  return new Promise((resolve, reject) => {
    let idx = 0, inflight = 0, done = false, lastErr = null;
    const launch = () => {
      if (done) return;
      if (idx >= models.length) { if (inflight === 0) reject(lastErr || new Error('no_model_available')); return; }
      const model = models[idx++]; inflight++;
      const hedge = setTimeout(launch, hedgeMs);
      callModel(model, body, timeoutMs)
        .then((data) => { clearTimeout(hedge); inflight--; if (done) return; try { const out = parseOut(data, model); done = true; lastGood = model; resolve(out); } catch (err) { lastErr = err; launch(); } })
        .catch((err) => { clearTimeout(hedge); inflight--; lastErr = err; noteFailure(model, err); if (!done) launch(); });
    };
    launch();
  });
}

// ---------- voice / text assistant ----------
const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    say: { type: 'string', description: 'Short spoken reply (max 2 sentences) in the user\'s language.' },
    lang: { type: 'string', enum: ['en', 'ms'] },
    action: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['navigate', 'find_places', 'open_request', 'next_step', 'repeat', 'open_camera', 'stop', 'ask_community', 'none'] },
        query: { type: 'string' },
        kind: { type: 'string', enum: ['any', 'mall', 'transit', 'hospital', 'toilet', 'parking', 'restaurant', 'pharmacy', 'mosque', 'bank'] },
        id: { type: 'string' },
      },
      required: ['type'],
    },
  },
  required: ['say', 'lang', 'action'],
};

const SYSTEM = `You are KitaBantu Assistant, a calm, concise voice helper inside a Malaysian accessibility app for OKU (persons with disabilities) and community helpers.
Users speak English or Bahasa Melayu (often mixed). Detect the language of the user's message and reply in that language; set "lang" accordingly.
Keep "say" to one or two short sentences suitable for text-to-speech. Never use emoji or markdown.
Choose exactly one action:
- navigate: user wants directions / to be taken somewhere. "query" = the destination name or address as they said it (or the request's place if they refer to "this task"/"the request").
- find_places: user asks what is around / nearby places / where is the nearest X. Set "kind" (mall, transit, hospital, toilet, parking, restaurant, pharmacy, mosque, bank or any) and "query" (free text, may be empty).
- open_request: user refers to a specific open request/task from the context list; "id" = its id.
- next_step / repeat: during navigation, user asks for the next or the last instruction again.
- open_camera: user has arrived / wants to take the photo / check the place with the camera.
- stop: user wants to stop navigation or the assistant.
- ask_community: user (an OKU member) wants to ask the community whether a place is accessible; "query" = the place.
- none: a question you can answer directly from the context (e.g. how many points, what is the next step text, is a place reported accessible) or small talk.
Use the context: current location name, active navigation (next instruction, distance left), open requests near the user, and nearby community reports with trust scores. If asked about a place's accessibility, summarise the community reports honestly, mention how recent/trusted they are, and suggest asking the community when nothing is known.`;

async function chat({ text, lang = 'en', ctx = {} }) {
  if (!enabled()) return { say: lang === 'ms' ? 'Pembantu AI tidak tersedia sekarang.' : 'The AI assistant is not available right now.', lang, action: { type: 'none' }, offline: true };
  const context = JSON.stringify({
    ui_language: lang,
    user: ctx.user || null,
    location: ctx.location || null,
    navigation: ctx.navigation || null,
    open_requests: (ctx.requests || []).slice(0, 8),
    nearby_reports: (ctx.reports || []).slice(0, 12),
    nearby_places: (ctx.places || []).slice(0, 8),
    time: new Date().toISOString(),
  });
  const parts = [{ text: `CONTEXT:\n${context}\n\nUSER SAID:\n${text}` }];
  const opts = { schema: CHAT_SCHEMA, system: SYSTEM, thinking: 'minimal', temperature: 0.2 };
  // Gemini occasionally stalls; a short first attempt + one retry keeps the voice UI snappy.
  let json, model;
  ({ json, model } = await generate(parts, { ...opts, timeoutMs: 20000, hedgeMs: 4000 }));
  return { say: String(json.say || '').slice(0, 400), lang: json.lang === 'ms' ? 'ms' : 'en', action: json.action && json.action.type ? json.action : { type: 'none' }, model };
}

// ---------- on-site camera assessment ----------
const ASSESS_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['yes', 'partly', 'no', 'unclear'] },
    score: { type: 'integer', description: '0-100 accessibility score for the asked need, right now, from what is visible' },
    summary: { type: 'string', description: 'One or two sentences, plain language, for text-to-speech' },
    findings: {
      type: 'array',
      items: { type: 'object', properties: { aspect: { type: 'string' }, status: { type: 'string', enum: ['ok', 'issue', 'unknown'] }, note: { type: 'string' } }, required: ['aspect', 'status', 'note'] },
    },
    hazards: { type: 'array', items: { type: 'string' } },
    suggested_report: { type: 'string', enum: ['none', 'ramp', 'lift_ok', 'tactile', 'toilet', 'entrance', 'crossing', 'parking', 'staff', 'lift_broken', 'kerb_blocked', 'construction', 'pavement', 'steps_only', 'parking_blocked', 'tactile_blocked', 'other_obstacle'] },
    relevant: { type: 'boolean', description: 'false if the photo does not show the place/feature asked about' },
    confidence: { type: 'number' },
  },
  required: ['verdict', 'score', 'summary', 'findings', 'hazards', 'suggested_report', 'relevant', 'confidence'],
};

const NEED_TEXT = { wheelchair: 'a wheelchair user (step-free access, ramps with gentle gradient, lift working, door width, level surfaces, accessible toilet, OKU parking)', visual: 'a blind or low-vision person (tactile paving continuity, obstacles on the walking line, contrast, audible signals, clear paths, hazards at head height)', elderly: 'an elderly person with limited mobility (handrails, steps count, resting places, uneven pavement, lift/escalator availability, distance)' };

async function assess({ dataUrl, question = '', need = 'wheelchair', place = '', lang = 'en' }) {
  if (!enabled()) return { ok: false, reason: 'ai_off' };
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i.exec(dataUrl || '');
  if (!m) return { ok: false, reason: 'not_an_image' };
  const prompt = `You are assessing real-world accessibility for ${NEED_TEXT[need] || NEED_TEXT.wheelchair} in Malaysia.
Place: ${place || 'unknown'}.
Question being answered: "${question || 'Is this place accessible right now?'}".
Look only at what is visible in the photo. Be concrete (e.g. "ramp present but gradient looks steep, about 1:6", "lift doors open, indicator lit", "sign says LIF ROSAK").
Write "summary" and all "note" fields in ${lang === 'ms' ? 'Bahasa Melayu' : 'English'}. No emoji.
"score": 90-100 fully usable now; 60-89 usable with minor issues; 30-59 significant barriers; 0-29 not usable / blocked. If the photo does not show the relevant feature, set relevant=false, verdict="unclear" and explain what to photograph instead.
"suggested_report": the KitaBantu report type that best matches what you see (feature types: ramp, lift_ok, tactile, toilet, entrance, crossing, parking, staff; obstacle types: lift_broken, kerb_blocked, construction, pavement, steps_only, parking_blocked, tactile_blocked, other_obstacle), or none.`;
  try {
    const { json, usage, model } = await generate([{ inline_data: { mime_type: m[1].toLowerCase(), data: m[2] } }, { text: prompt }], { schema: ASSESS_SCHEMA, thinking: 'low', temperature: 0.2, timeoutMs: 35000, hedgeMs: 8000 });
    return {
      ok: true, model,
      verdict: json.verdict, score: Math.max(0, Math.min(100, Math.round(Number(json.score) || 0))), summary: String(json.summary || '').slice(0, 600),
      findings: (json.findings || []).slice(0, 8), hazards: (json.hazards || []).slice(0, 6), suggestedReport: json.suggested_report || 'none', relevant: json.relevant !== false,
      confidence: Math.max(0, Math.min(1, Number(json.confidence) || 0)), tokens: usage ? usage.totalTokenCount : null,
    };
  } catch (err) {
    return { ok: false, reason: 'ai_error', message: err.message };
  }
}

module.exports = { chat, assess, enabled, MODEL };
