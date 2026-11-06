var H = require('./harness'), ok = H.ok;
var env = H.load(), app = env.app, ctx = env.ctx;

/* ---- build a TIFF/EXIF block with GPS + DateTimeOriginal (little-endian) ---- */
function tiff(lat, latRef, lng, lngRef, dt) {
  var b = Buffer.alloc(400); var o = 0;
  b.write('II', 0); b.writeUInt16LE(42, 2); b.writeUInt32LE(8, 4);
  // IFD0 @8: 2 entries (GPS ptr, EXIF ptr)
  b.writeUInt16LE(2, 8);
  b.writeUInt16LE(0x8825, 10); b.writeUInt16LE(4, 12); b.writeUInt32LE(1, 14); b.writeUInt32LE(100, 18);
  b.writeUInt16LE(0x8769, 22); b.writeUInt16LE(4, 24); b.writeUInt32LE(1, 26); b.writeUInt32LE(250, 30);
  b.writeUInt32LE(0, 34);
  // GPS IFD @100: 4 entries
  b.writeUInt16LE(4, 100);
  var e = 102;
  function ent(tag, type, count, val) { b.writeUInt16LE(tag, e); b.writeUInt16LE(type, e + 2); b.writeUInt32LE(count, e + 4); val(e + 8); e += 12; }
  ent(1, 2, 2, function (p) { b.write(latRef + '\0', p); });
  ent(2, 5, 3, function (p) { b.writeUInt32LE(160, p); });
  ent(3, 2, 2, function (p) { b.write(lngRef + '\0', p); });
  ent(4, 5, 3, function (p) { b.writeUInt32LE(184, p); });
  function dms(at, v) { var d = Math.floor(v), mf = (v - d) * 60, m = Math.floor(mf), s = Math.round((mf - m) * 60 * 10000);
    b.writeUInt32LE(d, at); b.writeUInt32LE(1, at + 4); b.writeUInt32LE(m, at + 8); b.writeUInt32LE(1, at + 12); b.writeUInt32LE(s, at + 16); b.writeUInt32LE(10000, at + 20); }
  dms(160, lat); dms(184, lng);
  // EXIF IFD @250: DateTimeOriginal
  b.writeUInt16LE(1, 250); b.writeUInt16LE(0x9003, 252); b.writeUInt16LE(2, 254); b.writeUInt32LE(20, 256); b.writeUInt32LE(300, 260);
  b.write(dt + '\0', 300);
  return b;
}
function ab(buf) { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); }

var t = tiff(27.195386, 'S', 153.028319, 'E', '2026:07:14 09:41:22');
var jpeg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE1, 0x01, 0x9A]), Buffer.from('Exif\0\0', 'binary'), t]);
var r = app.readEXIF(ab(jpeg));
ok(r.gps && Math.abs(r.gps.lat + 27.195386) < 1e-5, 'lat (S negative) ' + JSON.stringify(r.gps));
ok(r.gps && Math.abs(r.gps.lng - 153.028319) < 1e-5, 'lng ' + JSON.stringify(r.gps));
ok(r.ts === '14 Jul 2026 09:41', 'timestamp ' + r.ts);

// decoy TIFF signature before the real Exif block (e.g. inside an APP2/ICC or thumbnail)
var decoy = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE2, 0, 20]), Buffer.from('II*\0\x08\0\0\0\xff\xff', 'binary'), Buffer.alloc(8), Buffer.from([0xFF, 0xE1, 1, 0x9A]), Buffer.from('Exif\0\0', 'binary'), t]);
r = app.readEXIF(ab(decoy));
ok(r.gps && Math.abs(r.gps.lat + 27.195386) < 1e-5, 'Exif marker preferred over decoy TIFF header');

