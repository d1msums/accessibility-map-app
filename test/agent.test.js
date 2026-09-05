'use strict';
const test = require('node:test');
const assert = require('node:assert');
const agent = require('../lib/agent');
const places = require('../lib/places');

const HERE = { lat: 2.9213, lng: 101.6559 };
const exec = async (name, args) => {
  if (name === 'search_places') {
    const r = await places.around({ ...HERE, kind: args.kind || 'any', radius: args.radius_m || 1500, lang: 'en', q: args.query || '' });
    return { count: r.places.length, places: r.places.slice(0, 8).map((p) => ({ name: p.name, lat: p.lat, lng: p.lng, type: p.type, distM: Math.round(Math.hypot((p.lat - HERE.lat) * 111320, (p.lng - HERE.lng) * 111320)) })) };
  }
  if (name === 'list_requests') return { count: 2, requests: [{ id: 'q_dpulze_lift', place: 'DPulze Shopping Centre', question: 'Is the lift working', by: 'Aisha Rahman', lat: 2.922, lng: 101.651, distM: 600 }, { id: 'q_shaftsbury_toilet', place: 'Shaftsbury Square', question: 'Is the OKU toilet open', by: 'Kumar Selvam', lat: 2.923, lng: 101.662, distM: 700 }] };
  if (name === 'answer_request') return { ok: true, points: 25, args };
  if (name === 'create_request') return { ok: true, id: 'q_new', args };
  return { error: 'unexpected ' + name };
};

test('tool catalogue covers the whole app', () => {
  const names = [...agent.SERVER_TOOLS, ...agent.CLIENT_TOOLS].map((t) => t.name);
  for (const n of ['search_places', 'geocode', 'list_requests', 'answer_request', 'create_request', 'create_report', 'verify_report', 'thank_answer', 'plan_route', 'get_profile', 'update_profile', 'get_leaderboard', 'start_navigation', 'stop_navigation', 'show_places_on_map', 'focus_map', 'open_screen', 'open_camera', 'prefill_ask', 'set_language', 'set_setting', 'logout']) assert.ok(names.includes(n), n);
  assert.ok(names.length >= 28);
});

test('quick intents resolve app commands locally (no LLM)', () => {
  const q = (t, extra = {}) => agent.quickIntent(t, { lang: 'en', role: 'helper', ...extra });
  assert.deepStrictEqual(q('show the leaderboard').actions, [{ type: 'open_screen', screen: 'community' }]);
  assert.deepStrictEqual(q('buka peta').actions, [{ type: 'open_screen', screen: 'map' }]);
  assert.strictEqual(q('buka peta').lang, 'ms');
  assert.deepStrictEqual(q('tukar ke bahasa melayu').actions, [{ type: 'set_language', lang: 'ms' }]);
  assert.deepStrictEqual(q('turn on large text and mute the voice').actions, [{ type: 'set_setting', mute: true, large_text: true }]);
  assert.deepStrictEqual(q('stop navigation', { nav: { active: true } }).actions, [{ type: 'stop_navigation' }]);
  assert.deepStrictEqual(q('saya dah sampai', { nav: { requestId: 'q1' } }).actions, [{ type: 'open_camera', request_id: 'q1' }]);
  assert.deepStrictEqual(q('open permissions').actions, [{ type: 'set_setting', permissions: true }]);
  assert.deepStrictEqual(q('log out').actions, [{ type: 'logout' }]);
  // these need the LLM (or the rule-based fallback)
  assert.strictEqual(q('take me to DPulze'), null);
  assert.strictEqual(q('is the lift at DPulze working?'), null);
  assert.strictEqual(q('what tasks are near me?'), null);
});

test('rule-based fallback: whole-map search + navigation + tasks', async () => {
  let r = await agent.fallback('take me to DPulze', { lang: 'en', exec, role: 'helper' });
  assert.strictEqual(r.actions[0].type, 'start_navigation');
  assert.match(r.actions[0].label, /DPulze/);
  r = await agent.fallback('where is Gem In Mall', { lang: 'en', exec, role: 'helper' });
  assert.strictEqual(r.actions[0].type, 'focus_map');
  assert.strictEqual(r.actions[0].label, 'Gem In Mall');
  r = await agent.fallback('cari farmasi terdekat', { lang: 'en', exec, role: 'helper' });
  assert.deepStrictEqual(r.actions[0], { type: 'show_places_on_map', kind: 'pharmacy', query: '' });
  assert.strictEqual(r.lang, 'ms');
  r = await agent.fallback('take me to the second task', { lang: 'en', exec, role: 'helper' });
  assert.strictEqual(r.actions[0].request_id, 'q_shaftsbury_toilet');
  r = await agent.fallback("open Kumar's task", { lang: 'en', exec, role: 'helper' });
  assert.deepStrictEqual(r.actions[0], { type: 'open_screen', screen: 'request:q_shaftsbury_toilet' });
});

