'use strict';
process.env.KB_PERSIST = '0';
const test = require('node:test');
const assert = require('node:assert/strict');
const routing = require('../lib/routing');
const geo = require('../lib/geo');
const { Store } = require('../lib/store');

// A straight 600 m east-west path in Brickfields.
const A = { lat: 3.1330, lng: 101.6880 };
const B = { lat: 3.1330, lng: 101.6934 };
const line = routing.straightLine(A, B);
const mid = { lat: 3.1330, lng: 101.6907 };

const rep = (over) => ({ id: 'x', status: 'active', trust: 90, band: 'verified', lat: mid.lat, lng: mid.lng, ...over });

test('an obstacle right on the path is detected, one 100 m away is not', () => {
  const on = routing.hitsForRoute(line, [rep({ type: 'kerb_blocked' })], 'wheelchair');
  assert.equal(on.hits.length, 1);
  const far = geo.destination(mid, 0, 100);
  const off = routing.hitsForRoute(line, [rep({ type: 'kerb_blocked', lat: far.lat, lng: far.lng })], 'wheelchair');
  assert.equal(off.hits.length, 0);
});

test('obstacles are filtered by accessibility need', () => {
  const reports = [rep({ type: 'tactile_blocked' })]; // affects visual only
  assert.equal(routing.hitsForRoute(line, reports, 'wheelchair').hits.length, 0);
  assert.equal(routing.hitsForRoute(line, reports, 'visual').hits.length, 1);
});

test('route score falls with obstacle severity × trust', () => {
  const clear = routing.scoreRoute(line, [], 'wheelchair').score;
  const weak = routing.scoreRoute(line, [rep({ type: 'kerb_blocked', trust: 25 })], 'wheelchair').score;
  const strong = routing.scoreRoute(line, [rep({ type: 'kerb_blocked', trust: 95 })], 'wheelchair').score;
  assert.equal(clear, 100);
  assert.ok(weak < clear && strong < weak, `${clear} > ${weak} > ${strong}`);
});

test('expired reports do not influence routing', () => {
  const s = routing.scoreRoute(line, [rep({ type: 'lift_broken', trust: 0, status: 'expired' })], 'wheelchair').score;
  assert.equal(s, 100);
});

test('coverage reflects how much of the path has recent reports nearby', () => {
  const none = routing.coverageForRoute(line, []);
  const some = routing.coverageForRoute(line, [rep({ type: 'ramp' })]);
  const lots = routing.coverageForRoute(line, [rep({ type: 'ramp' }), rep({ type: 'ramp', lat: A.lat, lng: A.lng }), rep({ type: 'ramp', lat: B.lat, lng: B.lng })]);
  assert.equal(none, 0);
  assert.ok(some > 0 && some < 0.5);
  assert.ok(lots > some);
});

test('segments are split into clear/obstacle chunks that share boundary points', () => {
  const scored = routing.scoreRoute(line, [rep({ type: 'construction' })], 'wheelchair');
  const statuses = scored.segments.map((s) => s.status);
  assert.ok(statuses.includes('obstacle'));
  assert.ok(statuses.includes('clear'));
  for (let i = 1; i < scored.segments.length; i++) {
    assert.deepEqual(scored.segments[i].coords[0], scored.segments[i - 1].coords.at(-1));
  }
});

test('detour candidates sit perpendicular to the path, on both sides, incl. box detours', () => {
  const scored = routing.scoreRoute(line, [rep({ type: 'construction' })], 'wheelchair');
  const vias = routing.detourWaypoints(scored, scored.hits[0]);
  assert.equal(vias.length, 6);
  const flat = vias.flat();
  const north = flat.filter((v) => v.lat > mid.lat).length;
  const south = flat.filter((v) => v.lat < mid.lat).length;
  assert.equal(north, 4);
  assert.equal(south, 4);
  const box = vias.filter((v) => v.length === 2);
  assert.equal(box.length, 2);
  // box legs straddle the obstacle along the path direction (east-west here)
  for (const [a, b] of box) assert.ok(a.lng < mid.lng && b.lng > mid.lng);
});