// bare TIFF fallback, west longitude
r = app.readEXIF(ab(tiff(51.5, 'N', 0.1278, 'W', '2026:01:02 03:04:05')));
ok(r.gps && r.gps.lat > 51 && r.gps.lng < 0, 'bare TIFF fallback + W ref');
ok(app.readEXIF(ab(Buffer.from('no exif here at all'))).gps === null, 'no EXIF -> null');
ok(app.readEXIF(ab(Buffer.concat([Buffer.from('Exif\0\0', 'binary'), Buffer.from('II*\0\xff\xff\xff\x7f', 'binary')]))).gps === null, 'corrupt IFD pointer does not throw');

/* ---- HEIC sniff ---- */
function ftyp(brand) { var b = Buffer.alloc(16); b.write('ftyp', 4); b.write(brand, 8); return new Uint8Array(b); }
ok(app.sniffHeic(ftyp('heic')) && app.sniffHeic(ftyp('mif1')), 'HEIC brands detected');
ok(!app.sniffHeic(ftyp('isom')) && !app.sniffHeic(ftyp('avif')), 'MP4/AVIF not treated as HEIC');

/* ---- risk ---- */
var m = app.project.matrix;
ok(m.length === 5 && m.every(function (row) { return row.length === 5; }), '5x5 matrix');
app.cur = app.blank(); app.cur.freqIdx = 0; app.cur.sevIdx = 4; app.calcRisk();
ok(app.cur.risk === 'Extreme (FSI)', 'Almost certain x Fatal = Extreme (FSI)');
app.findings = [{ freqIdx: 4, sevIdx: 0, risk: 'x' }];
app.recalcAll();
ok(app.findings[0].risk === 'Negligible', 'recalcAll re-rates');
ok(app.riskLevels.every(function (l) { return app.riskHex(l) !== '#94a3b8' || l === 'Negligible'; }), 'every risk level has a colour');

/* ---- helpers ---- */
ok(app.fmtDate('2026-11-06') === '06/11/2026', 'fmtDate');
app.project.lat = ''; ok(app.centre()[0] === -27.4698, 'centre() guards a blank latitude');
app.project.lat = -27.2; app.project.lng = 153.1; ok(app.centre()[0] === -27.2, 'centre() uses project values');
ok(app.blank().lat === -27.2, 'blank() uses guarded centre');
ok(ctx.xmlSafe('a\u0001b\u000Bc') === 'abc', 'xmlSafe strips control chars');
ok(ctx.xe('<a & "b">') === '&lt;a &amp; &quot;b&quot;&gt;', 'xe escapes');

/* ---- vendor cache records ---- */
ok(ctx.assetCode('abc') === 'abc' && ctx.assetUrl('abc') === null, 'legacy string asset = unknown version');
ok(ctx.assetUrl({ u: 'x', code: 'y' }) === 'x', 'versioned asset record');
ok(ctx.VENDORS.some(function (v) { return v.k === 'fflate'; }) && !ctx.VENDORS.some(function (v) { return v.k === 'jszip'; }), 'fflate replaces JSZip');
ok(ctx.VENDORS[ctx.VENDORS.length - 1].k === 'alpine', 'Alpine loads last');

/* ---- reorder ---- */
app.findings = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
app.moveFinding(0, 1); ok(app.findings.map(function (f) { return f.id; }).join('') === 'bac', 'moveFinding down');
app.moveFinding(0, -1); ok(app.findings[0].id === 'b', 'moveFinding at top is a no-op');
app.dragFrom = 2; app.dropAt(0); ok(app.findings[0].id === 'c', 'dropAt');

/* ---- prompt lists ---- */
var total = app.checklist.reduce(function (n, c) { return n + c.items.length; }, 0);
ok(total === 112, 'Appendix H prompt count 112 (got ' + total + ')');
ok(app.checklist.map(function (c) { return c.code; }).join(',') === 'H.2,H.3,H.4,H.5,H.6,H.7,H.8', 'H.2-H.8 only');
ok(app.checklist[6].items.length === 33, 'H.8 has 33 prompts');

H.done('test_logic');
