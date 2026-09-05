import asyncio, sys
from playwright.async_api import async_playwright
BASE='http://localhost:3000'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
        ctx = await b.new_context(viewport={'width':1280,'height':860}, geolocation={'latitude':2.9213,'longitude':101.6559}, permissions=['geolocation'])
        pg = await ctx.new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append('console.'+m.type+': '+m.text) if m.type=='error' else None)
        await pg.goto(BASE); await pg.wait_for_selector('.acct[data-email]')
        await pg.click('.acct[data-email="ahmad@demo.my"]')
        try: await pg.click('#permLater', timeout=4000)
        except Exception: pass
        await pg.wait_for_selector('#coinPill:not(.hidden)')
        print('coin pill:', await pg.inner_text('#coinValue'))
        await pg.click('.nav[data-route=shop]:visible'); await pg.wait_for_selector('#shopGrid .shop-item')
        n = await pg.locator('#shopGrid .shop-item').count(); print('outfit tiles:', n)
        await pg.screenshot(path='docs/shot-shop-1.png')
        # buy hoodie
        await pg.click('#shopGrid .shop-item[data-id=outfit_hoodie]'); await pg.wait_for_selector('#buyYes'); await pg.click('#buyYes')
        await pg.wait_for_timeout(900)
        print('after buy coins:', await pg.inner_text('#shopCoins'), '| tile class:', await pg.get_attribute('#shopGrid .shop-item[data-id=outfit_hoodie]','class'))
        # pets tab, glasses tab
        await pg.click('#shopTabs button[data-tab=pet]'); await pg.wait_for_timeout(200)
        print('pet tiles:', await pg.locator('#shopGrid .shop-item').count())
        await pg.click('#shopTabs button[data-tab=frame]'); await pg.wait_for_timeout(200)
        print('frame gold locked:', await pg.get_attribute('#shopGrid .shop-item[data-id=frame_gold]','class'))
        await pg.screenshot(path='docs/shot-shop-2.png')
        # voice/text command through assistant: buy the coffee
        await pg.click('#micFab'); await pg.wait_for_selector('#asInput')
        await pg.fill('#asInput', 'open the shop'); await pg.click('#asSend'); await pg.wait_for_timeout(1500)
        print('hash after "open the shop":', await pg.evaluate('location.hash'))
        # mobile check
        await pg.set_viewport_size({'width':390,'height':800}); await pg.wait_for_timeout(300)
        await pg.click('.nav[data-route=shop]:visible'); await pg.wait_for_selector('#shopGrid .shop-item'); await pg.screenshot(path='docs/shot-shop-m.png')
        # profile avatar shows updated look
        await pg.click('.nav[data-route=profile]:visible'); await pg.wait_for_selector('.ring-wrap')
        print('errors:', errs[:5] if errs else 'none')
        await b.close()
asyncio.run(main())