test('pointAlong walks the polyline by distance', () => {
  const p = routing.pointAlong(line.coords, 300);
  assert.ok(Math.abs(geo.haversine(A, p) - 300) < 2);
  const end = routing.pointAlong(line.coords, 99999);
  assert.ok(geo.haversine(B, end) < 1);
});

test('store: confirm resets clock, dispute×2 removes, own-report and double-verify are rejected', () => {
  const s = new Store();
  s.reset(false);
  const target = s.report('r_kerb_tunsambanthan');
  s.advance(6 * 3600e3);
  const before = s.scored(target).trust;
  assert.ok(before < 85);
  const ok = s.verify({ reportId: target.id, userId: 'u_mei', action: 'confirm', at: { lat: target.lat, lng: target.lng } });
  assert.ok(!ok.error);
  assert.ok(ok.reward.onsite);
  assert.ok(ok.report.trust >= 95);
  assert.equal(s.verify({ reportId: target.id, userId: 'u_mei', action: 'confirm' }).error, 'already_verified');
  assert.equal(s.verify({ reportId: target.id, userId: 'u_aisha', action: 'confirm' }).error, 'own_report');
  const d1 = s.verify({ reportId: target.id, userId: 'u_raj', action: 'dispute', note: 'gone' });
  assert.equal(d1.report.status, 'active');
  const d2 = s.verify({ reportId: target.id, userId: 'u_siti', action: 'dispute', note: 'gone' });
  assert.equal(d2.report.status, 'removed');
  s.reset(false);
});

test('store: sign-up, first report awards points + First Step badge, streak starts', () => {
  const s = new Store();
  s.reset(false);
  const reg = s.register({ name: 'Test Judge', email: 'judge@test.my', password: 'secret12', role: 'helper', avatar: '🙂', color: '#0d9488' });
  assert.ok(reg.token && reg.user.id);
  assert.equal(s.register({ name: 'Dup', email: 'judge@test.my', password: 'secret12', role: 'helper' }).error, 'email_taken');
  assert.equal(s.login({ email: 'judge@test.my', password: 'wrong' }).error, 'bad_credentials');
  assert.ok(s.login({ email: 'judge@test.my', password: 'secret12' }).token);
  const out = s.createReport({ type: 'kerb_blocked', lat: 3.133, lng: 101.689, place: 'Test', note: '', photo: null, userId: reg.user.id });
  assert.equal(out.reward.points, 5 + 20); // no photo + first report bonus
  assert.ok(out.reward.earned.some((b) => b.id === 'first_step'));
  assert.equal(out.reward.streak.streak, 1);
  s.reset(false);
});

test('store: OKU user asks, helper answers fast with photo (+45), requester thanks (+5), missions tick', () => {
  const s = new Store();
  s.reset(false);
  const ask = s.createRequest({ userId: 'u_aisha', place: 'Test place', question: 'Is the lift working right now?', lat: 3.133, lng: 101.689, urgency: 'today' });
  assert.ok(!ask.error);
  assert.equal(s.createRequest({ userId: 'u_raj', place: 'x', question: 'helpers cannot ask here', lat: 3.1, lng: 101.6 }).error, 'oku_only');
  const before = s.user('u_mei').points;
  const ans = s.answerRequest({ requestId: ask.request.id, userId: 'u_mei', verdict: 'yes', note: 'Working, just checked.', photo: '/seed-photos/lift-working.jpg' });
  assert.ok(!ans.error);
  assert.equal(ans.reward.points, 25 + 10 + 10);
  assert.equal(s.answerRequest({ requestId: ask.request.id, userId: 'u_mei', verdict: 'yes', note: 'again' }).error, 'already_answered');
  assert.equal(s.answerRequest({ requestId: ask.request.id, userId: 'u_aisha', verdict: 'yes', note: 'own' }).error, 'own_request');
  const th = s.thankAnswer({ requestId: ask.request.id, answerId: ans.request.answers[0].id, userId: 'u_aisha' });
  assert.ok(!th.error);
  assert.equal(th.request.status, 'closed');
  assert.ok(s.user('u_mei').points >= before + 45 + 5);
  const m = s.missions('u_mei').find((x) => x.id === 'answer_1');
  assert.ok(m.done);
  s.reset(false);
});
