/* Builds a real .docx with fflate and reads it back with JSZip (cross-library check). */
var H = require('./harness'), ok = H.ok;
var JSZip = require('jszip'), DOMParser = require('@xmldom/xmldom').DOMParser;
var fs = require('fs'), path = require('path');
var env = H.load(), app = env.app;

var PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
var JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP////////////////////////////////////////////////////////////////////////////////////8A/8AACwgAAQABAQERAP/EABQAAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AH//2Q==';

app.project.projectName = 'Bruce Hwy <Test> & Co';
app.project.stage = 'Detailed Design';
app.project.auditDate = '2026-11-06';
app.findings = [
  { id: 'a', title: 'Exposed headwall', description: 'Line one\nLine two\u0001', recommendation: 'Shield\tor relocate', chainage: 'Ch 1+240', promptRef: 'H.4',
    crashTypes: ['Run-off-road'], freqIdx: 1, sevIdx: 4, risk: 'Extreme (FSI)', lat: -27.1, lng: 153.0, timestamp: '14 Jul 2026 09:41', hasPhoto: true },
  { id: 'b', title: 'Faded sign', description: '', recommendation: '', chainage: '', crashTypes: [], freqIdx: 2, sevIdx: 1, risk: 'Medium', lat: -27.2, lng: 153.1, timestamp: '', hasPhoto: true },
  { id: 'c', title: 'No photo', description: 'x', recommendation: '', crashTypes: [], freqIdx: 4, sevIdx: 0, risk: 'Negligible', lat: '', lng: '', hasPhoto: false }
];
var bytes = app.buildDocx({ a: JPG, b: PNG }, { a: { w: 3024, h: 4032 }, b: { w: 1600, h: 900 } });
ok(bytes instanceof Uint8Array && bytes.length > 1000, 'zip bytes produced');
var out = path.join(process.env.CZ_OUT || __dirname, 'test_output.docx');
fs.writeFileSync(out, Buffer.from(bytes));

// first local file header name must be [Content_Types].xml
var nlen = bytes[26] | (bytes[27] << 8);
ok(Buffer.from(bytes.slice(30, 30 + nlen)).toString() === '[Content_Types].xml', '[Content_Types].xml first in archive');

JSZip.loadAsync(Buffer.from(bytes)).then(function (zip) {
  var names = Object.keys(zip.files);
  ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/settings.xml', 'word/footer1.xml',
    'word/_rels/document.xml.rels', 'word/media/image1.jpg', 'word/media/image2.png'].forEach(function (n) {
    ok(names.indexOf(n) > -1, 'part present: ' + n);
  });
  var xmls = names.filter(function (n) { return /\.(xml|rels)$/.test(n); });
  return Promise.all(xmls.map(function (n) { return zip.file(n).async('string').then(function (t) { return [n, t]; }); }))
    .then(function (pairs) {
      var X = {};
      pairs.forEach(function (p) {
        X[p[0]] = p[1];
        var errs = [];
        new DOMParser({ onError: function (l, m) { errs.push(m); } }).parseFromString(p[1], 'text/xml');
        ok(!errs.length, 'well-formed: ' + p[0] + ' ' + errs.join('; '));
      });
      var doc = X['word/document.xml'], rels = X['word/_rels/document.xml.rels'], ct = X['[Content_Types].xml'];
      var ids = {}; (rels.match(/Id="(rId\d+)"/g) || []).forEach(function (m) { ids[m.slice(4, -1)] = 1; });
      (doc.match(/r:(?:embed|id)="(rId\d+)"/g) || []).forEach(function (m) {
        var id = m.split('"')[1]; ok(ids[id], 'relationship resolves: ' + id);
      });
      ok(/Extension="jpg" ContentType="image\/jpeg"/.test(ct) && /Extension="png" ContentType="image\/png"/.test(ct), 'image content types');
      ok(/footer\+xml/.test(ct), 'footer content type');
      ok(/w:w="23811" w:h="16838" w:orient="landscape"/.test(doc), 'A3 landscape');
      var cols = (doc.match(/<w:gridCol w:w="(\d+)"\/>/g) || []).map(function (m) { return +m.match(/\d+/)[0]; });
      var tblW = +doc.match(/<w:tblW w:w="(\d+)"/)[1];
      ok(cols.reduce(function (a, b) { return a + b; }, 0) === tblW && tblW === 20407, 'gridCols sum == tblW');
      ok(/<w:sectPr><w:footerReference/.test(doc), 'footerReference first in sectPr');
      // aspect ratio: portrait 3024x4032 fitted to 2743200 high
      var ext = doc.match(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g).map(function (m) { var n = m.match(/\d+/g); return [+n[0], +n[1]]; });
      ok(ext[0][1] === 2743200 && Math.abs(ext[0][0] / ext[0][1] - 0.75) < 0.001, 'portrait photo keeps 3:4 ' + ext[0]);
      ok(ext[1][0] === 4114800 && Math.abs(ext[1][0] / ext[1][1] - 16 / 9) < 0.001, 'landscape photo keeps 16:9 ' + ext[1]);
      ok(ext.length === 2, 'no image for finding without photo');
      ok(/Line one<\/w:t><w:br\/><w:t xml:space="preserve">Line two<\/w:t>/.test(doc), 'line breaks preserved as <w:br/>');
      ok(/Shield<\/w:t><w:tab\/><w:t xml:space="preserve">or relocate/.test(doc), 'tabs preserved');
      ok(doc.indexOf('\u0001') === -1, 'control char stripped');
      ok(doc.indexOf('Bruce Hwy &lt;Test&gt; &amp; Co') > -1, 'title escaped');
      ok(/w:fill="DC2626"/.test(doc), 'risk cell shaded with risk colour');
      ok(doc.indexOf('Audit date: 06/11/2026') > -1, 'audit date in AU format');
      ok(doc.indexOf('Prompt list: H.4') > -1, 'prompt reference exported');
      ok(/NUMPAGES/.test(X['word/footer1.xml']), 'page x of y footer');
      return zip.file('word/media/image2.png').async('uint8array').then(function (png) {
        ok(png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4E && png[3] === 0x47, 'PNG header intact');
      });
    });
}).then(function () { H.done('test_docx'); }, function (e) { console.error(e); process.exitCode = 1; });
