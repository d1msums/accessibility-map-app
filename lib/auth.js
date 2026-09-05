'use strict';
/** Password hashing + session tokens. No dependencies (crypto.scrypt). */
const crypto = require('crypto');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(password), salt, 32);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

const newToken = () => crypto.randomBytes(24).toString('base64url');

/** Stateless, signed session token: <userId>.<nonce>.<hmac>. Survives server restarts; cannot be forged without the secret. */
const b64 = (buf) => Buffer.from(buf).toString('base64url');
function signToken(userId, secret) {
  const nonce = crypto.randomBytes(12).toString('base64url');
  const body = `${b64(userId)}.${nonce}`;
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function verifyToken(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [id64, nonce, mac] = parts;
  const expect = crypto.createHmac('sha256', secret).update(`${id64}.${nonce}`).digest('base64url');
  if (expect.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(mac))) return null;
  try { return Buffer.from(id64, 'base64url').toString('utf8'); } catch { return null; }
}
module.exports = { hashPassword, verifyPassword, newToken, signToken, verifyToken };
