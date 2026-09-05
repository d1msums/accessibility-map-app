/* Line-art illustrations (inline SVG, black strokes on transparent) for landing + onboarding. */
window.ART = (() => {
  const S = 'fill:none;stroke:#111;stroke-width:3;stroke-linecap:round;stroke-linejoin:round';
  const W = 'fill:#fff;stroke:#111;stroke-width:3;stroke-linecap:round;stroke-linejoin:round';
  const F = 'fill:#111;stroke:#111;stroke-width:2.5;stroke-linejoin:round';
  const G = 'fill:#dcdcdc;stroke:none';

  /** Hero: a helper (phone with the route) meets a wheelchair user at a verified lift; calm blob + sparkles */
  const hero = (light = false) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 420" role="img" aria-label="A neighbour checks a station lift together with a wheelchair user">
    <path style="fill:${light ? '#e9e9e9' : '#e3e3e3'};stroke:none" d="M58 292C30 214 78 122 184 98s216 8 302 44 90 132 34 194-176 70-282 62S86 370 58 292z"/>
    <path style="${S};stroke:#bdbdbd;stroke-dasharray:2 8" d="M48 372h468"/>
    <!-- lift -->
    <rect x="350" y="82" width="140" height="250" rx="10" style="${W}"/>
    <rect x="362" y="106" width="56" height="214" rx="5" style="${W}"/><rect x="422" y="106" width="56" height="214" rx="5" style="${W}"/>
    <path style="${S}" d="M412 190v30M428 190v30"/>
    <rect x="394" y="58" width="52" height="18" rx="6" style="${W}"/><path style="${F}" d="M414 71l6-8 6 8z"/>
    <circle cx="510" cy="196" r="11" style="${W}"/><path style="${S}" d="M506 193l4-5 4 5M506 200l4 5 4-5"/>
    <path style="${W}" d="M420 24c-11 0-20 9-20 20 0 15 20 34 20 34s20-19 20-34c0-11-9-20-20-20z"/><path style="${S}" d="m412 44 6 6 11-12"/>
    <ellipse cx="420" cy="340" rx="78" ry="5" style="${G}"/>
    <!-- helper (standing, holding phone with the route) -->
    <ellipse cx="256" cy="368" rx="48" ry="6" style="${G}"/>
    <path style="${W}" d="M220 268h72l-6 86h-22l-8-52-8 52h-22z"/>
    <rect x="212" y="350" width="44" height="16" rx="8" style="${W}"/><rect x="256" y="350" width="44" height="16" rx="8" style="${W}"/>
    <path style="${W}" d="M222 178c8-14 20-20 34-20s26 6 34 20l4 92h-76z"/><path style="${S}" d="M245 162q11 14 22 0M256 176v94M240 238h32"/>
    <path style="${S}" d="M290 186l38-30M222 186l-14 50 14 12"/><circle cx="332" cy="150" r="8" style="${W}"/>
    <rect x="200" y="236" width="28" height="46" rx="6" style="${W}"/><path style="${S}" d="M208 272q6-12 14-8"/><path style="${F}" d="M218 250c-3 0-5 2-5 5 0 4 5 9 5 9s5-5 5-9c0-3-2-5-5-5z"/>
    <circle cx="256" cy="126" r="25" style="${W}"/>
    <path style="${F}" d="M231 122c0-22 11-32 25-32s25 10 25 32c-6-12-14-17-25-17s-19 5-25 17z"/>
    <circle cx="248" cy="129" r="2.4" fill="#111"/><circle cx="264" cy="129" r="2.4" fill="#111"/><path style="${S}" d="M250 139q6 5 12 0"/>
    <rect x="250" y="150" width="12" height="10" style="${W}"/>
    <!-- wheelchair user (seated, hijab) -->
    <ellipse cx="150" cy="368" rx="90" ry="6" style="${G}"/>
    <path style="${S}" d="M96 262 88 194h-18"/>
    <path style="${W}" d="M104 192c0-14 12-20 26-20s26 6 26 20l4 70H100z"/><path style="${S}" d="M118 210h24"/>
    <path style="${W}" d="M150 258h34a10 10 0 0 1 10 10v64h-10v-60h-34z"/>
    <rect x="172" y="328" width="34" height="13" rx="6.5" style="${W}"/><path style="${S}" d="M160 344h50"/>
    <rect x="88" y="262" width="96" height="12" rx="5" style="${W}"/>
    <path style="${S}" d="M150 200l16 52M180 274l16 60"/><circle cx="168" cy="256" r="6" style="${W}"/>
    <circle cx="128" cy="318" r="44" style="${W}"/><circle cx="128" cy="318" r="36" style="${S}"/><circle cx="128" cy="318" r="6" style="${F}"/>
    <path style="${S}" d="M128 282v72M92 318h72M103 293l50 50M153 293l-50 50"/>
    <circle cx="204" cy="352" r="12" style="${W}"/><circle cx="204" cy="352" r="3" style="${F}"/>
    <path style="${F}" d="M100 150c0-34 14-50 30-50s30 16 30 50c0 20-6 30-14 32h-32c-8-2-14-12-14-32z"/>
    <circle cx="130" cy="146" r="19" style="${W}"/>
    <circle cx="124" cy="146" r="2.2" fill="#111"/><circle cx="136" cy="146" r="2.2" fill="#111"/><path style="${S}" d="M125 154q5 4 10 0"/>
    <!-- speech: question / yes -->
    <path style="${W}" d="M150 58h74a12 12 0 0 1 12 12v30a12 12 0 0 1-12 12h-38l-16 14v-14h-20a12 12 0 0 1-12-12V70a12 12 0 0 1 12-12z"/>
    <path style="${S}" d="M178 76c0-6 4-10 10-10s10 4 10 9c0 7-10 7-10 15M188 100v1"/>
    <path style="${F}" d="M290 60h56a10 10 0 0 1 10 10v22a10 10 0 0 1-10 10h-30l-12 12v-12h-14a10 10 0 0 1-10-10V70a10 10 0 0 1 10-10z"/><path d="m308 82 8 8 16-16" style="fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round"/>
    <!-- sparkles -->
    <path style="${S}" d="M40 130v16M32 138h16M512 300v14M505 307h14M62 66v10M57 71h10M470 40v10M465 45h10"/>
    <circle cx="534" cy="110" r="4" style="${F}"/><circle cx="30" cy="280" r="3" style="${F}"/><circle cx="330" cy="30" r="3" style="${F}"/>
  </svg>`;

  /** Onboarding art: helper walking a dashed route to a pin, phone in hand (dark hero → white strokes) */
  const helper = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 240" role="img" aria-label="Helper walking to a place on the map">
    <g style="fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round">
      <path d="M30 212h300" style="stroke-dasharray:2 8;opacity:.6"/>
      <path d="M40 190c40-30 60-8 96-30s40-56 82-64" style="stroke-dasharray:6 9"/>
      <path d="M236 60c-14 0-25 11-25 25 0 19 25 42 25 42s25-23 25-42c0-14-11-25-25-25z" style="fill:#1b1b1b"/><circle cx="236" cy="85" r="8" style="fill:#fff"/>
      <ellipse cx="128" cy="214" rx="56" ry="5" style="fill:#333;stroke:none"/>
      <path d="M108 140h44l-4 60h-12l-6-36-6 36h-12z" style="fill:#1b1b1b"/>
      <path d="M100 200h22M130 200h24"/>
      <path d="M104 92c6-10 14-14 26-14s20 4 26 14l4 52h-60z" style="fill:#1b1b1b"/><path d="M122 80q8 10 16 0"/>
      <path d="M156 100l30 12M104 100l-10 34 18 6"/><rect x="106" y="126" width="18" height="30" rx="5" style="fill:#1b1b1b"/><path d="M112 148h6"/>
      <circle cx="186" cy="114" r="6" style="fill:#1b1b1b"/>
      <circle cx="130" cy="52" r="20" style="fill:#1b1b1b"/><path d="M110 50c0-18 9-26 20-26s20 8 20 26c-5-9-11-13-20-13s-15 4-20 13z" style="fill:#fff"/>
      <circle cx="124" cy="54" r="2" style="fill:#fff;stroke:none"/><circle cx="136" cy="54" r="2" style="fill:#fff;stroke:none"/><path d="M125 62q5 4 10 0"/>
      <path d="M282 150h44a8 8 0 0 1 8 8v20a8 8 0 0 1-8 8h-24l-10 10v-10h-10a8 8 0 0 1-8-8v-20a8 8 0 0 1 8-8z" style="fill:#fff"/><path d="m296 168 7 7 14-14" style="stroke:#1b1b1b"/>
      <path d="M44 60v12M38 66h12M300 40v10M295 45h10M60 120v8M56 124h8"/><circle cx="320" cy="90" r="3" style="fill:#fff;stroke:none"/>
    </g></svg>`;
  /** Onboarding art: wheelchair user asking with her phone; sparkles (light hero → black strokes) */
  const oku = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 240" role="img" aria-label="Wheelchair user asking a question">
    <g style="${S}">
      <path d="M30 214h300" style="stroke:#c9c9c9;stroke-dasharray:2 8"/>
      <ellipse cx="150" cy="214" rx="80" ry="5" style="${G}"/>
      <path style="${S}" d="M106 150 98 96h-14"/>
      <path style="${W}" d="M112 98c0-12 10-18 24-18s24 6 24 18l4 52h-56z"/><path style="${S}" d="M124 114h24"/>
      <path style="${W}" d="M154 150h30a8 8 0 0 1 8 8v48h-9v-46h-29z"/><rect x="172" y="200" width="28" height="11" rx="5.5" style="${W}"/>
      <rect x="98" y="150" width="90" height="11" rx="5" style="${W}"/>
      <path style="${S}" d="M160 104l18 34M186 160l12 44"/>
      <rect x="168" y="112" width="22" height="34" rx="5" style="${W}"/><path style="${S}" d="M175 138h8"/><circle cx="179" cy="124" r="3" style="${F}"/>
      <circle cx="134" cy="190" r="30" style="${W}"/><circle cx="134" cy="190" r="23" style="${S}"/><circle cx="134" cy="190" r="4.5" style="${F}"/>
      <path style="${S}" d="M134 167v46M111 190h46M118 174l32 32M150 174l-32 32"/>
      <circle cx="198" cy="206" r="9" style="${W}"/><circle cx="198" cy="206" r="2.5" style="${F}"/>
      <path style="${F}" d="M112 62c0-24 10-36 24-36s24 12 24 36c0 14-4 22-10 24h-28c-6-2-10-10-10-24z"/>
      <circle cx="136" cy="60" r="15" style="${W}"/><circle cx="131" cy="60" r="2" fill="#111"/><circle cx="141" cy="60" r="2" fill="#111"/><path style="${S}" d="M132 66q4 3 8 0"/>
      <path style="${W}" d="M214 34h100a12 12 0 0 1 12 12v36a12 12 0 0 1-12 12h-66l-18 16v-16h-16a12 12 0 0 1-12-12V46a12 12 0 0 1 12-12z"/>
      <path style="${S}" d="M234 56h60M234 70h38"/><circle cx="306" cy="70" r="3" style="${F}"/>
      <path d="M40 60v12M34 66h12M320 180v10M315 185h10M60 130v8M56 134h8"/><circle cx="300" cy="140" r="3" style="${F}"/>
    </g></svg>`;

  /** Permissions card: a phone with a location pin, a camera and a sound wave — friendly, line-art */
  const permissions = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 130" width="220" height="110" role="img" aria-hidden="true">
    <ellipse cx="130" cy="112" rx="96" ry="12" style="${G}"/>
    <rect x="96" y="14" width="68" height="104" rx="12" style="${W}"/><path style="${S}" d="M118 24h24M130 106v.5"/>
    <path style="${W}" d="M130 44c-9 0-16 7-16 16 0 12 16 26 16 26s16-14 16-26c0-9-7-16-16-16z"/><circle cx="130" cy="60" r="5" style="${F}"/>
    <rect x="22" y="52" width="46" height="34" rx="8" style="${W}"/><circle cx="45" cy="69" r="9" style="${S}"/><circle cx="45" cy="69" r="3.5" style="${F}"/><path style="${S}" d="M32 52l5-8h16l5 8"/>
    <path style="${S}" d="M196 56v22M208 48v38M220 58v18M232 64v6M184 62v10"/>
    <path style="${S}" d="M60 30l4-4M74 22l1-6M46 24l-2-6M212 26l4-4M226 32l6-1"/>
  </svg>`;
  // ---- drop-in real illustrations -------------------------------------------------------------
  // If the designer drops PNG/SVG files into public/assets/illustrations/<slot>.png the app uses them
  // instead of the built-in line-art. /api/wardrobe/catalogue → illustrations lists what exists.
  const builtin = { hero, helper, oku, permissions };
  let FILES = {};
  function setFiles(map) { FILES = map || {}; }
  function has(slot) { return !!FILES[slot]; }
  function img(slot, alt = '', style = '') { return `<img src="${FILES[slot]}" alt="${alt}" class="illu illu-${slot}" style="max-width:100%;height:auto;display:block;${style}" draggable="false">`; }
  /** Generic accessor: ART.get('hero') → real PNG when present, else the built-in SVG (or '' for unknown slots). */
  function get(slot, ...args) { if (FILES[slot]) return img(slot); const fn = builtin[slot]; return fn ? fn(...args) : ''; }
  const wrap = (fn, slot) => (...args) => (FILES[slot] ? img(slot) : fn(...args));
  return { hero: wrap(hero, 'hero'), helper: wrap(helper, 'helper'), oku: wrap(oku, 'oku'), permissions: wrap(permissions, 'permissions'), get, has, setFiles, SLOTS: ['hero', 'helper', 'oku', 'permissions', 'empty_requests', 'empty_map', 'empty_feed', 'reward', 'levelup', 'welcome', 'cat_idle', 'cat_listen', 'cat_talk', 'cat_happy', 'cat_sleep'] };
})();
