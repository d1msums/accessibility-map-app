'use strict';
/**
 * KitaBantu Trust Engine
 * ----------------------
 * Pure functions, no I/O. This answers the problem statement's hardest line:
 *   "How might we help OKU users ... trust that the information is still true?"
 *
 * Every report carries a trust score (0-100) that DECAYS with time since it was
 * last verified. Confirming resets the clock; disputing collapses the score.
 *
 * Two ideas make this more than a timestamp:
 *
 * 1. Volatility-aware decay. Real-world truths change at different speeds.
 *    A "lift broken" report goes stale in hours (lifts get fixed). A "ramp exists"
 *    report stays true for weeks. So each report type has a volatility class
 *    (catalogue.js) that stretches the decay curve:
 *        high   ×1   ->  hits 50 % after ~10 h,  expires after ~1.6 days
 *        medium ×6   ->  hits 50 % after ~2.5 d, expires after ~10 days
 *        low    ×28  ->  hits 50 % after ~12 d,  expires after ~45 days
 *
 * 2. Evidence ceiling. Decay starts from a *base* trust that depends on evidence:
 *    photo (+15), independent confirmations (+7.5 each, max +15), disputes (−35 each).
 *    A bare text report can never look as trustworthy as a photographed, twice-
 *    confirmed one — even if both were posted a minute ago.
 *
 * Base decay curve (in "effective hours" = real hours / volatility scale):
 *    0–12 h  : −5 %/h   (fresh)
 *    12–48 h : −1.5 %/h (aging)
 *    > 48 h  : −0.5 %/h (tail)
 */

const { VOLATILITY_SCALE, typeInfo } = require('./catalogue');

const HOUR = 3600 * 1000;

const BANDS = [
  { min: 80, key: 'verified', label: 'Verified recently', labelMs: 'Disahkan baru-baru ini', color: '#111111' },
  { min: 50, key: 'aging', label: 'Aging – please re-verify', labelMs: 'Semakin lama – sila sahkan semula', color: '#5f5f5f' },
  { min: 20, key: 'old', label: 'Old – likely outdated', labelMs: 'Lama – mungkin sudah berubah', color: '#a8a8a8' },
  { min: 0, key: 'expired', label: 'Expired – needs rechecking', labelMs: 'Tamat – perlu disemak semula', color: '#d9d9d9' },
];

/** Piecewise-linear decay on effective hours. Returns 0-100 (rounded). */
function decayedTrust(effectiveHours, baseTrust = 100) {
  const h = Math.max(0, effectiveHours);
  let loss;
  if (h <= 12) loss = 5 * h;
  else if (h <= 48) loss = 60 + 1.5 * (h - 12);
  else loss = 114 + 0.5 * (h - 48);
  return Math.max(0, Math.min(100, Math.round(baseTrust - loss)));
}

/** Effective hours at which a report starting at `base` reaches `target`. */
function effectiveHoursUntil(target, base = 100) {
  const loss = base - target;
  if (loss <= 0) return 0;
  if (loss <= 60) return loss / 5;
  if (loss <= 114) return 12 + (loss - 60) / 1.5;
  return 48 + (loss - 114) / 0.5;
}

function bandFor(trust) {
  return BANDS.find((b) => trust >= b.min) || BANDS[BANDS.length - 1];
}

function scaleFor(report) {
  const vol = typeInfo(report.type).volatility;
  return VOLATILITY_SCALE[vol] || 1;
}

/**
 * Evidence-based starting trust, before any time decay.
 *  - photo evidence                       +15
 *  - AI photo check flagged a mismatch    −15 (photo no longer counts as evidence)
 *  - each confirmation                    +7.5 on-site (GPS-verified) / +3.75 remote, capped at +15
 *  - each dispute                         −35
 */
function baseTrustFor(report) {
  let base = 70; // bare human report, no evidence
  if (report.photo) base += 15;
  if (report.photoCheck && report.photoCheck.flagged) base -= 15;
  const confirms = report.confirmations || [];
  const confirmWeight = confirms.reduce((s, c) => s + (c && c.onsite === false ? 3.75 : 7.5), 0);
  base += Math.min(15, confirmWeight);
  const disputes = (report.disputes || []).length;
  base -= disputes * 35;
  return Math.max(0, Math.min(100, base));
}

/** Full scoring of one report at time `now`. */
function scoreReport(report, now = Date.now()) {
  const lastVerified = report.lastVerifiedAt || report.createdAt;
  const realHours = Math.max(0, (now - lastVerified) / HOUR);
  const scale = scaleFor(report);
  const base = baseTrustFor(report);
  const trust = decayedTrust(realHours / scale, base);
  const band = bandFor(trust);
  const disputes = (report.disputes || []).length;
  const status = disputes >= 2 ? 'removed' : trust === 0 ? 'expired' : 'active';

  // When will this report drop into the next band? (for "re-verify by" hints)
  const nextBand = BANDS.find((b) => b.min < band.min);
  let hoursToNextBand = null;
  if (nextBand) {
    const effNow = realHours / scale;
    const effAtNext = effectiveHoursUntil(band.min - 1, base); // first hour below band floor
    hoursToNextBand = Math.max(0, Math.round((effAtNext - effNow) * scale * 10) / 10);
  }

  return {
    trust,
    baseTrust: base,
    band: band.key,
    bandLabel: band.label,
    bandLabelMs: band.labelMs,
    color: band.color,
    hoursSinceVerified: Math.round(realHours * 10) / 10,
    volatility: typeInfo(report.type).volatility,
    hoursToNextBand,
    status,
  };
}

module.exports = {
  HOUR,
  BANDS,
  decayedTrust,
  effectiveHoursUntil,
  bandFor,
  scaleFor,
  baseTrustFor,
  scoreReport,
};
