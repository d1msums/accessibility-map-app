'use strict';
/**
 * In-memory store with optional JSON snapshot persistence.
 *
 * Why not Firebase/Postgres for the hackathon build? Because the judges need to
 * see the *logic* work, and an in-process store keeps the demo deterministic,
 * offline-safe and resettable in one click. The data access layer is isolated
 * here so swapping to Firestore/Supabase is a one-file change (see README).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const { buildSeed } = require('../data/seed');
const trust = require('./trust');
const geo = require('./geo');
const { typeInfo, NEEDS } = require('./catalogue');
const gam = require('./gamification');
const wardrobe = require('./wardrobe');
/** Open Peeps combination chosen in the Avatar Builder (ids from public/assets/assetsManifest.json). */
const PEEP_KEYS = ['body', 'pose', 'head', 'face', 'facialHair', 'accessory', 'gender', 'skin', 'hair', 'cloth', 'bg', 'mode'];
const PEEP_ID = /^[a-z-]+\/[a-z0-9-]+$/;
const HEX = /^#[0-9a-f]{6}$/i;
function cleanPeep(v) {
  if (!v || typeof v !== 'object') return null;
  const out = {};
  for (const k of ['body', 'pose', 'head', 'face', 'facialHair', 'accessory']) { const x = v[k]; if (typeof x === 'string' && PEEP_ID.test(x) && x.length < 64) out[k] = x; else if (x === null) out[k] = null; }
  if (['male', 'female', 'any'].includes(v.gender)) out.gender = v.gender;
  if (['bust', 'full'].includes(v.mode)) out.mode = v.mode;
  for (const k of ['skin', 'hair', 'cloth', 'bg']) if (typeof v[k] === 'string' && HEX.test(v[k])) out[k] = v[k].toLowerCase();
  return out.head && out.face ? out : null;
}
const auth = require('./auth');

const SNAPSHOT = process.env.KB_SNAPSHOT || path.join(__dirname, '..', 'data', 'snapshot.json');
const PERSIST = process.env.KB_PERSIST !== '0';
const SECRET = (() => {
  if (process.env.KB_SECRET) return process.env.KB_SECRET;
  const f = path.join(__dirname, '..', 'data', '.secret');
  try { const v = fs.readFileSync(f, 'utf8').trim(); if (v.length >= 32) return v; } catch { /* create */ }
  const v = crypto.randomBytes(32).toString('base64url');
  try { fs.writeFileSync(f, v, { mode: 0o600 }); } catch { /* memory only */ }
  return v;
})();   // on by default: created accounts survive restarts (data/snapshot.json)
const ONSITE_RADIUS_M = 75;
// Avatars are line-art part configs ({ hair, body, item, glasses, aid }); the same module renders them in the browser.
const { KBAvatar } = require('../public/js/avatar.js');
const AVATARS = KBAvatar.PARTS;          // { hair: {id: {...}}, body: {...}, item, glasses, aid }
const COLORS = KBAvatar.ACCENTS;         // calm background tints

class Store extends EventEmitter {
  constructor() {
    super();
    this.clock = { offsetMs: 0 };
    this.load();
  }

  // ---------- time ----------
  now() { return Date.now() + this.clock.offsetMs; }
  advance(ms) { this.clock.offsetMs += ms; this.emit('change', { kind: 'clock', offsetMs: this.clock.offsetMs }); }
  todayKey() { return gam.dayKey(this.now()); }

