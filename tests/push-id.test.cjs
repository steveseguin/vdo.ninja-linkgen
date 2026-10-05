// Offline regression tests for the inline wizard and real data.json.
// Run with: node --test tests/push-id.test.cjs
// DOM and fetch are fixtures; this does not exercise browser rendering or VDO.Ninja.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

async function drive(root, share, codec, custom, minimal = false) {
  const ids = new Map();
  function element(id) {
    let html = '';
    const e = { id, children: [], style: {}, innerText: '', value: '', setAttribute(k, v) { this[k] = v; }, appendChild(c) { this.children.push(c); } };
    Object.defineProperty(e, 'innerHTML', { get: () => html, set: (v) => {
      html = v;
      e.children = [];
      if (id === 'step') for (const child of ['stepTitle', 'stepDescription', 'stepAnswers', 'stepNumber']) ids.delete(child);
    }});
    return e;
  }
  for (const id of ['step', 'stepNumber', 'stepTitle', 'stepDescription', 'stepAnswers', 'progress', 'link', 'finalUrl']) ids.set(id, element(id));
  const document = { getElementById: (id) => ids.get(id) || null, createElement: (tag) => element(tag) };
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8'));
  const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const randomMath = Object.create(Math); randomMath.random = () => 0.25;
  const context = vm.createContext({ document, fetch: async () => ({ json: async () => structuredClone(data) }), Math: randomMath });
  vm.runInContext(source, context, { filename: 'index.html' });
  await new Promise(resolve => setImmediate(resolve));
  // Real rendered callbacks from all 11 steps. Keep the room and label disabled.
  const answers = minimal
    ? [share, 3, 0, 0, 0, 1, 3, 1, 0, codec, custom ? 1 : 0]
    : [share, 1, 1, 1, 0, 1, 1, 0, 1, codec, custom ? 1 : 0];
  let error;
  for (const [step, choice] of answers.entries()) {
    const node = document.getElementById('stepAnswers').children[choice];
    try {
      if (step === 10 && custom) { node.value = 'Guest42'; node.onkeyup({ keyCode: 13 }); }
      else node.onclick();
    } catch (e) { error = e; break; }
  }
  return { finalUrl: context.finalUrl, error, progress: ids.get('progress'), output: ids.get('step').innerHTML };
}

const root = path.resolve(__dirname, '..');
const shares = ['Webcam', 'Screen', 'Allow both', 'File'];
const codecs = ['Default', 'H.264', 'VP9'];
for (let share = 0; share < shares.length; share++) {
  for (let codec = 0; codec < codecs.length; codec++) {
    for (const custom of [false, true]) {
      test(`${shares[share]}, ${codecs[codec]}, ${custom ? 'custom' : 'random'} push ID`, async () => {
        const actual = await drive(root, share, codec, custom);
        const url = new URL(actual.finalUrl);
        assert.equal(url.searchParams.get('push'), custom ? 'Guest42' : 'PPPPPPPPPP');
        assert.equal(url.searchParams.getAll('push').length, 1);
        assert.equal(url.searchParams.get('codec'), [null, 'h264', 'vp9'][codec]);
        assert.equal(url.searchParams.get('quality'), '1');
        assert.equal(url.searchParams.get('stereo'), '1');
        assert.equal(url.searchParams.get('device'), '1');
        assert.equal(url.searchParams.get('autostart'), '');
        assert.equal(url.searchParams.get('muted'), '');
        assert.equal(url.searchParams.get('nopreview'), '');
        assert.equal(actual.error, undefined, 'finishing the wizard must not throw');
        assert.equal(actual.progress.innerText, 'Done!');
        assert.equal(actual.progress.style.width, '100%');
        assert.ok(actual.output.includes(`href='${actual.finalUrl}'`));
      });
    }
  }
}

// Preserve the Allow both + all defaults + custom ID path, which already worked.
for (let share = 0; share < shares.length; share++) {
  for (const custom of [false, true]) {
    test(`${shares[share]}, all defaults, ${custom ? 'custom' : 'random'} push ID`, async () => {
      const actual = await drive(root, share, 0, custom, true);
      const url = new URL(actual.finalUrl);
      assert.equal(url.searchParams.get('push'), custom ? 'Guest42' : 'PPPPPPPPPP');
      assert.equal(url.searchParams.getAll('push').length, 1);
      for (const optional of ['quality', 'stereo', 'device', 'autostart', 'muted', 'nopreview', 'codec']) {
        assert.equal(url.searchParams.has(optional), false);
      }
      const mode = ['webcam', 'screenshare', null, 'fs'][share];
      if (mode) assert.equal(url.searchParams.get(mode), '');
      assert.equal(actual.error, undefined, 'finishing the wizard must not throw');
      assert.equal(actual.progress.innerText, 'Done!');
      assert.ok(actual.output.includes(`href='${actual.finalUrl}'`));
    });
  }
}
