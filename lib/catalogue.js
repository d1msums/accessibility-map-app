'use strict';
/**
 * Report type catalogue.
 *
 * Each type knows:
 *  - kind:        feature (helps OKU) | obstacle (blocks OKU)
 *  - affects:     which accessibility needs care about it
 *  - volatility:  how fast the real-world truth changes  ->  drives trust decay speed
 *                 high   = hours   (a broken lift gets fixed / a kerb gets unblocked)
 *                 medium = days    (staff availability, lift working, parking)
 *                 low    = weeks   (a ramp, tactile paving, steps-only entrance)
 *  - severity:    routing penalty when an obstacle sits on a path (0-100)
 *  - points:      gamification reward for reporting it
 */

const NEEDS = {
  wheelchair: { en: 'Wheelchair / mobility', ms: 'Kerusi roda / mobiliti', icon: '♿' },
  visual: { en: 'Low vision / blind', ms: 'Penglihatan terhad / buta', icon: '👁️' },
  elderly: { en: 'Elderly / stroller', ms: 'Warga emas / kereta sorong', icon: '🧓' },
};

const TYPES = {
  // ---------- features ----------
  ramp: { kind: 'feature', icon: '♿', en: 'Wheelchair ramp', ms: 'Tanjakan kerusi roda', affects: ['wheelchair', 'elderly'], volatility: 'low', severity: 0, points: 10 },
  lift_ok: { kind: 'feature', icon: '🛗', en: 'Lift working', ms: 'Lif berfungsi', affects: ['wheelchair', 'elderly'], volatility: 'medium', severity: 0, points: 10 },
  tactile: { kind: 'feature', icon: '🟨', en: 'Tactile guide path', ms: 'Jalur sentuh', affects: ['visual'], volatility: 'low', severity: 0, points: 10 },
  toilet: { kind: 'feature', icon: '🚻', en: 'Accessible toilet', ms: 'Tandas OKU', affects: ['wheelchair', 'elderly'], volatility: 'low', severity: 0, points: 10 },
  entrance: { kind: 'feature', icon: '🚪', en: 'Step-free entrance', ms: 'Pintu masuk tanpa tangga', affects: ['wheelchair', 'elderly'], volatility: 'low', severity: 0, points: 10 },
  crossing: { kind: 'feature', icon: '🔊', en: 'Audible / tactile crossing', ms: 'Lintasan berbunyi', affects: ['visual'], volatility: 'low', severity: 0, points: 10 },
  parking: { kind: 'feature', icon: '🅿️', en: 'OKU parking bay free', ms: 'Petak parkir OKU kosong', affects: ['wheelchair'], volatility: 'medium', severity: 0, points: 10 },
  staff: { kind: 'feature', icon: '🙋', en: 'Staff assistance available', ms: 'Bantuan kakitangan ada', affects: ['wheelchair', 'visual', 'elderly'], volatility: 'medium', severity: 0, points: 10 },
  // ---------- obstacles ----------
  lift_broken: { kind: 'obstacle', icon: '⛔', en: 'Lift broken', ms: 'Lif rosak', affects: ['wheelchair', 'elderly'], volatility: 'high', severity: 60, points: 15 },
  kerb_blocked: { kind: 'obstacle', icon: '🏍️', en: 'Kerb ramp blocked', ms: 'Tanjakan kerb terhalang', affects: ['wheelchair', 'elderly'], volatility: 'high', severity: 50, points: 15 },
  construction: { kind: 'obstacle', icon: '🚧', en: 'Footpath closed – construction', ms: 'Laluan ditutup – pembinaan', affects: ['wheelchair', 'visual', 'elderly'], volatility: 'high', severity: 45, points: 15 },
  pavement: { kind: 'obstacle', icon: '🕳️', en: 'Damaged / uneven pavement', ms: 'Laluan pejalan kaki rosak', affects: ['wheelchair', 'visual', 'elderly'], volatility: 'medium', severity: 25, points: 15 },
  steps_only: { kind: 'obstacle', icon: '🪜', en: 'Steps only – no ramp', ms: 'Tangga sahaja – tiada tanjakan', affects: ['wheelchair'], volatility: 'low', severity: 30, points: 15 },
  parking_blocked: { kind: 'obstacle', icon: '🚫', en: 'OKU parking bay blocked', ms: 'Petak parkir OKU dihalang', affects: ['wheelchair'], volatility: 'high', severity: 5, points: 15 },
  tactile_blocked: { kind: 'obstacle', icon: '⚠️', en: 'Tactile path obstructed', ms: 'Jalur sentuh terhalang', affects: ['visual'], volatility: 'high', severity: 40, points: 15 },
  other_obstacle: { kind: 'obstacle', icon: '❗', en: 'Other obstacle', ms: 'Halangan lain', affects: ['wheelchair', 'visual', 'elderly'], volatility: 'high', severity: 30, points: 15 },
};

/** Time-scale multipliers applied to the base decay curve (see trust.js). */
const VOLATILITY_SCALE = { high: 1, medium: 6, low: 28 };

function typeInfo(type) {
  return TYPES[type] || TYPES.other_obstacle;
}

module.exports = { NEEDS, TYPES, VOLATILITY_SCALE, typeInfo };
