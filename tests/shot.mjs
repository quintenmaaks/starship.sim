import puppeteer from 'puppeteer-core';
const [,, url, out, wait = '8000', w = '844', h = '390', dpr = '3'] = process.argv;
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: +dpr, isMobile: true, hasTouch: true, isLandscape: true });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
const steps = (process.env.STEPS || '').split(';').filter(Boolean);
await new Promise((r) => setTimeout(r, +wait));
for (const s of steps) { await page.evaluate(s); await new Promise((r) => setTimeout(r, +(process.env.STEPWAIT || 3000))); }
await page.screenshot({ path: out, type: out.endsWith('.png') ? 'png' : 'jpeg', quality: out.endsWith('.png') ? undefined : 88 });
const info = await page.evaluate(() => { const v = window.__view; return v ? { fps: v.fps, focusAlt: v.focus?.tel?.alt, t: window.__w?.t } : null; }).catch(() => null);
console.log(JSON.stringify(info));
console.log(logs.filter((l) => !l.includes('GPU stall') && !l.includes('GroupMarkerNotSet')).slice(0, 40).join('\n'));
await browser.close();
