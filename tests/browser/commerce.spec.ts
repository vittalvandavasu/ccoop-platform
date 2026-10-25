import {test,expect} from '@playwright/test';
test('editorial discovery, persisted pledge, and mobile layout',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{name:/NOT JUST/})).toBeVisible();
 await page.getByRole('button',{name:'Sign in',exact:false}).first().click();await page.getByRole('button',{name:'student ↗',exact:true}).click();
 await page.getByRole('button',{name:'View drop',exact:false}).first().click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Pledge for free'}).click();await expect(page.getByText('You’re part of this drop. No payment taken.')).toBeVisible();await page.reload();await page.getByRole('button',{name:'My activity'}).click();await expect(page.getByRole('heading',{name:'The Collective Hoodie'}).first()).toBeVisible();
 await page.screenshot({path:'artifacts/desktop-activity.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Discover',exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();await page.screenshot({path:'artifacts/mobile-discovery.png',fullPage:true});
});
