/* Loads the <script> from ClearZone.html into a node vm with light stubs.
   Usage: NODE_PATH=<dir with fflate, jszip, @xmldom/xmldom> node test_*.js  */
var fs = require('fs'), path = require('path'), vm = require('vm');
var html = fs.readFileSync(path.join(__dirname, '..', '..', 'ClearZone.html'), 'utf8');
var code = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
code = code.replace(/\nboot\(false\);\s*$/, '\n');

function load() {
  var ctx = {
    console: console, Promise: Promise, setTimeout: setTimeout, clearTimeout: clearTimeout,
    Uint8Array: Uint8Array, DataView: DataView, ArrayBuffer: ArrayBuffer, JSON: JSON, Math: Math,
    atob: function (b) { return Buffer.from(b, 'base64').toString('binary'); },
    navigator: { onLine: false }, window: {}, document: { getElementById: function () { return null; } },
    localStorage: { getItem: function () { return null; }, setItem: function () { }, removeItem: function () { } },
    fflate: require('fflate'), toastLog: []
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;this.auditApp = auditApp; this.xe = xe; this.xmlSafe = xmlSafe; this.assetUrl = assetUrl; this.assetCode = assetCode; this.VENDORS = VENDORS;', ctx);
  var app = ctx.auditApp();
  app.project = app.defaultProject();
  return { ctx: ctx, app: app };
}

var pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('  FAIL: ' + msg); } }
function done(name) { console.log(name + ': ' + pass + ' passed, ' + fail + ' failed'); if (fail) process.exitCode = 1; }

module.exports = { load: load, ok: ok, done: done };