  // ---------- persistence ----------
  load() {
    try {
      if (PERSIST && fs.existsSync(SNAPSHOT)) {
        const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
        if (snap && snap.reports && snap.users && snap.requests) { Object.assign(this, snap); this.clock = this.clock || { offsetMs: 0 }; this.sessions = this.sessions || {}; return; }
      }
    } catch { /* fall back to seed */ }
    this.reset(false);
  }
  save() {
    if (!PERSIST) return;
    const { users, reports, requests, transactions, sessions, seededAt, clock, revoked } = this;
    try { fs.writeFileSync(SNAPSHOT, JSON.stringify({ users, reports, requests, transactions, sessions, seededAt, clock, revoked: revoked || {} })); } catch { /* ignore */ }
  }
  reset(emit = true) {
    const seed = buildSeed(Date.now());
    const keepSessions = this.sessions || {};
    // accounts people created themselves survive a demo reset (only the seeded demo data is rebuilt)
    const seededIds = new Set(seed.users.map((u) => u.id));
    const custom = (this.users || []).filter((u) => !seededIds.has(u.id)).map((u) => ({ ...u, points: 0, coins: u.coins, stats: { asks: 0, answers: 0, confirms: 0, reports: 0, photos: 0 }, streak: 0, badges: [], notifications: [] }));
    Object.assign(this, seed);
    this.users.push(...custom);
    this.sessions = keepSessions; // keep people logged in across a demo reset
    this.clock = { offsetMs: 0 };
    for (const u of this.users) { u.badges = gam.newBadges({ ...u.stats, streak: u.streak, disputedAgainst: 0 }, []); u.lastActiveDay = gam.shiftDay(this.todayKey(), -1); }
    // re-attach sessions whose user id still exists
    for (const [tok, uid] of Object.entries(this.sessions)) if (!this.users.find((u) => u.id === uid)) delete this.sessions[tok];
    this.save();
    if (emit) this.emit('change', { kind: 'reset' });
  }

  // ---------- auth ----------
  register({ name, email, password, role, need, avatar, color, area, peep }) {
    email = String(email || '').trim().toLowerCase();
    name = String(name || '').trim().slice(0, 40);
    if (!name || name.length < 2) return { error: 'name_too_short' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'bad_email' };
    if (String(password || '').length < 6) return { error: 'password_too_short' };
    if (this.users.some((u) => u.email === email)) return { error: 'email_taken' };
    if (!['helper', 'oku'].includes(role)) return { error: 'bad_role' };
    if (role === 'oku' && !NEEDS[need]) return { error: 'need_required' };
    const id = 'u_' + crypto.randomBytes(5).toString('hex');
    const user = {
      id, email, name, role, need: role === 'oku' ? need : null,
      avatar: avatar && typeof avatar === 'object' ? KBAvatar.cleanParts(avatar) : KBAvatar.randomParts(role, need),
      peep: cleanPeep(peep),
      color: COLORS.includes(color) ? color : COLORS[Math.floor(Math.random() * COLORS.length)],
      area: String(area || '').slice(0, 40) || 'Kuala Lumpur',
      password: auth.hashPassword(password), points: 0, streak: 0, lastActiveDay: null, thanks: 0,
      stats: { reports: 0, photos: 0, confirms: 0, disputes: 0, ramps: 0, lifts: 0, obstacles: 0, answers: 0, fastAnswers: 0, asks: 0, photoReports: 0 },
      badges: ['early_adopter'], notifications: [], createdAt: this.now(),
    };
    this.users.push(user);
    this.notify(user.id, { icon: '🎉', text: `Welcome to KitaBantu, ${user.name.split(' ')[0]}!`, textMs: `Selamat datang ke KitaBantu, ${user.name.split(' ')[0]}!` });
    const token = this.createSession(user.id);
    this.save();
    this.emit('change', { kind: 'user.joined', user: this.publicUser(user) });
    return { token, user: this.userView(user.id) };
  }
  login({ email, password }) {
    email = String(email || '').trim().toLowerCase();
    const user = this.users.find((u) => u.email === email);
    if (!user || !auth.verifyPassword(password, user.password)) return { error: 'bad_credentials' };
    const token = this.createSession(user.id);
    this.save();
    return { token, user: this.userView(user.id) };
  }
  createSession(userId) { const token = auth.signToken(userId, SECRET); this.sessions[token] = userId; return token; }
  logout(token) { delete this.sessions[token]; this.revoked = this.revoked || {}; this.revoked[token] = Date.now(); this.save(); }
  /** Token → user. Signed tokens are re-adopted after a restart / demo reset as long as the user exists and the token wasn't logged out. */
  userForToken(token) {
    if (!token) return null;
    const id = this.sessions[token];
    if (id) return this.user(id);
    if (this.revoked && this.revoked[token]) return null;
    const uid = auth.verifyToken(token, SECRET);
    if (uid && this.user(uid)) { this.sessions[token] = uid; this.save(); return this.user(uid); }
    return null;
  }

