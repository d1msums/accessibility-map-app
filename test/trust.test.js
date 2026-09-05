'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const trust = require('../lib/trust');

const H = 3600e3;
const mk = (over = {}) => ({ type: 'lift_broken', photo: '/x.jpg', confirmations: [], disputes: [], createdAt: 0, lastVerifiedAt: 0, ...over });

test('fresh photographed report starts at 85 and is Verified', () => {
  const s = trust.scoreReport(mk(), 0);
  assert.equal(s.trust, 85);
  assert.equal(s.band, 'verified');
});

test('two on-site confirmations lift a photographed report to 100', () => {
  const s = trust.scoreReport(mk({ confirmations: [{ userId: 'a' }, { userId: 'b' }] }), 0);
  assert.equal(s.trust, 100);
});

test('remote confirmations are worth half of on-site ones', () => {
  const onsite = trust.baseTrustFor(mk({ confirmations: [{ userId: 'a', onsite: true }] }));
  const remote = trust.baseTrustFor(mk({ confirmations: [{ userId: 'a', onsite: false }] }));
  assert.equal(onsite - 85, 7.5);
  assert.equal(remote - 85, 3.75);
});

test('a report without a photo can never reach Verified on its own', () => {
  const s = trust.scoreReport(mk({ photo: null }), 0);
  assert.equal(s.trust, 70);
  assert.equal(s.band, 'aging');
});

test('a flagged AI photo check cancels the photo bonus', () => {
  const s = trust.scoreReport(mk({ photoCheck: { flagged: true } }), 0);
  assert.equal(s.trust, 70);
});

test('trust decays monotonically and expires', () => {
  let prev = 101;
  for (let h = 0; h <= 72; h += 1) {
    const t = trust.scoreReport(mk(), h * H).trust;
    assert.ok(t <= prev, `hour ${h}: ${t} > ${prev}`);
    prev = t;
  }
  assert.equal(trust.scoreReport(mk(), 72 * H).trust, 0);
  assert.equal(trust.scoreReport(mk(), 72 * H).status, 'expired');
});

test('high-volatility obstacle (lift broken) ages far faster than a low-volatility feature (ramp)', () => {
  const at = 24 * H;
  const lift = trust.scoreReport(mk({ type: 'lift_broken' }), at).trust;
  const ramp = trust.scoreReport(mk({ type: 'ramp' }), at).trust;
  assert.ok(lift < 40, `lift after 24h should be < 40, got ${lift}`);
  assert.ok(ramp >= 80, `ramp after 24h should still be verified, got ${ramp}`);
});

test('confirming resets the decay clock', () => {
  const stale = mk({ createdAt: 0, lastVerifiedAt: 0 });
  const before = trust.scoreReport(stale, 20 * H).trust;
  const confirmed = mk({ createdAt: 0, lastVerifiedAt: 20 * H, confirmations: [{ userId: 'x' }] });
  const after = trust.scoreReport(confirmed, 20 * H).trust;
  assert.ok(before < 50);
  assert.ok(after >= 90);
});

test('two disputes remove a report; one dispute drops it to Old', () => {
  const one = trust.scoreReport(mk({ disputes: [{ userId: 'a' }] }), 0);
  assert.equal(one.trust, 50);
  const two = trust.scoreReport(mk({ disputes: [{ userId: 'a' }, { userId: 'b' }] }), 0);
  assert.equal(two.status, 'removed');
});

test('band boundaries map to the documented colours', () => {
  assert.equal(trust.bandFor(80).key, 'verified');
  assert.equal(trust.bandFor(79).key, 'aging');
  assert.equal(trust.bandFor(50).key, 'aging');
  assert.equal(trust.bandFor(49).key, 'old');
  assert.equal(trust.bandFor(20).key, 'old');
  assert.equal(trust.bandFor(19).key, 'expired');
});

test('hoursToNextBand is consistent with the decay curve', () => {
  const s = trust.scoreReport(mk(), 0); // lift_broken, base 85, scale 1
  // 85 -> 79 needs a loss of 6 => 1.2h
  assert.ok(Math.abs(s.hoursToNextBand - 1.2) < 0.11, `got ${s.hoursToNextBand}`);
});
