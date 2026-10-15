import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {city} from '../src/config/city.js';

test('SPA uses browser referrer defaults while OAuth callback retains scoped privacy headers', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<meta\b[^>]*name\s*=\s*["']referrer["']/i);
  const headers = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
  const blocks = headers.trim().split(/\r?\n(?=\S)/);
  assert.equal(blocks.length, 1, 'Privacy headers must remain callback-scoped');
  assert.match(blocks[0], /^\/agent-callback\r?\n/);
  assert.match(blocks[0], /^\s+Referrer-Policy:\s*no-referrer\s*$/m);
  assert.match(blocks[0], /^\s+Cache-Control:\s*no-store\s*$/m);
});

test('OSM tile endpoint and visible attribution remain unchanged', async () => {
  assert.equal(city.tileUrl, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.equal(city.attribution, '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors');
  const map = await readFile(new URL('../src/components/IncidentMap.jsx', import.meta.url), 'utf8');
  assert.match(map, /<AttributionControl position="bottomleft"\s*\/>/);
  assert.match(map, /<TileLayer[^>]*url=\{city\.tileUrl\}[^>]*attribution=\{city\.attribution\}/);
});


test('every Leaflet basemap sends only the genuine origin despite callback document privacy policy', async () => {
  assert.equal(city.tileReferrerPolicy, 'strict-origin');
  for (const file of ['IncidentMap.jsx', 'AroundMeMap.jsx']) {
    const source = await readFile(new URL('../src/components/' + file, import.meta.url), 'utf8');
    const layers = source.match(/<TileLayer\b[^>]*>/g);
    assert.equal(layers.length, 1, file);
    assert.match(layers[0], /referrerPolicy=\{city\.tileReferrerPolicy\}/, file);
    assert.match(layers[0], /url=\{city\.tileUrl\}/, file);
    assert.match(layers[0], /attribution=\{city\.attribution\}/, file);
    assert.doesNotMatch(source, /(?:setRequestHeader|headers\s*:)[^;]*Referer/i);
  }
  const callback = await readFile(new URL('../src/pages/AgentCallbackPage.jsx', import.meta.url), 'utf8');
  assert.match(callback, /history\.replaceState/); // Same document can retain no-referrer after consent.
  const leaflet = await readFile(new URL('../node_modules/leaflet/dist/leaflet-src.js', import.meta.url), 'utf8');
  assert.match(leaflet, /tile\.referrerPolicy = this\.options\.referrerPolicy/);
});
