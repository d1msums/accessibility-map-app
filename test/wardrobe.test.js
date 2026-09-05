const test = require('node:test');
const assert = require('node:assert');
const wardrobe = require('../lib/wardrobe');
const { Store } = require('../lib/store');
const store = new Store();

test('wardrobe: migrates a legacy user, grants welcome coins and starters', () => {
  const u = { id: 'x', points: 250, avatar: { hair: 'afro', body: 'hoodie', item: 'coffee', glasses: 'round', aid: 'wheelchair' } };
  wardrobe.ensure(u);
  assert.equal(u.coins, wardrobe.coinsFor(250) + 60);
  assert.ok(u.inventory.includes('hair_afro') && u.inventory.includes('outfit_hoodie') && u.inventory.includes('aid_wheelchair'));
  assert.equal(u.equipped.hair, 'hair_afro');
  assert.equal(u.equipped.outfit, 'outfit_hoodie');
  assert.equal(u.equipped.aid, 'aid_wheelchair');
  assert.ok(u.inventory.includes('outfit_tee'), 'starter items owned');
});

test('wardrobe: buy checks coins + level, equips and syncs the legacy avatar', () => {
  const u = { id: 'y', points: 0, avatar: {} };
  wardrobe.ensure(u); // 60 welcome coins
  let r = wardrobe.buy(u, 'outfit_hero', 2);
  assert.equal(r.ok, false); assert.equal(r.error, 'level_locked');
  r = wardrobe.buy(u, 'outfit_hoodie', 2);
  assert.equal(r.ok, false); assert.equal(r.error, 'not_enough_coins'); assert.equal(r.need, 30);
  u.coins = 100;
  r = wardrobe.buy(u, 'outfit_hoodie', 2);
  assert.equal(r.ok, true); assert.equal(u.coins, 10);
  assert.equal(wardrobe.buy(u, 'outfit_hoodie', 2).error, 'already_owned');
  assert.equal(wardrobe.equip(u, 'outfit_hoodie', true).ok, true);
  assert.equal(u.equipped.outfit, 'outfit_hoodie');
  assert.equal(u.avatar.body, 'hoodie', 'legacy avatar follows the wardrobe');
  assert.equal(wardrobe.equip(u, 'glasses_round', true).error, 'not_owned');
  const v = wardrobe.view(u, 'ms', 2);
  assert.ok(v.items.find((i) => i.id === 'outfit_hoodie').equipped);
  assert.ok(v.items.find((i) => i.id === 'outfit_hero').locked);
  assert.equal(typeof v.items[0].name, 'string');
});

test('store: awards coins with points and exposes wardrobe in userView', () => {
  store.reset(false);
  const ahmad = store.users.find((x) => x.email === 'ahmad@demo.my');
  const before = store.userView(ahmad.id);
  assert.ok(before.wardrobe && Array.isArray(before.wardrobe.items) && before.wardrobe.items.length > 20);
  const coins0 = before.coins;
  const r = store.award(ahmad.id, 'answer', 25, 'test', null);
  assert.ok(r.coins >= 5, `coins granted: ${r.coins}`);
  assert.equal(store.userView(ahmad.id).coins, coins0 + r.coins);
  const buy = store.buyItem(ahmad.id, 'glasses_round');
  assert.equal(buy.ok, true);
  assert.equal(store.userView(ahmad.id).equipped.glasses, 'glasses_round');
  assert.equal(store.equipItem(ahmad.id, 'glasses_round', false).ok, true);
  assert.equal(store.userView(ahmad.id).equipped.glasses, undefined);
});
