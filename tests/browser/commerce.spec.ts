import {test,expect} from '@playwright/test';
test('persisted four-role commerce, keyboard access, errors and responsive layouts',async({page})=>{
 const account=page.locator('button.account');
 async function signIn(role:string){
  await account.click();const button=page.getByRole('button',{name:(role==='student2'?'Student 02':role)+' ↗',exact:true});
  const responsePromise=page.waitForResponse(r=>r.url().endsWith('/v1/auth/dev')&&r.request().method()==='POST');await button.click();const response=await responsePromise;
  if(response.status()===429){
   await expect(page.getByRole('status')).toContainText('Rate limit exceeded');
   const retryAfter=Number(response.headers()['retry-after']);expect(retryAfter).toBeGreaterThan(0);expect(retryAfter).toBeLessThanOrEqual(60);
   // Honor the server's explicit throttle deadline; do not bypass application limits.
   await page.waitForTimeout(retryAfter*1000);await button.click();
  }
  await expect(page.locator('.login-panel')).toHaveCount(0);
 }
 async function activity(){await page.getByRole('button',{name:'My activity',exact:true}).click();}
 async function operations(){await page.getByRole('button',{name:'Operations',exact:true}).click();}
 async function screenshot(name:string){await page.screenshot({path:'artifacts/'+name+'.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();}
 await page.goto('/');await expect(page.getByRole('heading',{name:/NOT JUST/})).toBeVisible();
 await expect(page.locator('.runtime')).toContainText('LOCAL PAYMENT SIMULATOR');await screenshot('desktop-discovery');
 await page.setViewportSize({width:390,height:844});await screenshot('mobile-discovery');
 const view=page.getByRole('button',{name:'View The Collective Hoodie',exact:true});
 await view.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toBeVisible();
 await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement?.closest('dialog'))).toBeTruthy();
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();await expect(view).toBeFocused();
 await signIn('student');await view.click();await page.getByLabel('Colour & size').selectOption('north-hoodie-Forest-M');await page.getByLabel('Quantity',{exact:true}).fill('2');
 await page.getByRole('button',{name:'Pledge for free'}).click();await expect(page.getByRole('status')).toContainText('No payment taken');
 await page.reload();await activity();await expect(page.locator('.activity-row')).toContainText('2 unit(s)');await screenshot('mobile-pledge');
 await signIn('curator');await operations();await page.locator('.activity-row').filter({hasText:'The Collective Hoodie'}).getByRole('button',{name:'Close pledges & evaluate'}).click();await expect(page.getByRole('status')).toContainText('Campaign locked');
 await signIn('admin');await operations();await page.getByRole('button',{name:'Approve paid production'}).click();await expect(page.getByRole('status')).toContainText('Paid demand is below');await screenshot('mobile-unpaid-error');
 await signIn('student');await activity();await page.getByRole('button',{name:'Confirm purchase'}).click();await page.getByRole('button',{name:/Pay 50%/}).click();await expect(page.getByRole('status')).toContainText('No money moved');
 await signIn('admin');await operations();await page.getByRole('button',{name:'Approve paid production'}).click();await expect(page.getByRole('status')).toContainText('Production approved');
 await signIn('host');await operations();await expect(page.getByLabel('Healthy')).toHaveValue('2');await page.getByRole('button',{name:'Confirm receipt'}).click();await expect(page.getByRole('status')).toContainText('Receipt saved');await screenshot('mobile-receipt');
 await signIn('student');await activity();await page.getByRole('button',{name:/Pay balance/}).click();await page.getByRole('button',{name:'Get pickup pass'}).click();const pass=page.getByLabel('Pass for the local host test');await expect(pass).toBeVisible();const token=await pass.inputValue();await screenshot('mobile-pickup-pass');
 await signIn('student2');await activity();await expect(page.locator('.pickup-pass')).toHaveCount(0);await expect(page.locator('.activity-row')).toHaveCount(0);
 await signIn('host');await operations();await page.getByLabel('Single-use pickup pass',{exact:true}).fill(token);await page.getByRole('button',{name:'Verify & confirm physical handover'}).click();await expect(page.getByRole('status')).toContainText('Stock dispatched exactly once');
 await page.getByLabel('Single-use pickup pass',{exact:true}).fill(token);await page.getByRole('button',{name:'Verify & confirm physical handover'}).click();await expect(page.getByRole('status')).toContainText('already used');await screenshot('mobile-replay-error');
 const row=page.getByRole('row').filter({hasText:'north-hoodie-Forest-M'});await expect(row.getByRole('cell')).toHaveText(['north-hoodie-Forest-M','0','0','0']);
 await page.setViewportSize({width:1440,height:1000});await screenshot('desktop-host');await signIn('student');await activity();await expect(page.locator('.pill').filter({hasText:'COLLECTED'})).toBeVisible();await screenshot('desktop-collected');
});

test('a delayed previous-account response cannot repopulate private activity',async({page})=>{
 await page.goto('/');await page.locator('button.account').click();await page.getByRole('button',{name:'student ↗',exact:true}).click();await expect(page.locator('.login-panel')).toHaveCount(0);
 let release!:()=>void,started!:()=>void;const waiting=new Promise<void>(r=>{release=r}),captured=new Promise<void>(r=>{started=r});let intercepted=false;
 await page.route('**/v1/activity',async route=>{
  if(intercepted){await route.continue();return;}intercepted=true;const response=await route.fetch();started();await waiting;await route.fulfill({response});
 });
 await page.reload();await captured;await page.locator('button.account').click();await page.getByRole('button',{name:'Student 02 ↗',exact:true}).click();await expect(page.locator('.login-panel')).toHaveCount(0);await page.getByRole('button',{name:'My activity',exact:true}).click();
 const completed=page.waitForResponse(r=>r.url().endsWith('/v1/activity'));release();await completed;
 await expect(page.locator('.activity-row')).toHaveCount(0);await expect(page.locator('.pickup-pass')).toHaveCount(0);await expect(page.getByText('No pledges yet. Your first collective starts in Discover.')).toBeVisible();
});