test('rule-based fallback: answer a request / ask the community by voice', async () => {
  let r = await agent.fallback("Answer Kumar's Shaftsbury toilet request: yes it is accessible, the OKU toilet is open and clean", { lang: 'en', exec, role: 'helper' });
  assert.match(r.say, /submitted/i);
  assert.match(r.say, /25 points/);
  r = await agent.fallback('jawab permintaan lif DPulze: tidak, lif rosak', { lang: 'en', exec, role: 'helper' });
  assert.match(r.say, /"tidak"/);
  r = await agent.fallback('answer the toilet request', { lang: 'en', exec, role: 'helper' });
  assert.match(r.say, /yes, partly or no/);
  r = await agent.fallback('tanya komuniti sama ada tandas OKU di Gem In Mall dibuka hari ini', { lang: 'ms', exec, role: 'oku' });
  assert.match(r.say, /Gem In Mall/);
  assert.deepStrictEqual(r.actions[0], { type: 'open_screen', screen: 'request:q_new' });
  // helpers cannot create requests; OKU cannot answer → falls through
  r = await agent.fallback('ask the community if the lift works', { lang: 'en', exec, role: 'helper' });
  assert.ok(!r.actions.some((a) => a.type === 'open_screen' && a.screen === 'request:q_new'));
});

test('places: free-text understands names and EN/BM categories', async () => {
  const q = async (text) => (await places.around({ ...HERE, kind: 'any', radius: 1500, lang: 'en', q: text })).places;
  assert.strictEqual((await q('Gem In Mall'))[0].name, 'Gem In Mall');
  assert.strictEqual((await q('Hospital Cyberjaya'))[0].name, 'Hospital Cyberjaya');
  assert.ok((await q('farmasi terdekat')).every((p) => p.type === 'pharmacy'));
  assert.ok((await q('tandas OKU')).every((p) => p.type === 'toilets'));
  assert.strictEqual((await q('nearest bank'))[0].name, 'CIMB Bank');
  assert.strictEqual((await q('Guardian pharmacy'))[0].name, 'Guardian');
  assert.deepStrictEqual(places.parseQuery('surau terdekat'), { kind: 'mosque', rest: [], pureCategory: true });
});

test('language guess', () => {
  assert.strictEqual(agent.guessLang('bawa saya ke DPulze', 'en'), 'ms');
  assert.strictEqual(agent.guessLang('take me to DPulze', 'ms'), 'en');
  assert.strictEqual(agent.guessLang('DPulze', 'ms'), 'ms');
});

test('memory transcript stays valid for Gemini (pairs intact, starts with user text, ends with model text)', () => {
  const src = require('fs').readFileSync(require.resolve('../lib/agent.js'), 'utf8');
  const start = src.indexOf('const isText'); const end = src.indexOf('function clearMemory');
  const m = { exports: {} };
  new Function('module', src.slice(start, end) + '\nmodule.exports = { trimTurns };')(m);
  const call = { role: 'model', parts: [{ functionCall: { name: 'x', args: {} } }] };
  const resp = { role: 'user', parts: [{ functionResponse: { name: 'x', response: { result: {} } } }] };
  const u = (t) => ({ role: 'user', parts: [{ text: t }] }); const md = (t) => ({ role: 'model', parts: [{ text: t }] });
  assert.deepStrictEqual(m.exports.trimTurns([resp, md('a'), u('q'), call, resp, md('b')]), [u('q'), call, resp, md('b')]);
  assert.deepStrictEqual(m.exports.trimTurns([u('q'), call]), []);
  assert.deepStrictEqual(m.exports.trimTurns([u('q'), call, resp]), []);
  assert.deepStrictEqual(m.exports.trimTurns([u('q'), md('a'), u('q2'), call, resp, md('b'), u('q3')]), [u('q'), md('a'), u('q2'), call, resp, md('b')]);
});
