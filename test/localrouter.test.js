'use strict';
process.env.KB_PERSIST = '0';
const test = require('node:test');
const assert = require('node:assert/strict');
const lr = require('../lib/localrouter');
const geo = require('../lib/geo');
const { Store } = require('../lib/store');
const { radiusFor } = require('../lib/routing');

const KLS = { lat: 3.13431, lng: 101.68637 };
const MAB = { lat: 3.13214, lng: 101.69091 };

const store = new Store();
store.reset(false);
const reports = store.listReports();
const kerb = reports.find((r) => r.id === 'r_kerb_tunsambanthan');

test('graphs load: central KL and Cyberjaya/Putrajaya areas', () => {
  const areas = lr.loadAll();
  assert.ok(areas.length >= 2);
  const kl = lr.areaFor(KLS, MAB);
  assert.ok(kl && kl.name === 'kl' && kl.nodes.length > 10000 && kl.edges.length > 10000);
  const cj = lr.areaFor({ lat: 2.9213, lng: 101.6559 });
  assert.ok(cj && cj.name === 'cyberjaya' && cj.nodes.length > 10000);
  assert.ok(lr.inBBox(KLS) && lr.inBBox(MAB));
  assert.ok(!lr.inBBox({ lat: 5.41, lng: 100.33 })); // Penang: no graph
  assert.equal(lr.areaFor(KLS, { lat: 2.9213, lng: 101.6559 }), null); // cross-area trips are not routed locally
});

test('stairs are impassable for wheelchair users unless a trusted lift unlocks them', () => {
  const e = { id: 1, flags: lr.F_STEPS, len: 10 };
  assert.equal(lr.edgeFactor(e, 'wheelchair'), Infinity);
  assert.ok(Number.isFinite(lr.edgeFactor(e, 'wheelchair', new Set([1]))));
  assert.ok(Number.isFinite(lr.edgeFactor(e, 'visual')));
});

test('roads without sidewalks cost more for every need, dedicated footways cost less', () => {
  const road = { id: 1, flags: lr.F_ROAD_NO_SIDEWALK, len: 10 };
  const foot = { id: 2, flags: lr.F_FOOT, len: 10 };
  for (const need of ['wheelchair', 'visual', 'elderly', null]) {
    assert.ok(lr.edgeFactor(road, need) > 1, `${need} road`);
    assert.ok(lr.edgeFactor(foot, need) < 1, `${need} foot`);
  }
});

test('an obstacle report adds cost to the edges it sits on, scaled by trust', () => {
  const hi = lr.obstaclePenalties([{ ...kerb, trust: 90 }], 'wheelchair', radiusFor);
  const lo = lr.obstaclePenalties([{ ...kerb, trust: 30 }], 'wheelchair', radiusFor);
  assert.ok(hi.size > 0);
  const id = [...hi.keys()][0];
  assert.ok(hi.get(id) > lo.get(id));
  // irrelevant for visual need (kerb ramps affect wheelchair/elderly only)
  assert.equal(lr.obstaclePenalties([kerb], 'visual', radiusFor).size, 0);
});

test('demo trip: the aware route avoids the blocked kerb, the naive route walks into it', () => {
  const r = lr.route({ from: KLS, to: MAB, need: 'wheelchair', reports, radiusFor });
  assert.ok(r.ok);
  const aware = r.routes.find((x) => x.kind === 'aware');
  const naive = r.routes.find((x) => x.kind === 'naive');
  assert.ok(aware && naive);
  const dAware = geo.distToPolyline({ lat: kerb.lat, lng: kerb.lng }, aware.coords).d;
  const dNaive = geo.distToPolyline({ lat: kerb.lat, lng: kerb.lng }, naive.coords).d;
  assert.ok(dNaive <= radiusFor('kerb_blocked'), `naive passes the kerb (${dNaive.toFixed(0)} m)`);
  assert.ok(dAware > radiusFor('kerb_blocked'), `aware avoids the kerb (${dAware.toFixed(0)} m)`);
  assert.ok(aware.distanceM < naive.distanceM * 1.3, 'detour is short');
});

test('demo trip: the working-lift report unlocks the KL Sentral stairs; without it the route is much longer', () => {
  const withLift = lr.route({ from: KLS, to: MAB, need: 'wheelchair', reports, radiusFor });
  const without = lr.route({ from: KLS, to: MAB, need: 'wheelchair', reports: reports.filter((x) => x.id !== 'r_lift_klsentral'), radiusFor });
  assert.ok(withLift.routes[0].flags.stepsUnlocked >= 1);
  assert.equal(without.routes[0].flags.stepsUnlocked, 0);
  assert.ok(without.routes[0].distanceM > withLift.routes[0].distanceM * 1.5);
});

test('a broken-lift report vetoes the unlock', () => {
  const lift = reports.find((x) => x.id === 'r_lift_klsentral');
  const broken = { ...lift, id: 'r_broken_test', type: 'lift_broken', kind: 'obstacle', affects: ['wheelchair', 'elderly'] };
  const unl = lr.stepsUnlocks([lift, broken], 'wheelchair');
  assert.equal(unl.size, 0);
  assert.ok(lr.stepsUnlocks([lift], 'wheelchair').size > 0);
});

test('for low-vision users the kerb is irrelevant and the short route is used', () => {
  const r = lr.route({ from: KLS, to: MAB, need: 'visual', reports, radiusFor });
  assert.ok(r.routes[0].distanceM < 800);
});

test('outside every graph area the local router declines cleanly', () => {
  const r = lr.route({ from: KLS, to: { lat: 5.41, lng: 100.33 }, need: 'wheelchair', reports, radiusFor });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'outside_coverage');
});

test('Cyberjaya: a wheelchair route between Cyber 6 and DPulze uses the local graph', () => {
  const r = lr.route({ from: { lat: 2.9213, lng: 101.6559 }, to: { lat: 2.92207, lng: 101.65112 }, need: 'wheelchair', reports, radiusFor });
  assert.ok(r.ok);
  assert.equal(r.area, 'cyberjaya');
  assert.ok(r.routes[0].distanceM > 500 && r.routes[0].distanceM < 2000);
});
