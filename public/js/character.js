/* KBCharacter — draws the player's 2D character from layered PNG art in /assets/character/…
 *
 *  Layer order (bottom → top): background, aid_behind, body, outfit, head, hair, glasses, item, aid, pet, frame
 *  Every PNG shares ONE canvas (1024×1024, transparent) so layers simply stack.
 *  If no art exists for the equipped set we fall back to the built-in line-art avatar (KBAvatar),
 *  so the app looks right before the designer's files arrive and after.
 */
(function (root) {
  const ORDER = ['background', 'aid_behind', 'body', 'outfit', 'head', 'hair', 'glasses', 'item', 'aid', 'pet', 'frame'];
  let CAT = null;          // { byId, base:{body:[],head:[]}, hasArt }
  let loading = null;

  async function load(force = false) {
    if (CAT && !force) return CAT;
    if (loading && !force) return loading;
    loading = fetch('/api/wardrobe/catalogue').then((r) => r.json()).then((d) => {
      const byId = {}; for (const it of d.items || []) byId[it.id] = it;
      CAT = { byId, base: d.base || { body: [], head: [] }, hasArt: (d.items || []).some((i) => i.art) || ((d.base && d.base.body && d.base.body.length) > 0), illustrations: d.illustrations || {} };
      if (root.ART && root.ART.setFiles) root.ART.setFiles(CAT.illustrations);
      return CAT;
    }).catch(() => (CAT = { byId: {}, base: { body: [], head: [] }, hasArt: false }));
    return loading;
  }
  function ready() { return !!CAT; }
  function hasArt() { return !!(CAT && CAT.hasArt); }

  /** Which files to stack for a user ({equipped, skin}). Returns [] when art is missing for the base body. */
  function layersFor(u) {
    if (!CAT) return [];
    const eq = (u && u.equipped) || {};
    const skin = Math.max(1, Number((u && u.skin) || 1));
    const pick = (arr) => (arr && arr.length ? arr[Math.min(arr.length, skin) - 1] : null);
    const out = [];
    for (const layer of ORDER) {
      if (layer === 'body' || layer === 'head') { const f = pick(CAT.base[layer]); if (f) out.push({ layer, src: f }); continue; }
      if (layer === 'aid_behind') { const it = eq.aid && CAT.byId[eq.aid]; if (it && it.artBehind) out.push({ layer, src: it.artBehind }); continue; }
      const id = eq[layer]; const it = id && CAT.byId[id];
      if (it && it.art) out.push({ layer, src: it.art, offset: it.offset || null });
    }
    return out;
  }
  /** True when the character can be drawn from art (needs at least a body or head file). */
  function canDraw(u) { const ls = layersFor(u); return ls.some((l) => l.layer === 'body' || l.layer === 'head'); }

  /**
   * HTML for the character. size px; opts.crop 'full' | 'bust' | 'head'; opts.bg background colour.
   * Falls back to KBAvatar when art is missing.
   */
  function render(u, size = 120, { crop = 'full', bg = null, className = '' } = {}) {
    const layers = layersFor(u);
    if (!layers.some((l) => l.layer === 'body' || l.layer === 'head')) {
      return root.KBAvatar ? root.KBAvatar.render({ ...((u && u.avatar) || {}), accent: bg || (u && u.color) || '#f4f1ea' }, size, { bg: bg === 'none' ? 'none' : 'soft', crop: crop === 'head' ? 'head' : crop === 'bust' ? 'bust' : 'full', className }) : '';
    }
    // crop = zoom on the top part of the 1024 canvas
    const zoom = crop === 'head' ? 2.2 : crop === 'bust' ? 1.5 : 1;
    const shiftY = crop === 'head' ? -8 : crop === 'bust' ? -10 : 0; // percent
    const imgs = layers.map((l) => `<img src="${l.src}" alt="" draggable="false" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;transform:scale(${zoom}) translateY(${shiftY}%);transform-origin:50% 0;${l.offset ? `margin-left:${l.offset.x || 0}%;margin-top:${l.offset.y || 0}%;` : ''}">`).join('');
    return `<span class="kb-char ${className}" style="position:relative;display:inline-block;width:${size}px;height:${size}px;overflow:hidden;border-radius:inherit;background:${bg && bg !== 'none' ? bg : 'transparent'}" role="img" aria-label="character">${imgs}</span>`;
  }
  /** One shop tile preview: the item alone on a neutral base (or the line-art part). */
  function renderItem(it, size = 96, base = null) {
    if (it && it.art) return `<span class="kb-char" style="position:relative;display:inline-block;width:${size}px;height:${size}px"><img src="${it.art}" alt="${it.name || ''}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain"></span>`;
    if (it && it.legacy && root.KBAvatar) return root.KBAvatar.renderPart(it.legacy.part, it.legacy.legacyId, size, { base: base || null, crop: it.legacy.part === 'hair' || it.legacy.part === 'glasses' ? 'head' : it.legacy.part === 'aid' ? 'full' : 'bust' });
    return `<span class="kb-char ph" style="display:grid;place-items:center;width:${size}px;height:${size}px;color:var(--muted);font-size:11px">${(it && it.name) || ''}</span>`;
  }
  root.KBCharacter = { load, ready, hasArt, layersFor, canDraw, render, renderItem, ORDER };
})(window);