  // ---------- users ----------
  user(id) { return this.users.find((u) => u.id === id) || null; }
  publicUser(u, lang = 'en') {
    if (!u) return null;
    const lvl = gam.levelFor(u.points);
    wardrobe.ensure(u);
    return { id: u.id, name: u.name, role: u.role, need: u.need, avatar: u.avatar, color: u.color, area: u.area, points: u.points, level: lvl.level, levelEmoji: lvl.emoji, title: lang === 'ms' ? lvl.titleMs : lvl.title, streak: u.streak || 0, thanks: u.thanks || 0, equipped: u.equipped, skin: u.skin, coins: u.coins, peep: u.peep || null };
  }
  userView(id, lang = 'en') {
    const u = this.user(id);
    if (!u) return null;
    const lvl = gam.levelFor(u.points);
    const badgeView = (b) => ({ id: b.id, icon: b.icon, name: lang === 'ms' ? b.nameMs : b.name, desc: lang === 'ms' ? b.descMs : b.desc });
    return {
      ...this.publicUser(u, lang), email: u.email,
      wardrobe: wardrobe.view(u, lang, lvl.level),
      nextLevelAt: lvl.next ? lvl.next.min : null, levelMin: lvl.min, progress: lvl.progress,
      stats: u.stats,
      badges: u.badges.map((b) => gam.BADGES.find((x) => x.id === b)).filter(Boolean).map(badgeView),
      lockedBadges: gam.BADGES.filter((b) => !u.badges.includes(b.id)).map(badgeView),
      missions: u.role === 'helper' ? this.missions(u.id, lang) : [],
      notifications: (u.notifications || []).slice(-12).reverse().map((n) => ({ ...n, text: lang === 'ms' && n.textMs ? n.textMs : n.text })),
      unread: (u.notifications || []).filter((n) => !n.read).length,
      rank: this.leaderboard('week').find((r) => r.id === u.id)?.rank || null,
      recent: this.transactions.filter((t) => t.userId === u.id).slice(-8).reverse(),
      impact: this.impact(u.id),
    };
  }
  /** How many people did this helper's reports/answers reach? (simple, honest proxy) */
  impact(userId) {
    const reports = this.reports.filter((r) => r.by === userId && !r.removed);
    const confirmsReceived = reports.reduce((s, r) => s + r.confirmations.length, 0);
    const answers = this.requests.flatMap((q) => q.answers).filter((a) => a.by === userId);
    const thanks = answers.filter((a) => a.thanked).length;
    return { reports: reports.length, confirmsReceived, answers: answers.length, thanks, peopleHelped: answers.length + confirmsReceived };
  }
  notify(userId, n) {
    const u = this.user(userId); if (!u) return;
    u.notifications = u.notifications || [];
    u.notifications.push({ id: 'n_' + crypto.randomBytes(3).toString('hex'), at: this.now(), read: false, ...n });
    if (u.notifications.length > 40) u.notifications = u.notifications.slice(-40);
    this.emit('notify', { userId, notification: u.notifications[u.notifications.length - 1] });
  }
  markRead(userId) { const u = this.user(userId); if (u) for (const n of u.notifications || []) n.read = true; this.save(); }
  updateProfile(userId, { name, avatar, color, area, need, peep }) {
    const u = this.user(userId); if (!u) return null;
    if (peep !== undefined) { const c = cleanPeep(peep); if (c || peep === null) u.peep = c; }
    if (name && String(name).trim().length >= 2) u.name = String(name).trim().slice(0, 40);
    if (avatar && typeof avatar === 'object') {
      u.avatar = KBAvatar.cleanParts(avatar);
      wardrobe.ensure(u);
      for (const [part, legacyId] of Object.entries(u.avatar)) { const id = wardrobe.LEGACY[part] && wardrobe.LEGACY[part][legacyId]; const layer = part === 'body' ? 'outfit' : part; if (id) { if (!u.inventory.includes(id)) u.inventory.push(id); u.equipped[layer] = id; } else if (layer !== 'hair' && layer !== 'outfit') delete u.equipped[layer]; }
    }
    if (COLORS.includes(color)) u.color = color;
    if (area != null) u.area = String(area).slice(0, 40);
    if (u.role === 'oku' && NEEDS[need]) u.need = need;
    this.save();
    return this.userView(userId);
  }

