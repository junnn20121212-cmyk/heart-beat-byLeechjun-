// Exports the web version's track and terrain for Unity.
// Usage: (cd ../../dino-coaster && npm i three@0.160.0) && node export-from-web.mjs
// Unity is left-handed, three.js right-handed: we flip z (unityZ = -threeZ).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '../../dino-coaster/js');
const { Track, CP_INDEX } = await import(path.join(web, 'track.js'));
const { World, HALF, LINEUP } = await import(path.join(web, 'world.js'));

const out = path.resolve(here, '../Assets/DinoRush/Data');
fs.mkdirSync(out, { recursive: true });

const track = new Track();
const names = {};
for (const [k, i] of Object.entries(CP_INDEX)) names[i] = k;
const raw = track.curve.points;
const points = raw.map((p, i) => ({ name: names[i] || '', x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +(-p.z).toFixed(3) }));
fs.writeFileSync(path.join(out, 'track.json'), JSON.stringify({ points }, null, 1));

const world = new World(null, track, { high: true });
world.computeGrid();
const RES = 513, SIZE = HALF * 2;
const h = new Float32Array(RES * RES);
let minH = 1e9, maxH = -1e9;
for (let zi = 0; zi < RES; zi++) {
  for (let xi = 0; xi < RES; xi++) {
    const x = -HALF + (xi / (RES - 1)) * SIZE;
    const uz = -HALF + (zi / (RES - 1)) * SIZE;
    const v = world.heightAt(x, -uz);
    h[zi * RES + xi] = v;
    if (v < minH) minH = v; if (v > maxH) maxH = v;
  }
}
minH = Math.floor(minH) - 1; maxH = Math.ceil(maxH) + 1;
const buf = Buffer.alloc(RES * RES * 2);
for (let i = 0; i < h.length; i++) buf.writeUInt16LE(Math.round(((h[i] - minH) / (maxH - minH)) * 65535), i * 2);
fs.writeFileSync(path.join(out, 'terrain_height.bytes'), buf);
fs.writeFileSync(path.join(out, 'terrain.json'), JSON.stringify({
  size: SIZE, resolution: RES, minHeight: minH, maxHeight: maxH, waterLevel: 0,
  lake: { x: 45, z: -92, r: 34 }, lineup: { x: LINEUP.x, z: -LINEUP.z }, volcano: { x: 470, z: 330 },
}, null, 1));
console.log('track points', points.length, 'length', track.length.toFixed(0), 'm; terrain', RES + 'x' + RES, 'heights', minH, '..', maxH);
