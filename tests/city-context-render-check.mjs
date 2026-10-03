import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {renderToString} from 'react-dom/server';
import React from 'react';
import {pathToFileURL} from 'node:url';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
  const {default:Panel}=await server.ssrLoadModule('/src/components/CityEnvironmentPanel.jsx');const {city}=await server.ssrLoadModule('/src/config/city.js');
  const empty=renderToString(React.createElement(Panel,{context:{data:null,loading:false},city}));assert.match(empty,/Environmental data unavailable/);assert.ok(!empty.includes('25.6'));
  const times={valid_at:'2026-10-02T20:00:00Z',fetched_at:'2026-10-02T20:01:00Z'};
  const weather={...times,status:'current',temperature_c:25.6,apparent_temperature_c:30.5,humidity_percent:93,wind_speed_kmh:9.9,weather_code:0,precipitation:{amount_mm:0,interval_seconds:900},rain:{amount_mm:0},source:{attribution:'Open-Meteo · weather model data'}};
  const air={...times,status:'stale',aqi:81,aqi_category:'Moderate',pm2_5_ug_m3:15.1,pm10_ug_m3:24,source:{attribution:'Open-Meteo · Copernicus CAMS'}};
  const data={weather,air_quality:air,rainfall_context:{previous_24h:{coverage:'partial',hours_available:23,hours_expected:24}}};
  const html=renderToString(React.createElement(Panel,{context:{data,loading:false},city})).replace(/<!--.*?-->/g,'');for(const text of ['25.6','US AQI 81','15.1','24','15 minutes','partial coverage','Rainfall context does not confirm flooding','Environmental context does not verify Citizen reports','stale'])assert.ok(html.includes(text),text);
  const map=renderToString(React.createElement(Panel,{context:{data},city}));assert.match(map,/<details class="environment-collapsible"/);assert.match(map,/City Conditions · Modeled/);assert.ok(!map.includes('<details open'));assert.match(map,/0.*mm.*15.*min/);
  const css=await readFile(new URL('../src/index.css',import.meta.url),'utf8');assert.match(css,/@media\(max-width:900px\).*environment-grid.*grid-template-columns:1fr/s);assert.match(css,/@media\(max-width:480px\).*environment-toolbar.*flex-direction:column/s);
  if(process.argv[2]){
    const {chromium}=await import(pathToFileURL(process.argv[2]).href);
    const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
    try{
      const page=await browser.newPage({viewport:{width:390,height:844}});
      await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><main class="dashboard operations-real-workspace">'+html+map+'</main></body></html>');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=390),'390px horizontal overflow');
      assert.equal(await page.locator('.environment-grid').first().evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),1);
      await page.locator('.environment-collapsible>summary').first().click();assert.equal(await page.locator('.environment-collapsible').first().getAttribute('open'),'');
      await page.screenshot({path:'review/city-environment-mobile.png',fullPage:true});
      await page.setViewportSize({width:1440,height:900});assert.equal(await page.locator('.environment-grid').first().evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),3);
      await page.screenshot({path:'review/city-environment-desktop.png',fullPage:true});
      console.log('Chromium UI passed: 390px no horizontal overflow, one-column cards, collapsible map panel; 1440px three-column layout.');
    }finally{await browser.close();}
  }
  console.log('Environment render passed: real fixture values, independent states, missing/partial data, interval labels, disclaimers, collapsible map panel and mobile CSS.');
}finally{await server.close();}
