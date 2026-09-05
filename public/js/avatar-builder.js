/* <AvatarBuilder /> — reusable Preact (React-compatible API) component that stacks Open Peeps SVG layers
 *
 *   body → pose → face → facial-hair → head → accessories   (absolute positioning inside one square canvas)
 *
 *   props:
 *     value      current peep (see KBPeeps)                       onChange(peep)  fires on every edit
 *     user       { level, points, role, need } for lock rules       onSave(peep)    optional "Save" button
 *     compact    tighter layout for modals                         title           heading text
 *
 *   Gender logic  : Male → facial-hair + short/shaved/etc. hair · Female → long/medium/bun hair, no facial-hair
 *                   body / face / accessories / poses are unisex.
 *   Progression   : tiers free → bronze (Lv2 / 100 pts) → silver (Lv3 / 300) → gold (Lv4 / 700) → hero (Lv5 / 1500).
 *                   Locked tiles show a padlock + requirement; accessibility identity items are never locked.
 *
 *   mount(host, props) renders it into any DOM node from the plain-JS app; window.AvatarBuilder is the component.
 */
(function (root) {
  const { h, render: prender, Fragment } = root.preact;
  const { useState, useEffect, useMemo, useRef, useCallback } = root.preactHooks;
  const P = () => root.KBPeeps;
  const tr = (k, vars) => {
    if (root.KBApp && root.KBApp.t) return root.KBApp.t(k, vars);
    const lang = localStorage.getItem('kb.lang') || 'en'; let s = ((root.I18N || {})[lang] || {})[k] ?? ((root.I18N || {}).en || {})[k] ?? k;
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace(new RegExp(`\\{${a}\\}`, 'g'), b);
    return s;
  };
  const icon = (n, s = 14) => ({ __html: root.I ? root.I(n, s) : '' });

  const TABS = [
    { layer: 'head', key: 'head', label: 'tab_head', required: true },
    { layer: 'face', key: 'face', label: 'tab_face', required: true },
    { layer: 'body', key: 'body', label: 'tab_body', required: true },
    { layer: 'pose', key: 'pose', label: 'tab_pose', required: false },
    { layer: 'facial-hair', key: 'facialHair', label: 'tab_beard', required: false, male: true },
    { layer: 'accessories', key: 'accessory', label: 'tab_glasses', required: false },
    { layer: 'colours', key: null, label: 'tab_colours', required: false },
  ];
  const tierLabel = (t) => ({ free: '', bronze: 'Bronze', silver: 'Silver', gold: 'Gold', hero: 'Hero' })[t] || '';

  /** The stacked character. Pure: value → layers. */
  function PeepCanvas({ value, size = 320, crop = 'bust', bg = 'none', className = '' }) {
    const ref = useRef(null);
    const html = useMemo(() => (P() && P().ready() ? P().render(value, size, { crop, bg, className: 'pc' }) : ''), [JSON.stringify(value), size, crop, bg]);
    useEffect(() => { if (ref.current) P().hydrate(ref.current); }, [html]);
    return h('div', { ref, class: `peep-canvas ${className}`, dangerouslySetInnerHTML: { __html: html } });
  }

  /** One option tile: preview of the atom alone (cropped sensibly), lock badge, selected state. */
  function Tile({ it, selected, onPick, layer }) {
    const crop = layer === 'head' ? 'head' : layer === 'face' ? 'face' : layer === 'accessories' || layer === 'facial-hair' ? 'face' : 'full';
    return h('button', {
      type: 'button', class: `ab-tile ${selected ? 'on' : ''} ${it.locked ? 'locked' : ''} t-${it.tier}`, 'data-id': it.id, title: it.locked ? tr('unlocks_at_lvl', { n: it.minLevel, p: it.minPoints }) : it.name,
      onClick: () => onPick(it), 'aria-pressed': selected, 'data-locked': it.locked ? '1' : null,
    },
    h('span', { class: `pic pic-${layer}` }, h('img', { src: it.url, alt: it.name, loading: 'lazy', draggable: false })),
    h('span', { class: 'nm' }, it.name),
    it.locked ? h('span', { class: 'lock' }, h('i', { dangerouslySetInnerHTML: icon('lock', 11) }), ` Lv ${it.minLevel}`) : it.tier !== 'free' ? h('span', { class: `tier ${it.tier}` }, tierLabel(it.tier)) : null,
    selected ? h('span', { class: 'chk', dangerouslySetInnerHTML: icon('check', 12) }) : null);
  }

  function Swatches({ label, colours, value, onPick }) {
    return h('div', { class: 'ab-swatch-row' }, h('small', null, label), h('div', { class: 'ab-swatches' }, colours.map((c) => h('button', { type: 'button', key: c, class: `sw ${value === c ? 'on' : ''}`, style: { background: c }, 'aria-label': c, onClick: () => onPick(c) }))));
  }

  function AvatarBuilder({ value, onChange, onSave, user = null, compact = false, title = '', showGender = true, showDownload = true }) {
    const [tab, setTab] = useState('head');
    const [toast, setToast] = useState(null);
    const [pop, setPop] = useState(0);
    const peep = value;
    const gender = peep.gender || 'any';
    const set = useCallback((patch) => { const next = { ...peep, ...patch }; setPop((n) => n + 1); onChange(next); }, [peep, onChange]);

    // gender switch: re-validate hair / facial hair against the new rules
    const setGender = (g) => {
      const patch = { gender: g };
      if (!P().genderOk('head', (P().item(peep.head) || {}).slug || '', g)) { const heads = P().options('head', { gender: g, user, includeLocked: false }); if (heads.length) patch.head = heads[0].id; }
      if (g === 'female' && peep.facialHair) patch.facialHair = null;
      if (g === 'male' && /dress/.test(peep.body || '')) patch.body = 'body/hoodie';
      set(patch);
      if (tab === 'facial-hair' && g === 'female') setTab('head');
    };
    const tabs = TABS.filter((t) => !(t.male && gender === 'female'));
    const cur = tabs.find((t) => t.layer === tab) || tabs[0];
    const list = useMemo(() => (cur.layer === 'colours' ? [] : P().options(cur.layer, { gender, user })), [cur.layer, gender, user && user.level, user && user.points, pop]);

    const pickTile = (it) => {
      if (it.locked) { setToast(tr('locked_msg', { name: it.name, n: it.minLevel, p: it.minPoints })); setTimeout(() => setToast(null), 2600); return; }
      if (cur.layer === 'pose') { set({ pose: it.id, mode: 'full' }); return; }
      const patch = { [cur.key]: it.id };
      if (cur.layer === 'facial-hair' && gender !== 'male') patch.gender = 'male';                 // a beard implies the male wardrobe
      if (cur.layer === 'body' && /dress/.test(it.slug) && gender !== 'female') patch.gender = 'female';
      set(patch);
    };
    const clearLayer = () => { if (cur.layer === 'pose') set({ pose: null, mode: 'bust' }); else set({ [cur.key]: null }); };
    const shuffle = () => { const r = P().random(user && user.role, user && user.need, gender, user); set({ ...r, gender, mode: peep.mode === 'full' && peep.pose ? 'full' : r.mode, pose: peep.mode === 'full' && peep.pose ? peep.pose : r.pose }); };
    const download = async () => { const svg = await P().toSVG(peep); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); a.download = 'kitabantu-avatar.svg'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };

    const selectedId = cur.key ? peep[cur.key] : null;
    const crop = peep.mode === 'full' ? 'full' : (tab === 'head' || tab === 'face' || tab === 'facial-hair' || tab === 'accessories') ? 'head' : 'bust';

    return h('div', { class: `ab ${compact ? 'compact' : ''}` },
      h('div', { class: 'ab-stage', style: { background: peep.bg || '#f1f1f1' } },
        h('div', { class: 'ab-top' },
          h('div', { class: 'ttl' }, h('b', null, title || tr('your_avatar')), h('small', null, tr('by_you'))),
          h('button', { type: 'button', class: 'icon-btn', title: tr('shuffle'), onClick: shuffle, dangerouslySetInnerHTML: icon('refresh', 18) }),
          showDownload ? h('button', { type: 'button', class: 'icon-btn dark', title: tr('download'), onClick: download, dangerouslySetInnerHTML: icon('download', 18) }) : null),
        h('div', { class: `ab-canvas ${pop ? 'pop' : ''}`, key: pop }, h(PeepCanvas, { value: peep, size: compact ? 260 : 330, crop })),
        showGender ? h('div', { class: 'ab-gender', role: 'radiogroup', 'aria-label': 'gender' }, [['any', 'g_any'], ['female', 'g_female'], ['male', 'g_male']].map(([g, l]) => h('button', { type: 'button', key: g, role: 'radio', 'aria-checked': gender === g, class: gender === g ? 'on' : '', onClick: () => setGender(g) }, tr(l)))) : null,
        toast ? h('div', { class: 'ab-toast' }, h('i', { dangerouslySetInnerHTML: icon('lock', 13) }), ' ', toast) : null),
      h('div', { class: 'ab-tabs', role: 'tablist' }, tabs.map((t) => h('button', { type: 'button', key: t.layer, role: 'tab', 'aria-selected': t.layer === cur.layer, class: t.layer === cur.layer ? 'active' : '', onClick: () => setTab(t.layer) }, tr(t.label)))),
      cur.layer === 'colours'
        ? h('div', { class: 'ab-colours' },
          h(Swatches, { label: tr('c_hair'), colours: P().HAIRS, value: peep.hair || '#111111', onPick: (c) => set({ hair: c }) }),
          h(Swatches, { label: tr('c_bg'), colours: P().BGS, value: peep.bg, onPick: (c) => set({ bg: c }) }),
          h('p', { class: 'muted small' }, tr('mono_note')))
        : h('div', { class: 'ab-grid', role: 'listbox' },
          !cur.required ? h('button', { type: 'button', class: `ab-tile none ${!selectedId ? 'on' : ''}`, onClick: clearLayer }, h('span', { class: 'nm' }, tr('none_opt'))) : null,
          list.map((it) => h(Tile, { key: it.id, it, layer: cur.layer, selected: selectedId === it.id, onPick: pickTile }))),
      h('div', { class: 'ab-foot' },
        h('span', { class: 'muted' }, tr('ab_hint', { n: (user && user.level) || 1 })),
        onSave ? h('button', { type: 'button', class: 'btn btn-black', onClick: () => onSave(peep) }, tr('save')) : null));
  }

  /** Mount helper for the vanilla app. Returns { update(props), unmount() }. */
  function mount(host, props) {
    let cur = props;
    const draw = () => prender(h(AvatarBuilder, cur), host);
    draw();
    return { update(p) { cur = { ...cur, ...p }; draw(); }, unmount() { prender(null, host); } };
  }
  root.AvatarBuilder = AvatarBuilder; root.PeepCanvas = PeepCanvas; root.AvatarBuilderMount = mount;
})(window);
