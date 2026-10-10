
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
async function harness(respond) {
  global.window = { addEventListener() {} };
  global.document = { querySelectorAll() { return []; }, querySelector() { return null; }, visibilityState: 'hidden' };
  global.BroadcastChannel = undefined;
  const calls = [];
  global.fetch = async (url, options) => { calls.push({ url, ...options }); return respond(calls.at(-1), calls.length); };
  const source = 'const setInterval = () => 0;\n' + fs.readFileSync(path.join(__dirname, '../assets/cart.js'), 'utf8')
    .replace(/import\s*\{[^}]*\}\s*from\s*["']\.\/toast\.js(?:\?[^"']*)?["'];?\s*/m, 'const toastSuccess=()=>{};const toastError=()=>{};\n');
  const module = await import('data:text/javascript;base64,' + Buffer.from(source + '\n// ' + Math.random()).toString('base64'));
  return { module, calls };
}
function response(cart, extra = {}, ok = true) { return { ok, json: async () => ({ cart, csrf_token: 'test-token', ...extra }) }; }
test('cart requests serialize mutations and acquire CSRF before the first write', async () => {
  const { module, calls } = await harness((call, index) => response({ items: [], count: index - 1, totals: [] }));
  await Promise.all([module.requestCart({ action: 'add', product_id: 3, quantity: 1 }), module.requestCart({ action: 'set', product_id: 3, quantity: 2 })]);
  assert.deepEqual(calls.map(c => c.method), ['GET', 'POST', 'POST']);
  assert.equal(calls[1].headers['X-CSRF-Token'], 'test-token');
  assert.equal(JSON.parse(calls[2].body).quantity, 2);
  assert.equal(module.getCartSnapshot().cart.count, 2);
  assert.equal(module.getCartSnapshot().busy, false);
});
test('stock rejection keeps the authoritative cart and later requests can recover', async () => {
  const { module } = await harness((call, index) => index === 2 ? response({ items: [], count: 1, totals: [] }, { error: { message: 'Наличността е променена.' } }, false) : response({ items: [], count: 0, totals: [] }));
  await assert.rejects(module.requestCart({ action: 'set', product_id: 3, quantity: 100 }), /Наличността/);
  assert.equal(module.getCartSnapshot().cart.count, 1);
  assert.equal(module.getCartSnapshot().busy, false);
  await module.requestCart();
  assert.equal(module.getCartSnapshot().cart.count, 0);
  assert.equal(module.getCartSnapshot().error, '');
});
