"""Visual + behavioural check for the manifest-driven UI and <AvatarBuilder />.
Run:  python3 docs/peeps-test.py   (needs playwright chromium; server on :3000)
"""
import json, sys, os, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://localhost:3000')
OUT = '/tmp/illu'; os.makedirs(OUT, exist_ok=True)
ok = fail = 0
def check(name, cond, extra=''):
    global ok, fail
    ok += cond; fail += (not cond)
    print(('PASS ' if cond else 'FAIL ') + name + (f'  ({extra})' if extra else ''))

def dismiss_perms(page):
    try:
        page.wait_for_selector('#permLater', timeout=4000); page.click('#permLater'); page.wait_for_timeout(300)
    except Exception:
        pass

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}, geolocation={'latitude': 2.9213, 'longitude': 101.6559}, permissions=['geolocation'])
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'favicon' not in m.text else None)

    # ---- 1. landing: hero + feature cards from the manifest ----
    page.goto(BASE + '/'); page.wait_for_selector('#landGo'); page.wait_for_timeout(1200)
    n_ui = page.locator('.ui-svg').count()
    check('landing renders manifest illustrations', n_ui >= 10, f'{n_ui} .ui-svg')
    check('hero uses looking-ahead', page.locator('.land-art .hero-main[src*="Looking"]').count() == 1)
    check('feature cards present', page.locator('.feat').count() == 6)
    floating = page.evaluate("getComputedStyle(document.querySelector('.ui-svg.float')).animationName")
    check('float animation applied', floating == 'kb-float', floating)
    broken = page.evaluate("[...document.querySelectorAll('img.ui-svg')].filter(i => !i.complete || i.naturalWidth === 0).length")
    check('all illustrations loaded', broken == 0, f'{broken} broken')
    page.mouse.move(200, 200); page.mouse.move(900, 500); page.wait_for_timeout(300)
    px = page.evaluate("document.querySelector('.land-art .ui-svg').style.getPropertyValue('--px')")
    check('mouse parallax reacts', px not in ('', None), px)
    page.screenshot(path=f'{OUT}/s1-landing.png', full_page=True)

    # narrow viewport alignment
    page.set_viewport_size({'width': 390, 'height': 800}); page.wait_for_timeout(400)
    overflow = page.evaluate("Math.max(0, document.documentElement.scrollWidth - innerWidth)")
    check('no horizontal overflow on mobile', overflow <= 1, f'{overflow}px')
    page.screenshot(path=f'{OUT}/s1b-landing-mobile.png', full_page=True)
    page.set_viewport_size({'width': 1280, 'height': 900})

    # ---- 2. signup → AvatarBuilder ----
    page.click('#pickHelper'); page.click('#landGo'); page.wait_for_selector('#suForm')
    stamp = int(time.time())
    page.fill('#sName', 'Peep Tester'); page.fill('#sEmail', f'peep{stamp}@demo.my'); page.fill('#sPass', 'demo1234'); page.fill('#sArea', 'Cyberjaya')
    page.click('#suForm button[type=submit]'); page.wait_for_selector('#create'); page.wait_for_selector('.ab .ab-tile')
    check('AvatarBuilder mounted in signup', page.locator('.ab').count() == 1)
    layers = page.evaluate("[...document.querySelectorAll('.ab-canvas .peep .pl')].map(e => [...e.classList].find(c => c.startsWith('pl-')).slice(3))")
    # head carries the skin fill, so the face must be ABOVE it: body → head → face → facial-hair → accessories
    check('layers stacked body→head→face→(beard)→accessories', layers[:3] == ['body', 'head', 'face'] and layers.index('face') > layers.index('head'), str(layers))
    absolute = page.evaluate("[...document.querySelectorAll('.ab-canvas .peep .pl')].every(e => getComputedStyle(e).position === 'absolute')")
    check('layers absolutely positioned', absolute)
    # gender logic
    page.click('.ab-gender button:text-is("Male")'); page.wait_for_timeout(200)
    check('male: beard tab visible', page.locator('.ab-tabs button:has-text("Beard")').count() == 1)
    page.click('.ab-tabs button:has-text("Head")'); page.wait_for_timeout(200)
    male_heads = page.evaluate("[...document.querySelectorAll('.ab-grid .ab-tile[data-id]')].map(b => b.dataset.id)")
    check('male heads exclude long hair', all('/long' not in h and 'hijab' not in h for h in male_heads) and any('short' in h for h in male_heads), f'{len(male_heads)} heads')
    page.click('.ab-gender button:text-is("Female")'); page.wait_for_timeout(200)
    check('female: beard tab hidden', page.locator('.ab-tabs button:has-text("Beard")').count() == 0)
    female_heads = page.evaluate("[...document.querySelectorAll('.ab-grid .ab-tile[data-id]')].map(b => b.dataset.id)")
    check('female heads include long styles', any('long' in h for h in female_heads) and 'head/pomp' not in female_heads, f'{len(female_heads)} heads')
    # locks (new user = level 1)
    locked = page.locator('.ab-grid .ab-tile.locked').count()
    check('locked high-tier hats at level 1', locked >= 3, f'{locked} locked')
    before = page.evaluate("JSON.parse(localStorage.getItem('kb.peep')).head")
    page.click('.ab-grid .ab-tile.locked >> nth=0'); page.wait_for_timeout(200)
    after = page.evaluate("JSON.parse(localStorage.getItem('kb.peep')).head")
    check('locked tile does not equip + shows toast', before == after and page.locator('.ab-toast').count() == 1)
    # pick an unlocked head + accessory and check persistence
    page.click('.ab-grid .ab-tile:not(.locked)[data-id="head/long-hair"]'); page.wait_for_timeout(150)
    page.click('.ab-tabs button:has-text("Glasses")'); page.wait_for_timeout(150)
    page.click('.ab-grid .ab-tile:not(.locked)[data-id="accessories/glasses"]'); page.wait_for_timeout(300)
    saved = page.evaluate("JSON.parse(localStorage.getItem('kb.peep'))")
    check('selection persisted to localStorage', saved.get('head') == 'head/long-hair' and saved.get('accessory') == 'accessories/glasses', json.dumps({k: saved.get(k) for k in ('head', 'accessory', 'gender')}))
    page.screenshot(path=f'{OUT}/s2-builder.png', full_page=True)
    page.click('#create'); page.wait_for_selector('#meAvatar .peep', timeout=15000)
    page.wait_for_timeout(600)
    if page.locator('#mOk').count(): page.click('#mOk')
    dismiss_perms(page)

    # ---- 3. navbar / leaderboard / profile show the combination ----
    nav_head = page.evaluate("document.querySelector('#meAvatar .peep .pl-head, #meAvatar .peep svg.pl-head')?.dataset.id || [...document.querySelectorAll('#meAvatar .peep [data-id]')].map(e=>e.dataset.id).join(',')")
    check('navbar avatar shows chosen head', 'head/long-hair' in (nav_head or ''), nav_head)
    page.click('.nav[data-route="community"]:visible'); page.wait_for_selector('.lb', timeout=10000); page.wait_for_timeout(500)
    lb_peeps = page.locator('.lb .peep, .lb-top .peep, .peep-av').count()
    check('leaderboard rows render peeps', lb_peeps >= 1, f'{lb_peeps}')
    page.screenshot(path=f'{OUT}/s3-leaderboard.png', full_page=True)
    page.click('.nav[data-route="profile"]:visible'); page.wait_for_selector('#editStyle'); page.wait_for_timeout(600)
    check('profile character card', page.locator('.char-card .peep').count() == 1)
    page.screenshot(path=f'{OUT}/s4-profile.png', full_page=True)
    page.click('#editStyle'); page.wait_for_selector('#builderHost .ab .ab-tile')
    page.click('#builderHost .ab-tabs button:has-text("Face")'); page.wait_for_timeout(150)
    page.click('#builderHost .ab-grid .ab-tile:not(.locked)[data-id="face/cute"]'); page.wait_for_timeout(150)
    page.screenshot(path=f'{OUT}/s5-profile-edit.png')
    page.click('#mSave'); page.wait_for_timeout(1200)
    me = page.evaluate("fetch('/api/me',{headers:{authorization:'Bearer '+localStorage.getItem('kb.token')}}).then(r=>r.json())")
    check('profile save → server peep', me.get('peep', {}).get('face') == 'face/cute' and me['peep'].get('head') == 'head/long-hair', json.dumps(me.get('peep')))
    # reload: state restored from server + localStorage
    page.reload(); page.wait_for_selector('#meAvatar .peep', timeout=15000); page.wait_for_timeout(500)
    check('survives reload', 'head/long-hair' in page.evaluate("[...document.querySelectorAll('#meAvatar .peep [data-id]')].map(e=>e.dataset.id).join(',')"))

    # ---- 4. level-gated: Raj (Lv5) sees fewer locks ----
    page.evaluate("localStorage.removeItem('kb.token')"); page.goto(BASE + '/'); page.wait_for_selector('.acct')
    page.click('.acct[data-email="raj@demo.my"]'); page.wait_for_selector('#meAvatar', timeout=15000); page.wait_for_timeout(500)
    dismiss_perms(page)
    page.click('.nav[data-route="profile"]:visible'); page.wait_for_selector('#editStyle'); page.click('#editStyle'); page.wait_for_selector('#builderHost .ab .ab-tile')
    page.click('#builderHost .ab-tabs button:has-text("Head")'); page.wait_for_timeout(200)
    raj_locked = page.locator('#builderHost .ab-grid .ab-tile.locked').count()
    check('level 5 user has everything unlocked', raj_locked == 0, f'{raj_locked} locked')
    page.screenshot(path=f'{OUT}/s6-raj-builder.png')

    real_errors = [e for e in errors if 'PERMISSION_DENIED' not in e and 'google' not in e.lower() and 'geocod' not in e.lower() and 'places' not in e.lower() and '429' not in e and '503' not in e]
    check('no JS errors', not real_errors, '; '.join(real_errors[:3]))
    b.close()
print(f'\n{ok} passed, {fail} failed')
sys.exit(1 if fail else 0)
