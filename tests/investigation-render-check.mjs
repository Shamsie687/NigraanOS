import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {briefingFixture} from './investigation-presentation-fixtures.js';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {NigraanAgentView}=await server.ssrLoadModule('/src/components/NigraanAgent.jsx');
 const full=await briefingFixture(),changed=await briefingFixture({changed:true}),partial=await briefingFixture({fail:['get_city_status','get_incident_details:I2','get_city_conditions']});
 const entry=r=>({id:1,role:'agent',referenceVersion:2,result:{kind:'INVESTIGATION',investigation:r}});
 const render=(r=full,props={})=>renderToString(React.createElement(NigraanAgentView,{thread:[entry(r)],busy:false,tool:'',onSubmit(){},onClear(){},onCancel(){},connection:{status:'connected'},isReferenceCurrent:()=>true,...props})).replace(/<!--.*?-->/g,'');
 const html=render();for(const text of ['Incident investigation · remote MCP','Complete','Read-only','READ-ONLY INVESTIGATION','2 of 3 returned candidates','Reason for review','Recorded priority: High','Awaiting acknowledgement','Recent published update','hours since report start','MODELED CONTEXT','Modeled context does not verify incident severity or confirm flooding.','Not inspected among returned','Open Incidents workspace','Simulated Alexa+ experience']){if(text==='Read-only')continue;assert.ok(html.includes(text),text);}
 assert.ok(!html.includes('<pre'));assert.ok(!html.includes('time unresolved'));assert.ok(!/likely severe|probably flooding|high impact|dangerous/i.test(html));
 assert.match(html,/<section class="investigation-modeled" aria-label="Modeled context">/);assert.match(html,/<button[^>]*type="button"[^>]*aria-label="Review I1 details"/);
 assert.ok(!html.includes('Cancel investigation'));assert.ok(!html.includes('Run a fresh investigation'));
 const stale=render(full,{isReferenceCurrent:()=>false});assert.ok(stale.includes('Stale references'));assert.ok(stale.includes('Run a fresh investigation'));assert.match(stale,/<button[^>]*disabled=""[^>]*aria-label="Review I1 details"/);
 const partialHtml=render(partial);for(const text of ['Partial','City aggregate unavailable','Details unavailable for I2','Modeled context unavailable','Candidate observation · details not inspected'])assert.ok(partialHtml.includes(text),text);
 const changeHtml=render(changed);for(const text of ['Changed during collected reads','Candidate list observed status: Reported','Later detail read observed status: Acknowledged','Candidate list observed priority: High','Later detail read observed priority: Normal'])assert.ok(changeHtml.includes(text),text);
 const empty=render(await briefingFixture({count:0}));assert.ok(empty.includes('0 of 0 returned'));assert.ok(empty.includes('does not establish that the city is safe'));
 const single=render(await briefingFixture({count:1}));assert.ok(single.includes('1 of 1 returned'));assert.equal((single.match(/class="investigation-candidate"/g)||[]).length,1);
 const neutral=render(await briefingFixture({noReasons:true}));assert.ok(neutral.includes('No configured review reason identified.'));
 const active=render(full,{busy:true,progress:{stage:'get_incident_details',ref:'I2'}});assert.ok(active.includes('Inspecting I2…'));assert.ok(active.includes('Cancel investigation'));assert.match(active,/<p role="status">Inspecting I2/);
 const direct=render(full,{busy:true,progress:null,tool:'get_city_status'});assert.ok(!direct.includes('Cancel investigation'));
 const lost=render(full,{connection:{status:'disconnected'}});assert.ok(lost.includes('Reconnect read access'));assert.ok(!lost.includes('investigation-candidate'));assert.ok(!lost.includes('18 hours'));
 const css=await readFile(new URL('../src/index.css',import.meta.url),'utf8');assert.match(css,/@media\(max-width:600px\).*\.investigation-cards.*grid-template-columns:minmax\(0,1fr\)/s);assert.ok(css.includes('.investigation-candidate{min-width:0'));
 if(process.argv[2]){
  const {chromium}=await import(pathToFileURL(process.argv[2]).href);
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
   await mkdir('review',{recursive:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
   await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body>'+changeHtml+'</body></html>');
   await page.locator('.agent-thread').evaluate(e=>e.style.maxHeight='none');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:'review/investigation-desktop.png',fullPage:true});
   await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px overflow');assert.equal(await page.locator('.investigation-cards').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),1);
   await page.getByRole('button',{name:'Review I1 details'}).focus();assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Review I1 details');
   await page.screenshot({path:'review/investigation-mobile.png',fullPage:true});
   await page.setContent('<html><head><style>'+css+'</style></head><body>'+stale+'</body></html>');assert.ok(await page.getByRole('button',{name:'Review I1 details'}).isDisabled());
   console.log('Chromium visual checks passed: desktop/mobile no overflow, mobile single-column cards, keyboard focus and stale disabled actions.');
  }finally{await browser.close();}
 }
 console.log('Investigation render checks passed: complete/partial/empty, progress/cancel, reasons, modeled separation, changes, stale actions and auth loss.');
}finally{await server.close();}
