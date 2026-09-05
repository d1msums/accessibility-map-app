'use strict';
/** Points, levels, badges, missions and streaks. Pure functions over user + action records. */

const LEVELS = [
  { level: 1, min: 0, title: 'Explorer', titleMs: 'Peneroka', emoji: '🌱' },
  { level: 2, min: 100, title: 'Pathfinder', titleMs: 'Pencari Laluan', emoji: '🧭' },
  { level: 3, min: 300, title: 'Scout', titleMs: 'Pengakap', emoji: '🔭' },
  { level: 4, min: 700, title: 'Navigator', titleMs: 'Navigator', emoji: '🗺️' },
  { level: 5, min: 1500, title: 'Community Hero', titleMs: 'Wira Komuniti', emoji: '🦸' },
  { level: 6, min: 3000, title: 'City Guardian', titleMs: 'Penjaga Bandar', emoji: '🛡️' },
  { level: 7, min: 6000, title: 'Accessibility Champion', titleMs: 'Juara Aksesibiliti', emoji: '🏆' },
  { level: 8, min: 12000, title: 'Legend', titleMs: 'Legenda', emoji: '👑' },
];

const POINTS = {
  report_photo: 10,          // feature with photo
  report_obstacle_photo: 15, // obstacle with photo
  report_nophoto: 5,         // any report without a photo
  confirm: 5,
  confirm_onsite_bonus: 3,   // GPS-verified at the location
  dispute: 15,
  first_report_bonus: 20,
  request_answer: 25,        // answered an OKU user's check request
  request_answer_photo: 10,  // ...with a photo
  request_fast_bonus: 10,    // answered within 30 minutes
  request_thanks: 5,         // requester said thanks / rated
  streak_day: 5,             // daily streak bonus per consecutive day (capped in code)
  mission_complete: 30,
  ask_bonus: 2,              // OKU user posting a request (keeps them engaged, small)
};

/** Badges; the first few can unlock live during a demo. */
const BADGES = [
  { id: 'first_step', icon: '🥇', name: 'First Step', nameMs: 'Langkah Pertama', desc: 'Submit your first report', descMs: 'Hantar laporan pertama anda', test: (s) => s.reports >= 1 },
  { id: 'first_answer', icon: '💌', name: 'First Answer', nameMs: 'Jawapan Pertama', desc: 'Answer a check request', descMs: 'Jawab permintaan semakan', test: (s) => s.answers >= 1 },
  { id: 'fact_checker', icon: '✅', name: 'Fact Checker', nameMs: 'Penyemak Fakta', desc: 'Confirm or dispute 3 reports', descMs: 'Sahkan atau pertikai 3 laporan', test: (s) => s.confirms + s.disputes >= 3 },
  { id: 'photo_pro', icon: '📸', name: 'Photo Pro', nameMs: 'Pro Foto', desc: 'Upload 5 photos', descMs: 'Muat naik 5 foto', test: (s) => s.photos >= 5 },
  { id: 'speedy', icon: '⚡', name: 'Speedy', nameMs: 'Pantas', desc: 'Answer a request within 30 min', descMs: 'Jawab permintaan dalam 30 minit', test: (s) => s.fastAnswers >= 1 },
  { id: 'on_fire', icon: '🔥', name: 'On Fire', nameMs: 'Bersemangat', desc: '3-day streak', descMs: 'Rentetan 3 hari', test: (s) => s.streak >= 3 },
  { id: 'obstacle_buster', icon: '🚧', name: 'Obstacle Buster', nameMs: 'Pemusnah Halangan', desc: 'Report 10 obstacles', descMs: 'Laporkan 10 halangan', test: (s) => s.obstacles >= 10 },
  { id: 'ramp_ranger', icon: '♿', name: 'Ramp Ranger', nameMs: 'Renjer Tanjakan', desc: 'Report 10 ramps or entrances', descMs: 'Laporkan 10 tanjakan atau pintu masuk', test: (s) => s.ramps >= 10 },
  { id: 'lift_lookout', icon: '🛗', name: 'Lift Lookout', nameMs: 'Pemerhati Lif', desc: 'Report 5 lift statuses', descMs: 'Laporkan 5 status lif', test: (s) => s.lifts >= 5 },
  { id: 'helping_hand', icon: '🤝', name: 'Helping Hand', nameMs: 'Tangan Membantu', desc: 'Answer 10 requests', descMs: 'Jawab 10 permintaan', test: (s) => s.answers >= 10 },
  { id: 'trusted_reporter', icon: '🛡️', name: 'Trusted Reporter', nameMs: 'Pelapor Dipercayai', desc: '20 confirmations, 90%+ accuracy', descMs: '20 pengesahan, ketepatan 90%+', test: (s) => s.confirms >= 20 && s.accuracy >= 0.9 },
  { id: 'early_adopter', icon: '🌱', name: 'Early Adopter', nameMs: 'Pengguna Awal', desc: 'Joined during the pilot', descMs: 'Menyertai semasa perintis', test: () => true },
];

