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
