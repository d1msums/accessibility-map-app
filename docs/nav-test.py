"""Browser smoke test for the v4 features (Google map, permissions, assistant, navigation, camera → AI).
Run: python3 docs/nav-test.py  (server on :3000, playwright + chromium installed)"""
import asyncio, json, os, sys, time
from playwright.async_api import async_playwright

BASE = os.environ.get('KB_BASE', 'http://localhost:3000')
SHOTS = os.path.join(os.path.dirname(__file__), 'shots')
os.makedirs(SHOTS, exist_ok=True)
CYBER = {'latitude': 2.9213, 'longitude': 101.6559, 'accuracy': 20}

async def main():
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
        ctx = await browser.new_context(viewport={'width': 412, 'height': 880}, device_scale_factor=2, is_mobile=True, has_touch=True,
                                        geolocation=CYBER, permissions=['geolocation', 'camera', 'microphone'], locale='en-MY')
        page = await ctx.new_page()
        page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        page.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
        await page.goto(BASE + '/', wait_until='networkidle')
        # login as helper Ahmad (demo account chip on the landing page)
        await page.wait_for_selector('#auth:not(.hidden)')
        await page.click('.acct[data-email="ahmad@demo.my"]')
        await page.wait_for_selector('#app:not(.hidden)')
        await page.wait_for_selector('.hero', timeout=8000)
        # permissions modal
        try:
            await page.wait_for_selector('#permAllow', timeout=5000)
            await page.screenshot(path=f'{SHOTS}/v4-perms.png')
            await page.click('#permAllow')
            await page.wait_for_timeout(1500)
            perms = await page.evaluate("localStorage.getItem('kb.perms')")
            print('perms after allow:', perms)
        except Exception as e:
            errors.append(f'perm modal: {e}')
        # dock present?
        print('micFab visible:', await page.is_visible('#micFab'))
        # map
        await page.click('.nav[data-route="map"]:visible')
        await page.wait_for_timeout(6000)
        eng = await page.inner_text('#mapEngine')
        gm = await page.evaluate("!!(window.google && google.maps && google.maps.Map)")
        print('map engine label:', eng, '| google loaded:', gm)
        pins = await page.evaluate("document.querySelectorAll('.pin').length")
        print('pins:', pins)
        await page.screenshot(path=f'{SHOTS}/v4-map.png')
        # places around me
        await page.click('#fabPlaces')
        await page.wait_for_timeout(9000)
        places = await page.evaluate("document.querySelectorAll('.place-pin').length")
        items = await page.evaluate("document.querySelectorAll('.list-item.place').length")
        print('place pins:', places, 'list items:', items)
        await page.screenshot(path=f'{SHOTS}/v4-places.png')
        # assistant: text ask
        await page.click('#micFab')
        await page.wait_for_selector('#assistPanel', timeout=3000)
        await page.fill('#asInput', 'Take me to DPulze')
        await page.click('#asSend')
        for _ in range(40):
            await page.wait_for_timeout(1000)
            if await page.is_visible('#navBanner'): break
        log = await page.inner_text('#asLog')
        print('assistant log:', log[:400].replace('\n', ' | '))
        await page.screenshot(path=f'{SHOTS}/v4-assistant.png')
        nav_visible = await page.is_visible('#navBanner')
        print('nav banner after assistant:', nav_visible)
        if nav_visible:
            print('nav text:', await page.inner_text('#nbText'), '|', await page.inner_text('#nbDist'))
            await page.screenshot(path=f'{SHOTS}/v4-nav.png')
            await page.click('#nbSteps')
            await page.wait_for_selector('.steps-list', timeout=3000)
            n = await page.evaluate("document.querySelectorAll('.steps-list li').length")
            print('steps listed:', n)
            await page.screenshot(path=f'{SHOTS}/v4-steps.png')
            await page.click('#modalClose', timeout=3000)
            await page.wait_for_timeout(500)
            await page.click('#nbStop')
            await page.wait_for_timeout(800)
        # request flow: open a Cyberjaya request → take me there → camera
        await page.click('.nav[data-route="requests"]:visible')
        await page.wait_for_selector('.req[data-req="q_dpulze_lift"]', timeout=8000)
        await page.click('.req[data-req="q_dpulze_lift"]')
        await page.wait_for_selector('#btnGo', timeout=5000)
        await page.screenshot(path=f'{SHOTS}/v4-request.png')
        await page.click('#btnGo')
        for _ in range(20):
            await page.wait_for_timeout(1000)
            if await page.is_visible('#navBanner'): break
        print('nav banner after request:', await page.is_visible('#navBanner'), page.url)
        await page.screenshot(path=f'{SHOTS}/v4-nav-request.png')
        # simulate arrival
        sim = await page.is_visible('#nbSim')
        print('sim button:', sim)
        # camera via request detail
        await page.click('#nbStop')
        await page.wait_for_timeout(600)
        await page.click('.nav[data-route="requests"]:visible')
        await page.wait_for_selector('.req[data-req="q_dpulze_lift"]', timeout=8000)
        await page.click('.req[data-req="q_dpulze_lift"]')
        await page.wait_for_selector('#btnCam', timeout=5000)
        await page.click('#btnCam')
        await page.wait_for_selector('#camShutter', timeout=5000)
        await page.wait_for_timeout(2500)
        await page.screenshot(path=f'{SHOTS}/v4-camera.png')
        # feed a real seed photo through the file input (fake camera is a test pattern)
        await page.set_input_files('#camFile', os.path.join(os.path.dirname(__file__), '..', 'public', 'seed-photos', 'lift-working.jpg'))
        await page.wait_for_selector('.ai-card, .err', timeout=45000)
        await page.wait_for_timeout(800)
        await page.screenshot(path=f'{SHOTS}/v4-ai.png')
        card = await page.evaluate("(document.querySelector('.ai-card')||document.querySelector('.err')||{}).innerText")
        print('AI card:', (card or '')[:500].replace('\n', ' | '))
        if await page.is_visible('#aiAnswer'):
            await page.click('#aiAnswer')
            await page.wait_for_selector('#mSend', timeout=5000)
            await page.screenshot(path=f'{SHOTS}/v4-answer-prefilled.png')
            v = await page.evaluate("(document.querySelector('.verdicts button.on')||{}).dataset?.v")
            note = await page.input_value('#aNote')
            print('prefilled verdict:', v, '| note:', note[:120])
            await page.click('#mSend')
            await page.wait_for_selector('.reward .pts', timeout=8000)
            print('reward:', await page.inner_text('.reward .pts'))
            await page.screenshot(path=f'{SHOTS}/v4-reward.png')
        await browser.close()
    print('\nERRORS:' if errors else '\nno page errors')
    for e in errors[:30]: print(' ', e[:300])

asyncio.run(main())
