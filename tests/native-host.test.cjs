// Actual Windows host processes and disk I/O, with Chrome's wire protocol simulated.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const build = path.join(root, 'native', 'test-build');
const id = 'a'.repeat(32), origin = `chrome-extension://${id}/`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const exe = path.join(build, 'ShakeSaveHost.exe');
before(() => {
  if (process.platform !== 'win32') return;
  fs.mkdirSync(build, { recursive: true });
  const compiler = path.join(process.env.WINDIR, 'Microsoft.NET', fs.existsSync(path.join(process.env.WINDIR, 'Microsoft.NET/Framework64')) ? 'Framework64' : 'Framework', 'v4.0.30319/csc.exe');
  const r = spawnSync(compiler, ['/nologo', '/target:winexe', '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll', '/reference:System.Xml.dll', `/out:${exe}`, path.join(root, 'native/Host.cs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  fs.writeFileSync(path.join(build, 'host.json'), JSON.stringify({ allowed_origins: [origin] }));
});
function run(messages) {
  const input = Buffer.concat(messages.map(msg => {
    const b = Buffer.from(JSON.stringify(msg)), h = Buffer.alloc(4); h.writeUInt32LE(b.length); return Buffer.concat([h,b]);
  }));
  const result = spawnSync(exe, [origin], { input, timeout: 5000, windowsHide: true });
  assert.equal(result.status, 0, String(result.error || result.stderr));
  let bytes = result.stdout; const replies = [];
  while (bytes.length) { const len = bytes.readUInt32LE(0); replies.push(JSON.parse(bytes.subarray(4, len + 4))); bytes = bytes.subarray(len + 4); }
  assert.equal(replies.length, messages.length); return replies;
}
function select(dir) { fs.writeFileSync(path.join(build, `folder-${id}.txt`), dir); }
function save(bytes = png, name = 'image.png') {
  const [begin, chunk, commit] = run([{op:'begin',size:bytes.length,name},{op:'chunk',data:bytes.toString('base64')},{op:'commit'}]);
  assert.equal(begin.ok, true); assert.equal(chunk.ok, true); return commit;
}
test('Windows native host: persistence, bytes, collision, security, failures and cleanup', { skip: process.platform !== 'win32', timeout: 30000 }, () => {
  const parent = path.join(root, 'native/test-output'); fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, '圖片-')); select(dir);
  try {
    assert.equal(run([{ op: 'status' }])[0].folder, dir);
    const one = save(); assert.equal(one.ok, true); assert.deepEqual(fs.readFileSync(one.path), png);
    const two = save(); assert.notEqual(one.path, two.path); assert.deepEqual(fs.readFileSync(one.path), png);
    const tagged = save(png, '@繪師 @合繪者 [人物] [頭] #手繪 ＂鼻子的畫法 很漂亮＂.png');
    assert.equal(path.basename(tagged.path), '@繪師 @合繪者 [人物] [頭] #手繪 ＂鼻子的畫法 很漂亮＂.png');
    assert.deepEqual(fs.readFileSync(tagged.path),png);
    assert.equal(run([{ op: 'status' }])[0].folder, dir);
    for (const name of ['../bad.png', 'C:\\bad.png', 'x:evil.png', 'NUL.png', 'CON', '.hidden', 'name.'])
      assert.equal(run([{ op: 'begin', size: 4, name }])[0].ok, false, name);
    assert.equal(save(Buffer.from('<html>login</html>')).ok, false);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
    const s = save(svg, 'vector.png'); assert.match(s.path, /\.svg$/); assert.deepEqual(fs.readFileSync(s.path), svg);
    assert.equal(save(Buffer.from('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///C:/secret">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>')).ok, false);
    assert.equal(run([{ op: 'begin', size: 21 * 1024 * 1024, name: 'big.png' }])[0].ok, false);
    assert.equal(run([{ op: 'begin', size: 100, name: 'partial.png' }, { op: 'commit' }])[1].ok, false);
    assert.equal(run([{ op: 'begin', size: 1, name: 'overflow.png' }, { op: 'chunk', data: png.toString('base64') }])[1].ok, false);
    run([{ op: 'begin', size: png.length, name: 'disconnect.png' }]);
    assert.ok(!fs.readdirSync(dir).some(f => f.endsWith('.part')));
    select(path.join(dir, 'missing')); assert.equal(run([{ op: 'status' }])[0].ok, false);
    select(dir); assert.equal(run([{ op: 'exec', command: 'whoami' }])[0].ok, false);
    for (const arg of [`chrome-extension://${'b'.repeat(32)}/`, 'https://evil.test/', '']) {
      const result = spawnSync(exe, [arg], { timeout: 3000 }); assert.equal(result.status, 2);
    }
  } finally {
    // Only this test-created directory is removed, never an installation or selected user folder.
    for (const entry of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, entry));
    fs.rmdirSync(dir);
  }
});