  buyItem(userId, itemId) {
    const u = this.user(userId); if (!u) return { error: 'unauthorized' };
    const out = wardrobe.buy(u, itemId, gam.levelFor(u.points).level);
    if (!out.ok) return { error: out.error, need: out.need, minLevel: out.minLevel };
    wardrobe.equip(u, itemId, true);
    this.save(); this.emit('change', { kind: 'user.updated', by: userId, user: this.publicUser(u) });
    return { ok: true, item: out.item, coins: u.coins, wardrobe: wardrobe.view(u, 'en', gam.levelFor(u.points).level) };
  }
  equipItem(userId, itemId, on = true) {
    const u = this.user(userId); if (!u) return { error: 'unauthorized' };
    const out = wardrobe.equip(u, itemId, on);
    if (!out.ok) return { error: out.error };
    this.save(); this.emit('change', { kind: 'user.updated', by: userId, user: this.publicUser(u) });
    return { ok: true, equipped: u.equipped, avatar: u.avatar };
  }
  setSkin(userId, skin) {
    const u = this.user(userId); if (!u) return { error: 'unauthorized' };
    wardrobe.ensure(u); u.skin = Math.max(1, Math.min(6, Number(skin) || 1)); this.save();
    return { ok: true, skin: u.skin };
  }

  /** Award points + streak + badges. Returns reward summary for UI celebration. */
  award(userId, type, amount, description, referenceId) {
    const u = this.user(userId);
    if (!u) return null;
    const before = gam.levelFor(u.points);
    wardrobe.ensure(u);
    const coinsBefore = wardrobe.coinsFor(u.points);
    u.points += amount;
    const coins = Math.max(0, wardrobe.coinsFor(u.points) - coinsBefore) + (type === 'request_answer' || type === 'answer' ? 3 : 0);
    u.coins += coins;
    const tx = { id: 't_' + crypto.randomBytes(4).toString('hex'), userId, type, amount, description, referenceId, at: this.now() };
    this.transactions.push(tx);
    const streak = gam.updateStreak(u, this.todayKey());
    if (streak.bonus) { u.points += streak.bonus; this.transactions.push({ id: 't_' + crypto.randomBytes(4).toString('hex'), userId, type: 'streak', amount: streak.bonus, description: `${streak.streak}-day streak bonus`, at: this.now() }); }
    const earned = gam.newBadges({ ...u.stats, streak: u.streak, disputedAgainst: this.disputedAgainst(userId) }, u.badges);
    u.badges.push(...earned);
    const after = gam.levelFor(u.points);
    const levelUp = after.level > before.level ? after : null;
    // missions completed by this action?
    const missionsDone = [];
    if (u.role === 'helper') for (const m of this.missions(userId)) if (m.done && !m.claimed) { missionsDone.push(m); u.claimedMissions = u.claimedMissions || {}; u.claimedMissions[`${this.todayKey()}:${m.id}`] = true; u.points += gam.POINTS.mission_complete; this.transactions.push({ id: 't_' + crypto.randomBytes(4).toString('hex'), userId, type: 'mission', amount: gam.POINTS.mission_complete, description: `Mission: ${m.title}`, at: this.now() }); }
    for (const b of earned) { const bd = gam.BADGES.find((x) => x.id === b); this.notify(userId, { icon: bd.icon, text: `Badge unlocked: ${bd.name}`, textMs: `Lencana dibuka: ${bd.nameMs}` }); }
    if (levelUp) this.notify(userId, { icon: levelUp.emoji, text: `Level up! You are now a ${levelUp.title}`, textMs: `Naik tahap! Anda kini ${levelUp.titleMs}` });
    if (levelUp) { u.coins += 50 * levelUp.level; }
    return { tx, points: amount, coins: coins + (levelUp ? 50 * levelUp.level : 0), streak, earned: earned.map((id) => gam.BADGES.find((b) => b.id === id)), level: after, levelUp, missionsDone, total: u.points, coinsTotal: u.coins };
  }
  disputedAgainst(userId) { return this.reports.filter((r) => r.by === userId && r.disputes.length >= 2).length; }

  /** Today's activity counters for missions. */
  todayStats(userId) {
    const dayStart = new Date(this.todayKey() + 'T00:00:00+08:00').getTime();
    const tx = this.transactions.filter((t) => t.userId === userId && t.at >= dayStart);
    const count = (type) => tx.filter((t) => t.type === type).length;
    const photoReports = this.reports.filter((r) => r.by === userId && r.photo && r.createdAt >= dayStart).length;
    return { answers: count('answer'), confirms: count('confirm'), reports: count('report'), photoReports, disputes: count('dispute') };
  }
  missions(userId, lang = 'en') {
    const u = this.user(userId); if (!u) return [];
    const today = this.todayStats(userId);
    const key = this.todayKey();
    return gam.MISSIONS.map((m) => {
      const progress = Math.min(m.goal, today[m.key] || 0);
      return { id: m.id, icon: m.icon, title: lang === 'ms' ? m.titleMs : m.title, goal: m.goal, progress, done: progress >= m.goal, claimed: !!(u.claimedMissions && u.claimedMissions[`${key}:${m.id}`]), reward: gam.POINTS.mission_complete };
    });
  }

