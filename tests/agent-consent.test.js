import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('consent route survives login; normal workspace gates and Rollup workaround remain',async()=>{const app=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');assert.ok(app.includes("!window.location.hash.startsWith('#/agent-consent?')"));assert.ok(app.includes("if (!auth.session) return <EntryPage"));assert.ok(app.includes("route==='/operations' && hasOperationsAccess(auth.account)"));assert.ok(app.includes('AgentConsentPage key={profile.id}'));const p=JSON.parse(await readFile(new URL('../package.json',import.meta.url)));assert.equal(p.overrides.rollup,'npm:@rollup/wasm-node@^4');});
