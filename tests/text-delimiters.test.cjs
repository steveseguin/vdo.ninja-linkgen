// Offline regression for literal query delimiters in the wizard's text answers.
// Run: node --test tests/text-delimiters.test.cjs
// Actual inline callbacks and data, with a minimal DOM; no browser or VDO session.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = process.env.LINKGEN_ROOT || path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8'));
const script = fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];

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
    Object.defineProperty(node, 'outerHTML', {set: value => {
      if (id === 'link' && value === '') {nodes.delete('link'); nodes.delete('finalUrl');}
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
    try {
      if (node.onkeyup) {node.value = value; node.onkeyup({keyCode: 13});}
      else node.onclick();
    } catch (error) {return error;}
  }
  return {context, nodes, choose};
}

const defaults = [2, 3, 0, 0, 0, 1, 3, 1, 0, 0, 1];
const fields = [{step: 4, choice: 2, key: 'label'}, {step: 5, choice: 0, key: 'room'},
  {step: 6, choice: 2, key: 'broadcast'}, {step: 10, choice: 1, key: 'push'}];
const values = ['R&D', 'Studio#2', 'R&D#2', "O'Brien & Co #2", 'A&muted&room=Other',
  'A&#39;B', '&', '#', 'R%26D#2', 'R%2526D&Co', 'A%FF&B', 'Who?',
  'Question?room=Other', 'Guest??muted', 'A?B&C#D', 'Guest%3FOne', '%253F', '%3F', 'R%3FD?Co'];

function parseVdoQuery(url) {
  // Receiver preprocessing from VDO.Ninja lib.js lines 467-469 at commit
  // 68499f305f910020f9f2336d1f6ed1feef48d529; raw ? is also a separator there.
  var urlEdited = url.search.replace(/\?\?/g, "?");
  urlEdited = urlEdited.replace(/\?/g, "&");
  urlEdited = urlEdited.replace(/\&/, "?");
  return new URLSearchParams(urlEdited);
}

for (const field of fields) for (const value of values) {
  test(`${field.key}: keep ${JSON.stringify(value)} inside its text answer`, async () => {
    const w = await wizard();
    for (let step = 0; step < field.step; step++) assert.equal(w.choose(defaults[step]), undefined);
    const error = w.choose(field.choice, value);
    if (field.step < 10) assert.equal(error, undefined);
    // With default preceding choices, the Push ID value is testable even without
    // PR #1's independent separator/completion fix. Do not conflate those defects.
    const url = new URL(w.context.finalUrl);
    const expected = new URLSearchParams('value=' + value.replace(/&/g, '%26').replace(/#/g, '%23').replace(/\?/g, '%3F')).get('value');
    assert.equal(url.searchParams.get(field.key), expected);
    assert.equal(url.searchParams.size, 1, 'text must not add another parameter');
    assert.equal(url.hash, '', 'text must not start a URL fragment');
    const received = parseVdoQuery(url);
    assert.equal(received.get(field.key), expected, 'VDO.Ninja must receive the complete answer');
    assert.equal(received.size, 1, 'receiver preprocessing must not add a parameter');
  });
}

test('question mark in a label cannot override the selected room in VDO.Ninja', async () => {
  const label = 'Question?room=Other';
  // A standard URL parser alone misses this receiver-specific boundary.
  const unsafe = new URL('https://vdo.ninja/?label=' + label + '&room=GreenRoom');
  assert.equal(unsafe.searchParams.get('label'), label);
  assert.equal(parseVdoQuery(unsafe).get('room'), 'Other');

  const w = await wizard();
  const choices = [0, 1, 1, 1, 2, 0, 0, 0, 1, 1, 1];
  for (const [step, choice] of choices.entries()) {
    const error = w.choose(choice, step === 4 ? label : step === 5 ? 'GreenRoom' : 'Guest42');
    if (step < 10) assert.equal(error, undefined);
  }
  const href = w.nodes.get('step').innerHTML.match(/\bhref='([^']*)'/)?.[1];
  assert.equal(href, w.context.finalUrl);
  const received = parseVdoQuery(new URL(href));
  assert.equal(received.get('label'), label);
  assert.equal(received.get('room'), 'GreenRoom');
  assert.deepEqual(received.getAll('room'), ['GreenRoom']);
  assert.equal(received.get('muted'), '');
});

for (const label of ['R&D', 'Studio#2', "O'Brien & Co #2"]) {
  test(`complete invite retains selected settings after label ${JSON.stringify(label)}`, async () => {
    const w = await wizard();
    const choices = [0, 1, 1, 1, 2, 0, 0, 0, 1, 1, 1];
    for (const [step, choice] of choices.entries()) {
      const error = w.choose(choice, step === 4 ? label : step === 5 ? 'GreenRoom' : 'Guest42');
      if (step < 10) assert.equal(error, undefined);
    }
    const output = w.nodes.get('step').innerHTML;
    const href = output.match(/\bhref='([^']*)'/)?.[1];
    assert.equal(href, w.context.finalUrl);
    const url = new URL(href);
    assert.equal(url.searchParams.get('label'), label);
    assert.equal(url.searchParams.get('room'), 'GreenRoom');
    assert.equal(url.searchParams.get('quality'), '1');
    assert.equal(url.searchParams.get('stereo'), '1');
    assert.equal(url.searchParams.get('device'), '1');
    for (const flag of ['webcam', 'autostart', 'broadcast', 'muted', 'nopreview']) assert.equal(url.searchParams.get(flag), '');
    assert.equal(url.hash, '');
    // Separately validate the composed result whenever PR #1's data is present.
    if (data[10].answers[1].params === '&push=') {
      assert.equal(url.searchParams.get('codec'), 'h264');
      assert.equal(url.searchParams.get('push'), 'Guest42');
      assert.equal(w.nodes.get('progress').innerText, 'Done!');
    }
  });
}
