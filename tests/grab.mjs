// Screenshot: WebGL-canvas via toDataURL (betrouwbaar met swiftshader) + HTML-overlay via page.screenshot
import puppeteer from 'puppeteer-core';
const [,, url, out, wait = '8000', w = '844', h = '390', dpr = '3'] = process.argv;
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 600000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: +dpr, isMobile: true, hasTouch: true, isLandscape: true });
const logs = [];
page.on('console', (m) => { if (['error', 'warning', 'warn'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url, { waitUntil: 'load', timeout: 180000 });
await new Promise((r) => setTimeout(r, +wait));
const steps = (process.env.STEPS || '').split(';;').filter(Boolean);
for (const s of steps) { await page.evaluate(s).catch((e) => logs.push('STEP ERR ' + e.message)); await new Promise((r) => setTimeout(r, +(process.env.STEPWAIT || 3000))); }
const ok = await page.evaluate(() => new Promise((res) => {
  const W = window; W.__img = null; W.__grab = true;
  let n = 0; const iv = setInterval(() => { n++; if (W.__img || n > 300) { clearInterval(iv); if (!W.__img) return res(false);
    const c = document.getElementById('gl'); const img = new Image(); img.src = W.__img; img.id = '__grabimg';
    img.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:0;pointer-events:none'; img.onload = () => { c.style.visibility = 'hidden'; c.parentNode.insertBefore(img, c); res(true); }; } }, 100);
}));
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: out, type: out.endsWith('.png') ? 'png' : 'jpeg', quality: out.endsWith('.png') ? undefined : 90 });
const info = await page.evaluate(() => { const v = window.__view; return v ? { fps: +v.fps.toFixed(1), alt: v.focus?.tel?.alt, t: window.__w?.t } : null; }).catch(() => null);
console.log('grab', ok, JSON.stringify(info));
console.log(logs.filter((l) => !l.includes('GPU stall') && !l.includes('Manifest') && !l.includes('GroupMarker')).slice(0, 30).join('\n'));
await browser.close();
