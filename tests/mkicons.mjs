import puppeteer from 'puppeteer-core';
import fs from 'fs';
const svg = fs.readFileSync('/workspace/starship-sim/public/icons/icon.svg', 'utf8');
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage();
for (const [n, s] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512]]) {
  await p.setViewport({ width: s, height: s, deviceScaleFactor: 1 });
  await p.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
  await p.screenshot({ path: '/workspace/starship-sim/public/icons/' + n, clip: { x: 0, y: 0, width: s, height: s } });
}
await b.close();
