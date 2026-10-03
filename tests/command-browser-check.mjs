import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(pathToFileURL(process.argv[2]).href);
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
await mkdir('review',{recursive:true});
try{
  const page=await browser.newPage({viewport:{width:1366,height:768}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5182/');await page.locator('.leaflet-container').waitFor();
  assert.equal(await page.locator('.command-summary strong').allTextContents().then(v=>v.join(',')),'3,2,1,4');
  assert.equal(await page.locator('.environment-collapsible').getAttribute('open'),null);assert.ok(await page.locator('.environment-summary-values').innerText().then(t=>t.includes('25.6')&&t.includes('81')&&t.toLowerCase().includes('stale')));
  const map=await page.locator('.incident-map-frame').boundingBox(),attention=await page.locator('.real-priority .incident-item').first().boundingBox();
  assert.ok(map.height>=380&&map.height<=440,'dashboard map height');assert.ok(map.y<600&&attention.y+attention.height<768,'map + one attention item above fold');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'laptop overflow');
  assert.ok(await page.locator('.avatar').innerText().then(t=>t==='AN'));assert.equal(await page.locator('.notification-dot').count(),0);
  assert.ok(!await page.locator('main').innerText().then(t=>t.includes('76.7%')));
  await page.waitForTimeout(800);await page.screenshot({path:'review/command-center-laptop.png',fullPage:true});
  await page.locator('.map-filter-controls select').first().selectOption('flood');assert.equal(await page.locator('.leaflet-marker-icon').count(),1);await page.locator('.map-filter-controls select').nth(1).selectOption('resolved');assert.equal(await page.locator('.leaflet-marker-icon').count(),0);await page.locator('.map-filter-controls select').first().selectOption('all');await page.locator('.map-filter-controls select').nth(1).selectOption('all');assert.equal(await page.locator('.leaflet-marker-icon').count(),3);assert.ok(await page.locator('.leaflet-control-attribution').innerText().then(t=>t.includes('OpenStreetMap')));
  await page.locator('.environment-collapsible>summary').click();await page.locator('.environment-card').first().waitFor({state:'visible'});assert.ok(await page.locator('.environment-grid').innerText().then(t=>t.includes('Feels like')&&t.includes('PM2.5')&&t.includes('partial coverage')));await page.locator('.environment-collapsible>summary').click();
  await page.locator('.real-priority .text-button').first().click();await page.locator('.command-inspector').waitFor();assert.equal(await page.locator('.incident-detail').count(),0);assert.ok(await page.locator('.command-inspector').innerText().then(t=>t.includes('Mark Acknowledged')));await page.screenshot({path:'review/command-center-inspector.png',fullPage:true});
  await page.locator('.command-inspector .primary').click();await page.getByRole('button',{name:'Assign to my Operations profile',exact:true}).waitFor();
  await page.getByRole('button',{name:'View full details',exact:true}).click();await page.locator('.incident-detail').waitFor();assert.equal(await page.locator('.incident-detail .evidence-viewer').count(),1);assert.ok(await page.locator('.incident-detail').innerText().then(t=>t.includes('Assign to my Operations profile')));
  await page.getByRole('button',{name:'Close detail',exact:true}).click();
  let providerRequests=0;page.on('request',r=>{if(r.url().includes('/functions/v1'))providerRequests++;});await page.getByRole('button',{name:'Open Nigraan AI →',exact:true}).click();await page.locator('.nigraan-ai').waitFor();assert.equal(providerRequests,0,'AI navigation must not generate');
  await page.locator('.nav-menu').getByRole('button',{name:'Command Center',exact:false}).click();await page.locator('.leaflet-container').waitFor();
  await page.locator('.nav-menu').getByRole('button',{name:'Live Map',exact:false}).click();assert.ok((await page.locator('.incident-map-frame').boundingBox()).height>=440);await page.locator('.nav-menu').getByRole('button',{name:'Command Center',exact:false}).click();
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px Operations overflow');await page.screenshot({path:'review/command-center-mobile.png',fullPage:true});
  await page.goto('http://127.0.0.1:5182/?citizen');await page.locator('.citizen-actions').getByRole('button',{name:'Report an incident',exact:false}).click();await page.locator('.submission-readiness').waitFor();assert.ok(await page.getByRole('button',{name:'Submit incident →',exact:true}).isDisabled());assert.ok(await page.locator('.submission-help').innerText().then(t=>t.includes('GPS and a photo')));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px Citizen overflow');await page.screenshot({path:'review/citizen-form-mobile-polish.png',fullPage:true});
  assert.deepEqual(errors,[],'browser runtime errors');console.log('Browser passed: 1366x768 map '+JSON.stringify(map)+', attention '+JSON.stringify(attention)+'; collapsed/expanded conditions, inspector workflow/full evidence, AI navigation without request, 390px Operations/Citizen no overflow, submission readiness.');
}finally{await browser.close();}



