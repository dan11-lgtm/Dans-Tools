const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
/* Browser smoke test. CDNs are routed to local npm copies (same pinned versions).
   NODE_PATH=<global modules with playwright> CZ_NM=<node_modules with leaflet, fflate, alpinejs, heic-to> CZ_OUT=<dir> node test_browser.js */
const NM = process.env.CZ_NM;
const OUT = process.env.CZ_OUT || __dirname;
const MAP = {
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css': NM + '/leaflet/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js': NM + '/leaflet/dist/leaflet.js',
  'https://unpkg.com/fflate@0.8.3/umd/index.js': NM + '/fflate/umd/index.js',
  'https://unpkg.com/alpinejs@3.17.5/dist/cdn.min.js': NM + '/alpinejs/dist/cdn.min.js',
  'https://cdn.jsdelivr.net/npm/heic-to@1.6.7/dist/iife/heic-to.js': NM + '/heic-to/dist/iife/heic-to.js'
};
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.route('**/*', r => {
    const u = r.request().url();
    if (MAP[u]) return r.fulfill({ status: 200, body: fs.readFileSync(MAP[u]), headers: { 'access-control-allow-origin': '*', 'content-type': u.endsWith('.css') ? 'text/css' : 'application/javascript' } });
    if (u.startsWith('file:')) return r.continue();
    return r.abort();
  });
  await page.goto('file://' + path.resolve(__dirname, '../../ClearZone.html'));
  await page.waitForFunction(() => !document.getElementById('boot') && window.Alpine, null, { timeout: 15000 });
  const st = () => page.evaluate(() => { const d = Alpine.$data(document.getElementById('layout')); return { tab: d.tab, n: d.findings.length, asset: d.assetStatus, modal: d.modal }; });
  console.log('boot', await st());
  // scroll check on project tab
  const sc = await page.evaluate(() => { const s = document.querySelector('.scroll'); s.scrollTop = 99999; return { sh: s.scrollHeight, ch: s.clientHeight, top: s.scrollTop, main: document.querySelector('main').getBoundingClientRect().height }; });
  console.log('scroll', sc);
  // new finding
  await page.click('text=New Finding');
  await page.fill('input[placeholder^="Describe the hazard"]', 'Unshielded culvert headwall');
  await page.fill('textarea[placeholder^="What is the hazard"]', 'Line one\nLine two');
  // attach generated JPEG portrait photo
  const jpg = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 900; const g = c.getContext('2d'); g.fillStyle = '#3a7'; g.fillRect(0, 0, 600, 900); return c.toDataURL('image/jpeg', .8).split(',')[1]; });
  await page.setInputFiles('.drop input[type=file]', { name: 'p.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg, 'base64') });
  await page.waitForFunction(() => { const d = Alpine.$data(document.getElementById('layout')); return d.cur.photo && !d.processing; });
  await page.screenshot({ path: path.join(OUT, 'modal.png') });
  await page.click('button:has-text("Save Finding")');
  await page.waitForTimeout(600);
  console.log('after save', await st());
  // edit + escape with no change closes without confirm
  await page.click('button.nav-link:has-text("Findings")');
  await page.click('.fcard button[title=Edit]');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  console.log('after esc', await st());
  // fromPrompt
  await page.click('button.nav-link:has-text("Prompt Lists")');
  await page.click('.clitem:visible >> nth=0');
  await page.click('button:has-text("Save Finding")');
  await page.waitForTimeout(400);
  await page.click('button.nav-link:has-text("Findings")');
  await page.screenshot({ path: path.join(OUT, 'findings.png') });
  // recs autosave
  await page.click('button.nav-link:has-text("Recommendations")');
  await page.fill('.redit textarea >> nth=0', 'Install W-beam');
  await page.waitForTimeout(900);
  const ls = await page.evaluate(() => JSON.parse(localStorage.getItem('clearzone_findings_v3')).map(f => [f.title, f.recommendation, f.promptRef, f.hasPhoto]));
  console.log('stored', JSON.stringify(ls));
  // export word
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Export Word")')]);
  await dl.saveAs(path.join(OUT, 'browser_export.docx'));
  // map tab
  await page.click('button.nav-link:has-text("Satellite Map")');
  await page.waitForTimeout(500);
  console.log('markers', await page.evaluate(() => document.querySelectorAll('#mainMap .leaflet-marker-icon').length));
  console.log('heic', await page.evaluate(async () => { const f = await loadHeic(); const r = await CZDB.get('assets','heic-to'); return [typeof f, !!(r && r.u), r && r.code.length]; }));
  // data tab status
  await page.click('button.nav-link:has-text("Data")');
  console.log('status', await page.evaluate(() => document.querySelector('[x-text=assetStatus]').textContent));
  // reload: offline from cache
  await page.unroute('**/*');
  await page.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('boot') && window.Alpine, null, { timeout: 15000 });
  console.log('offline reload', await st());
  // phone
  const ph = await ctx.newPage(); await ph.setViewportSize({ width: 390, height: 844 });
  await ph.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await ph.goto('file://' + path.resolve(__dirname, '../../ClearZone.html'));
  await ph.waitForTimeout(1500);
  await ph.evaluate(() => Alpine.$data(document.getElementById('layout')).tab = 'findings');
  await ph.waitForTimeout(300);
  await ph.screenshot({ path: path.join(OUT, 'phone.png') });
  await ph.evaluate(() => Alpine.$data(document.getElementById('layout')).editFinding(0));
  await ph.waitForTimeout(800);
  await ph.screenshot({ path: path.join(OUT, 'phone_modal.png') });
  console.log('phone hscroll', await ph.evaluate(() => document.documentElement.scrollWidth));
  console.log('ERRORS', JSON.stringify(errs,null,1));
  await b.close();
})();