  leaderboard(period = 'week', lang = 'en', area = null) {
    const since = period === 'today' ? this.now() - 24 * 3600e3 : period === 'week' ? this.now() - 7 * 24 * 3600e3 : 0;
    const totals = new Map();
    for (const t of this.transactions) if (t.at >= since) totals.set(t.userId, (totals.get(t.userId) || 0) + t.amount);
    let rows = this.users.map((u) => ({ ...this.publicUser(u, lang), points: period === 'all' ? u.points : totals.get(u.id) || 0 }));
    if (area) rows = rows.filter((r) => r.area === area);
    rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    return rows.map((r, i) => ({ rank: i + 1, ...r }));
  }

  // ---------- reports ----------
  report(id) { return this.reports.find((r) => r.id === id) || null; }

  scored(r, now = this.now(), lang = 'en') {
    const s = trust.scoreReport(r, now);
    const info = typeInfo(r.type);
    const by = this.user(r.by);
    return {
      id: r.id, type: r.type, kind: info.kind, icon: info.icon, label: lang === 'ms' ? info.ms : info.en, affects: info.affects, severity: info.severity,
      lat: r.lat, lng: r.lng, place: r.place, note: lang === 'ms' && r.noteMs ? r.noteMs : r.note, photo: r.photo, photoCheck: r.photoCheck,
      by: this.publicUser(by, lang),
      createdAt: r.createdAt, lastVerifiedAt: r.lastVerifiedAt,
      confirmations: r.confirmations.length, disputes: r.disputes.length,
      confirmedBy: r.confirmations.map((c) => this.user(c.userId)?.name).filter(Boolean),
      history: r.history.slice(-6).map((h) => ({ ...h, byName: h.by ? this.user(h.by)?.name || null : null })),
      ...s,
      status: r.removed ? 'removed' : s.status,
      bandLabel: lang === 'ms' ? s.bandLabelMs : s.bandLabel,
    };
  }

  listReports({ need, kinds, includeExpired = false, lang = 'en', bbox, near, radiusM } = {}) {
    const now = this.now();
    let out = this.reports.filter((r) => !r.removed).map((r) => this.scored(r, now, lang));
    if (!includeExpired) out = out.filter((r) => r.status === 'active');
    if (need) out = out.filter((r) => r.affects.includes(need));
    if (kinds && kinds.length) out = out.filter((r) => kinds.includes(r.kind));
    if (bbox) out = out.filter((r) => r.lat >= bbox.south && r.lat <= bbox.north && r.lng >= bbox.west && r.lng <= bbox.east);
    if (near) out = out.map((r) => ({ ...r, distM: Math.round(geo.haversine(near, r)) })).filter((r) => !radiusM || r.distM <= radiusM).sort((a, b) => a.distM - b.distM);
    return out;
  }

  createReport({ type, lat, lng, place, note, photo, photoCheck, userId }) {
    const info = typeInfo(type);
    const user = this.user(userId);
    if (!user) return { error: 'unauthorized' };
    const isFirst = user.stats.reports === 0;
    const now = this.now();
    const r = {
      id: 'r_' + crypto.randomBytes(5).toString('hex'), type, lat, lng, place: place || 'Unnamed location', note: note || '', noteMs: null,
      photo: photo || null, photoCheck: photoCheck || null, by: user.id, createdAt: now, lastVerifiedAt: now,
      confirmations: [], disputes: [], history: [{ kind: 'created', by: user.id, at: now }], removed: false,
    };
    this.reports.push(r);
    user.stats.reports++;
    if (photo) { user.stats.photos++; user.stats.photoReports++; }
    if (info.kind === 'obstacle') user.stats.obstacles++;
    if (['ramp', 'entrance'].includes(type)) user.stats.ramps++;
    if (['lift_ok', 'lift_broken'].includes(type)) user.stats.lifts++;
    const pts = gam.pointsForReport(info.kind, !!photo, isFirst);
    const reward = this.award(user.id, 'report', pts, `Reported ${info.en} – ${r.place}`, r.id);
    // OKU users nearby with a matching need get a heads-up about new obstacles
    if (info.kind === 'obstacle') for (const u of this.users) if (u.role === 'oku' && u.id !== user.id && info.affects.includes(u.need)) this.notify(u.id, { icon: info.icon, text: `New obstacle near you: ${info.en} at ${r.place}`, textMs: `Halangan baharu berdekatan: ${info.ms} di ${r.place}`, link: { kind: 'report', id: r.id } });
    this.save();
    const view = this.scored(r);
    this.emit('change', { kind: 'report.created', report: view, by: user.id });
    return { report: view, reward };
  }

