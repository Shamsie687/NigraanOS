import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const sha=text=>createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');
const expected={
  "Vite starter SVG assets": "e824161e0aab3814aca1883bd7058e67034d25fce254e6629495e78d3f8a53c3",
  "react-leaflet 4.2.1": "a3e49c6772814ae7e47b5aed03ac659ed7ba0eadf670de49428eb6f5d35871cd",
  "@react-leaflet/core 2.1.0": "a2bad566722e5db85724df8039f2d3f3c8d3437aae6db373b356b6f0661fe13a"
};

test('public notices retain exact reviewed upstream terms for Vite and both locked React Leaflet packages',async()=>{
  const notices=await read('public/THIRD_PARTY_NOTICES.txt');
  for(const [name,digest] of Object.entries(expected)){
    const marker='=== '+name+' ===\n';
    assert.equal(notices.split(marker).length,2,name);
    const block=notices.split(marker)[1].split('=== END '+name+' ===')[0];
    const text=block.slice(block.indexOf('\n\n')+2).replace(/\n+$/,'');
    assert.equal(sha(text),digest,name+' license changed');
  }
  const lock=JSON.parse(await read('package-lock.json'));
  for(const name of ['react-leaflet','@react-leaflet/core']){
    const pkg=lock.packages['node_modules/'+name];
    assert.ok(Object.hasOwn(expected,name+' '+pkg.version),'Review notices when package version changes');
    assert.equal(pkg.license,'Hippocratic-2.1');
    assert.ok(notices.includes(await read('node_modules/'+name+'/LICENSE.md').then(s=>s.trimEnd())));
  }
});

test('project MIT license, creator credits and public notice link remain intact',async()=>{
  const license=await read('LICENSE');
  assert.equal(sha(license),"febbdb603ff1a67526e9b7d977abafa4c7e8464c7ae53b85dd80fe904b838cae");
  assert.match(license,/Copyright \(c\) 2026 Shamsie687 and ALI-ARSALANN/);
  const readme=await read('README.md');
  assert.ok(readme.includes('[THIRD_PARTY_NOTICES](public/THIRD_PARTY_NOTICES.txt)'));
  for(const name of ['Shamsie687','ALI-ARSALANN'])assert.ok(readme.includes('https://github.com/'+name));
  const config=await read('vite.config.js');
  assert.doesNotMatch(config,/publicDir\s*:\s*false/);
});