/** Daily missions for helpers. `progress(stats, today)` returns a number; done when >= goal. */
const MISSIONS = [
  { id: 'answer_1', icon: '💌', title: 'Answer 1 check request', titleMs: 'Jawab 1 permintaan semakan', goal: 1, key: 'answers' },
  { id: 'confirm_2', icon: '✅', title: 'Re-verify 2 aging reports', titleMs: 'Sahkan semula 2 laporan lama', goal: 2, key: 'confirms' },
  { id: 'report_1', icon: '📍', title: 'Report 1 new place with a photo', titleMs: 'Laporkan 1 tempat baharu dengan foto', goal: 1, key: 'photoReports' },
];

function levelFor(points) {
  let cur = LEVELS[0];
  for (const l of LEVELS) if (points >= l.min) cur = l;
  const next = LEVELS.find((l) => l.min > cur.min) || null;
  const progress = next ? (points - cur.min) / (next.min - cur.min) : 1;
  return { ...cur, next, progress: Math.round(progress * 100) };
}

function pointsForReport(kind, hasPhoto, isFirst) {
  let p = hasPhoto ? (kind === 'obstacle' ? POINTS.report_obstacle_photo : POINTS.report_photo) : POINTS.report_nophoto;
  if (isFirst) p += POINTS.first_report_bonus;
  return p;
}

function pointsForAnswer({ hasPhoto, minutesToAnswer }) {
  let p = POINTS.request_answer;
  const parts = [{ label: 'answer', pts: POINTS.request_answer }];
  if (hasPhoto) { p += POINTS.request_answer_photo; parts.push({ label: 'photo', pts: POINTS.request_answer_photo }); }
  if (minutesToAnswer != null && minutesToAnswer <= 30) { p += POINTS.request_fast_bonus; parts.push({ label: 'fast', pts: POINTS.request_fast_bonus }); }
  return { points: p, parts };
}

/** Returns the list of newly earned badge ids given a user's stats and existing badges. */
function newBadges(stats, owned) {
  const acc = stats.disputedAgainst ? 1 - stats.disputedAgainst / Math.max(1, stats.reports) : 1;
  const s = { ...stats, accuracy: acc };
  return BADGES.filter((b) => !owned.includes(b.id) && b.test(s)).map((b) => b.id);
}

/**
 * Streak update. `lastActiveDay` is a YYYY-MM-DD string (local to the demo clock).
 * Returns { streak, extended, bonus }.
 */
function updateStreak(user, todayKey) {
  if (user.lastActiveDay === todayKey) return { streak: user.streak || 0, extended: false, bonus: 0 };
  const yesterday = shiftDay(todayKey, -1);
  const streak = user.lastActiveDay === yesterday ? (user.streak || 0) + 1 : 1;
  user.streak = streak;
  user.lastActiveDay = todayKey;
  const bonus = streak > 1 ? Math.min(25, POINTS.streak_day * (streak - 1)) : 0;
  return { streak, extended: true, bonus };
}

function dayKey(ms) {
  const d = new Date(ms + 8 * 3600e3); // Asia/Kuala_Lumpur
  return d.toISOString().slice(0, 10);
}
function shiftDay(key, delta) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

module.exports = { LEVELS, POINTS, BADGES, MISSIONS, levelFor, pointsForReport, pointsForAnswer, newBadges, updateStreak, dayKey, shiftDay };