  verify({ reportId, userId, action, at, note, photo, photoCheck }) {
    const r = this.report(reportId);
    if (!r || r.removed) return { error: 'not_found' };
    const user = this.user(userId);
    if (!user) return { error: 'unauthorized' };
    if (r.by === user.id) return { error: 'own_report' };
    if (r.confirmations.some((c) => c.userId === user.id) || r.disputes.some((d) => d.userId === user.id)) return { error: 'already_verified' };
    const now = this.now();
    const distM = at ? Math.round(geo.haversine(at, { lat: r.lat, lng: r.lng })) : null;
    const onsite = distM != null && distM <= ONSITE_RADIUS_M;
    let pts = 0, description = '';
    const info = typeInfo(r.type);
    if (action === 'confirm') {
      r.confirmations.push({ userId: user.id, at: now, onsite, distM });
      r.lastVerifiedAt = now;
      r.history.push({ kind: 'confirmed', by: user.id, at: now, onsite });
      user.stats.confirms++;
      pts = gam.POINTS.confirm + (onsite ? gam.POINTS.confirm_onsite_bonus : 0);
      description = `Confirmed ${info.en} – ${r.place}`;
      this.award(r.by, 'confirm_received', 2, `Your report was confirmed – ${r.place}`, r.id);
      this.notify(r.by, { icon: '✅', text: `${user.name} confirmed your report at ${r.place} (+2)`, textMs: `${user.name} mengesahkan laporan anda di ${r.place} (+2)`, link: { kind: 'report', id: r.id } });
    } else if (action === 'dispute') {
      r.disputes.push({ userId: user.id, at: now, onsite, distM, note: note || '', photo: photo || null });
      r.history.push({ kind: 'disputed', by: user.id, at: now, onsite, note: note || '' });
      user.stats.disputes++;
      pts = gam.POINTS.dispute;
      description = `Disputed ${info.en} – ${r.place}`;
      if (r.disputes.length >= 2) { r.removed = true; r.history.push({ kind: 'removed', at: now, reason: '2 disputes' }); }
      this.notify(r.by, { icon: '❌', text: `${user.name} disputed your report at ${r.place}${r.removed ? ' — it has been removed' : ''}`, textMs: `${user.name} mempertikaikan laporan anda di ${r.place}${r.removed ? ' — ia telah dibuang' : ''}`, link: { kind: 'report', id: r.id } });
    } else return { error: 'bad_action' };
    const reward = this.award(user.id, action, pts, description, r.id);
    this.save();
    const view = this.scored(r);
    this.emit('change', { kind: r.removed ? 'report.removed' : 'report.updated', report: view, by: user.id, action });
    return { report: view, reward: { ...reward, onsite, distM } };
  }

