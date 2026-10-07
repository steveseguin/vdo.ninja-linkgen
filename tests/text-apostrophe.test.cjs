// Offline regression for literal apostrophes in the wizard's text answers.
// Run: node --test tests/text-apostrophe.test.cjs
// Uses the actual page callbacks and data. No browser or VDO session is opened.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = process.env.LINKGEN_ROOT || path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8'));
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

async function wizard() {
  const nodes = new Map();
  function element(id) {
    let html = '';
    const node = {children: [], style: {}, innerText: '', value: '',
      setAttribute(key, value) {this[key] = value;},
      appendChild(child) {this.children.push(child);}
    };
    Object.defineProperty(node, 'innerHTML', {get: () => html, set: value => {
      html = value;
      node.children = [];
      if (id === 'step') for (const child of ['stepTitle', 'stepDescription', 'stepAnswers', 'stepNumber']) nodes.delete(child);
    }});
    return node;
  }
  for (const id of ['step', 'stepNumber', 'stepTitle', 'stepDescription', 'stepAnswers', 'progress', 'link', 'finalUrl']) nodes.set(id, element(id));
  const document = {getElementById: id => nodes.get(id) || null, createElement: tag => element(tag)};
  const context = vm.createContext({document, fetch: async () => ({json: async () => structuredClone(data)})});
  vm.runInContext(script, context, {filename: 'index.html'});
  await new Promise(resolve => setImmediate(resolve));
  function choose(index, value) {
    const node = document.getElementById('stepAnswers').children[index];
    let error;
    try {
      if (node.onkeyup) {node.value = value; node.onkeyup({keyCode: 13});}
      else node.onclick();
    } catch (e) {error = e;}
    return error;
  }
  return {context, nodes, choose};
}

// Avoid the independent Push ID separator defect on main when checking a text
// value. Main also throws after rendering its final anchor; that separate bug
// and the separator are fixed in PR #1, not in this change.
const defaults = [2, 3, 0, 0, 0, 1, 3, 1, 0, 0, 1];
const fields = [{step: 4, choice: 2, key: 'label'}, {step: 5, choice: 0, key: 'room'},
  {step: 6, choice: 2, key: 'broadcast'}, {step: 10, choice: 1, key: 'push'}];
const values = ["O'Brien", "D'Angelo", "L'Atelier", "''", 'Guest1', 'Guest%20One',
  '%2523', '%FF', 'Room_1', 'Alice,Bob|Carol', 'Guest%27One', '100%25'];

for (const field of fields) for (const value of values) {
  test(`${field.key}: complete clickable link for ${JSON.stringify(value)}`, async () => {
    const w = await wizard();
    for (let step = 0; step < field.step; step++) assert.equal(w.choose(defaults[step]), undefined);
    const error = w.choose(field.choice, value);
    if (field.step < 10) assert.equal(error, undefined);
    const url = new URL(w.context.finalUrl);
    // Preserve pre-existing percent escape interpretation, including nested and
    // malformed UTF-8 escapes. Only a literal apostrophe is newly escaped.
    const expected = new URLSearchParams('value=' + value).get('value');
    assert.equal(url.searchParams.get(field.key), expected);
    assert.equal(url.hash, '');
    assert.equal(url.searchParams.size, 1);
    for (let step = field.step + 1; step < data.length; step++) w.choose(defaults[step], 'Guest42');
    const output = w.nodes.get('step').innerHTML;
    // Read the actual single-quoted href produced by the fixed page template.
    const href = output.match(/\bhref='([^']*)'/)?.[1];
    assert.equal(href, w.context.finalUrl, 'the clicked URL must equal the displayed generated URL');
    assert.match(output, /<a id='outputUrl'/);
  });
}

test('ordinary apostrophe label keeps later selected settings in the clicked link', async () => {
  const w = await wizard();
  const choices = [0, 1, 1, 0, 2, 0, 0, 0, 1, 0, 1];
  for (const [step, choice] of choices.entries()) w.choose(choice, step === 4 ? "O'Brien" : step === 5 ? 'GreenRoom' : 'Guest42');
  const href = w.nodes.get('step').innerHTML.match(/\bhref='([^']*)'/)?.[1];
  assert.equal(href, w.context.finalUrl);
  const url = new URL(href);
  assert.equal(url.searchParams.get('label'), "O'Brien");
  assert.equal(url.searchParams.get('room'), 'GreenRoom');
  for (const flag of ['webcam', 'broadcast', 'muted']) assert.equal(url.searchParams.get(flag), '');
  // Main's independent missing separator appends push= to the final flag.
  assert.ok(url.searchParams.has('nopreview') || url.searchParams.has('nopreviewpush'));
  assert.equal(url.searchParams.get('quality'), '1');
  assert.equal(url.searchParams.get('stereo'), '1');
});

test('non-Enter key preserves wizard state', async () => {
  const w = await wizard();
  for (let step = 0; step < 4; step++) w.choose(defaults[step]);
  const input = w.nodes.get('stepAnswers').children[2];
  const previous = w.context.finalUrl;
  input.value = "O'Brien";
  input.onkeyup({keyCode: 65});
  assert.equal(w.context.finalUrl, previous);
  assert.equal(w.context.currentStep, 4);
});