  // ---------- check requests ----------
  request(id) { return this.requests.find((q) => q.id === id) || null; }
  requestView(q, lang = 'en', viewer = null) {
    const by = this.user(q.by);
    const need = NEEDS[q.need];
    return {
      id: q.id, by: this.publicUser(by, lang), need: q.need, needLabel: need ? need[lang] : q.need, needIcon: need ? need.icon : '❓',
      lat: q.lat, lng: q.lng, place: q.place, question: lang === 'ms' && q.questionMs ? q.questionMs : q.question, urgency: q.urgency, status: q.status, createdAt: q.createdAt,
      ageMin: Math.round((this.now() - q.createdAt) / 60000),
      distM: viewer && viewer.lat != null ? Math.round(geo.haversine(viewer, q)) : null,
      answers: q.answers.map((a) => ({ id: a.id, by: this.publicUser(this.user(a.by), lang), verdict: a.verdict, note: a.note, photo: a.photo, at: a.at, thanked: a.thanked, points: a.points, ai: a.ai || null, distM: a.distM ?? null })),
      mine: viewer && viewer.id === q.by,
      answeredByMe: viewer ? q.answers.some((a) => a.by === viewer.id) : false,
      bounty: this.bountyFor(q),
    };
  }
  /** Points a helper would earn right now for answering (shown on the card). */
  bountyFor(q) {
    const ageMin = (this.now() - q.createdAt) / 60000;
    let p = gam.POINTS.request_answer;
    if (ageMin <= 30) p += gam.POINTS.request_fast_bonus;
    return { base: p, withPhoto: p + gam.POINTS.request_answer_photo, fastWindowMin: Math.max(0, Math.round(30 - ageMin)) };
  }
  listRequests({ status, lang = 'en', viewer = null, mine = false, near = null } = {}) {
    let qs = this.requests.slice();
    if (mine && viewer) qs = qs.filter((q) => q.by === viewer.id || q.answers.some((a) => a.by === viewer.id));
    if (status) qs = qs.filter((q) => q.status === status);
    const v = viewer ? { ...viewer, ...(near || {}) } : (near ? { lat: near.lat, lng: near.lng } : null);
    const out = qs.map((q) => this.requestView(q, lang, v));
    const urgencyRank = { today: 0, this_week: 1, whenever: 2 };
    out.sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || (urgencyRank[a.urgency] - urgencyRank[b.urgency]) || b.createdAt - a.createdAt);
    return out;
  }
  createRequest({ userId, place, question, lat, lng, urgency }) {
    const user = this.user(userId);
    if (!user) return { error: 'unauthorized' };
    if (user.role !== 'oku') return { error: 'oku_only' };
    if (!question || String(question).trim().length < 8) return { error: 'question_too_short' };
    const q = { id: 'q_' + crypto.randomBytes(5).toString('hex'), by: user.id, need: user.need, lat, lng, place: String(place || 'Unnamed place').slice(0, 120), question: String(question).trim().slice(0, 400), questionMs: null, urgency: ['today', 'this_week', 'whenever'].includes(urgency) ? urgency : 'this_week', status: 'open', createdAt: this.now(), answers: [] };
    this.requests.push(q);
    user.stats.asks++;
    const reward = this.award(user.id, 'ask', gam.POINTS.ask_bonus, `Asked the community – ${q.place}`, q.id);
    // notify helpers (all, for the demo; production: within radius)
    for (const u of this.users) if (u.role === 'helper') this.notify(u.id, { icon: '🙋', text: `${user.name.split(' ')[0]} needs a check at ${q.place} (+${this.bountyFor(q).base} pts)`, textMs: `${user.name.split(' ')[0]} perlukan semakan di ${q.place} (+${this.bountyFor(q).base} mata)`, link: { kind: 'request', id: q.id } });
    this.save();
    const view = this.requestView(q);
    this.emit('change', { kind: 'request.created', request: view, by: user.id });
    return { request: view, reward };
  }
  answerRequest({ requestId, userId, verdict, note, photo, at, ai = null }) {
    const q = this.request(requestId);
    if (!q) return { error: 'not_found' };
    const user = this.user(userId);
    if (!user) return { error: 'unauthorized' };
    if (q.by === user.id) return { error: 'own_request' };
    if (q.answers.some((a) => a.by === user.id)) return { error: 'already_answered' };
    if (!['yes', 'no', 'partly'].includes(verdict)) return { error: 'bad_verdict' };
    if (!note || String(note).trim().length < 4) return { error: 'note_too_short' };
    const now = this.now();
    const minutes = (now - q.createdAt) / 60000;
    const { points, parts } = gam.pointsForAnswer({ hasPhoto: !!photo, minutesToAnswer: minutes });
    const a = { id: q.id + '_a' + q.answers.length, by: user.id, verdict, note: String(note).trim().slice(0, 500), photo: photo || null, at: now, thanked: false, points, distM: at ? Math.round(geo.haversine(at, q)) : null, ai: ai || null };
    q.answers.push(a);
    if (q.status === 'open') q.status = 'answered';
    user.stats.answers++;
    if (minutes <= 30) user.stats.fastAnswers++;
    if (photo) user.stats.photos++;
    const reward = this.award(user.id, 'answer', points, `Answered ${this.user(q.by)?.name.split(' ')[0]} – ${q.place}`, q.id);
    this.notify(q.by, { icon: '💬', text: `${user.name} answered your question about ${q.place}: ${verdict === 'yes' ? 'Yes' : verdict === 'no' ? 'No' : 'Partly'}`, textMs: `${user.name} menjawab soalan anda tentang ${q.place}: ${verdict === 'yes' ? 'Ya' : verdict === 'no' ? 'Tidak' : 'Sebahagian'}`, link: { kind: 'request', id: q.id } });
    this.save();
    const view = this.requestView(q);
    this.emit('change', { kind: 'request.answered', request: view, by: user.id });
    return { request: view, reward: { ...reward, parts } };
  }
  thankAnswer({ requestId, answerId, userId }) {
    const q = this.request(requestId);
    if (!q) return { error: 'not_found' };
    if (q.by !== userId) return { error: 'not_owner' };
    const a = q.answers.find((x) => x.id === answerId);
    if (!a) return { error: 'not_found' };
    if (a.thanked) return { error: 'already_thanked' };
    a.thanked = true;
    q.status = 'closed';
    const helper = this.user(a.by);
    if (helper) { helper.thanks = (helper.thanks || 0) + 1; this.award(helper.id, 'thanks', gam.POINTS.request_thanks, `${this.user(userId)?.name.split(' ')[0]} said thank you – ${q.place}`, q.id); this.notify(helper.id, { icon: '💖', text: `${this.user(userId)?.name} thanked you for ${q.place} (+${gam.POINTS.request_thanks})`, textMs: `${this.user(userId)?.name} mengucapkan terima kasih untuk ${q.place} (+${gam.POINTS.request_thanks})`, link: { kind: 'request', id: q.id } }); }
    this.save();
    const view = this.requestView(q);
    this.emit('change', { kind: 'request.thanked', request: view, by: userId });
    return { request: view };
  }

  // ---------- activity feed ----------
  feed(lang = 'en', limit = 20) {
    const items = [];
    for (const r of this.reports) if (!r.removed) {
      const info = typeInfo(r.type);
      items.push({ at: r.createdAt, icon: info.icon, kind: 'report', by: this.publicUser(this.user(r.by), lang), text: `${lang === 'ms' ? 'melaporkan' : 'reported'} ${lang === 'ms' ? info.ms : info.en} · ${r.place}`, link: { kind: 'report', id: r.id } });
      for (const c of r.confirmations) items.push({ at: c.at, icon: '✅', kind: 'confirm', by: this.publicUser(this.user(c.userId), lang), text: `${lang === 'ms' ? 'mengesahkan' : 'confirmed'} ${lang === 'ms' ? info.ms : info.en} · ${r.place}`, link: { kind: 'report', id: r.id } });
    }
    for (const q of this.requests) {
      items.push({ at: q.createdAt, icon: '🙋', kind: 'ask', by: this.publicUser(this.user(q.by), lang), text: `${lang === 'ms' ? 'bertanya tentang' : 'asked about'} ${q.place}`, link: { kind: 'request', id: q.id } });
      for (const a of q.answers) items.push({ at: a.at, icon: '💬', kind: 'answer', by: this.publicUser(this.user(a.by), lang), text: `${lang === 'ms' ? 'menjawab' : 'answered'} ${this.user(q.by)?.name.split(' ')[0]} · ${q.place}`, link: { kind: 'request', id: q.id } });
    }
    items.sort((a, b) => b.at - a.at);
    return items.slice(0, limit);
  }

  stats() {
    const now = this.now();
    const scored = this.reports.filter((r) => !r.removed).map((r) => trust.scoreReport(r, now));
    const bands = { verified: 0, aging: 0, old: 0, expired: 0 };
    for (const s of scored) bands[s.band]++;
    return { reports: scored.length, active: scored.filter((s) => s.status === 'active').length, bands, users: this.users.length, helpers: this.users.filter((u) => u.role === 'helper').length, oku: this.users.filter((u) => u.role === 'oku').length, openRequests: this.requests.filter((q) => q.status === 'open').length, answers: this.requests.reduce((s, q) => s + q.answers.length, 0), confirmations: this.reports.reduce((s, r) => s + r.confirmations.length, 0), clockOffsetH: Math.round(this.clock.offsetMs / 36e5 * 10) / 10 };
  }
}

module.exports = { Store, ONSITE_RADIUS_M, AVATARS, COLORS, cleanPeep };
