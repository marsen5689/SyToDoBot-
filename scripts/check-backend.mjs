import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve('tgcloud');
let checked = 0;
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await inspect(file); continue; }
    assert(entry.name.endsWith('.js'), `Unexpected runtime file: ${file}`);
    const source = await readFile(file, 'utf8');
    // Parsing, not execution: runtime imports must be resolved by Telegram.
    new vm.Script(source.replace(/^import[\s\S]*?;\s*$/gm, '').replace(/export default /g, '').replace(/export /g, ''), { filename: file });
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const allowedGlobals = new Set(['process', 'Buffer', 'require', '__dirname', '__filename', 'Deno', 'Bun']);
    function visit(node) {
      if (ts.isImportDeclaration(node)) {
        const name = node.moduleSpecifier.text;
        if (name !== 'sdk' && name !== 'sdk/db') {
          assert(name.startsWith('.') && name.endsWith('.js'), `Unsupported import: ${name}`);
          const target = path.resolve(path.dirname(file), name);
          assert(target.startsWith(root + path.sep), `Import leaves tgcloud: ${name}`);
        }
      }
      if (ts.isIdentifier(node)) assert(!allowedGlobals.has(node.text), `Node-only global in ${file}: ${node.text}`);
      if (ts.isCallExpression(node)) assert(node.expression.kind !== ts.SyntaxKind.ImportKeyword, 'Dynamic imports are not allowed');
      ts.forEachChild(node, visit);
    }
    visit(ast);
    if (file.includes('/endpoints/')) {
      assert(/export default async function/.test(source), `${file} must export an async endpoint`);
      assert(/currentUser\(ctx\)/.test(source), `${file} must use verified initData`);
      assert(!/input\.(userId|user_id)/.test(source), `${file} must not trust client ownership`);
    }
    checked++;
  }
}
await inspect(root);
const config = JSON.parse(await readFile('tgcloud.jsonc', 'utf8'));
assert.equal(config.static.source, 'dist');
assert.equal(config.static.spa, true);
assert(!JSON.stringify(config).includes('X-Frame-Options'));
const api = await readFile('src/api.ts', 'utf8');
assert(api.includes('app.Serverless.call('));
assert(!/localStorage|sessionStorage|fetch\(/.test(api));
console.log(`Backend policy and syntax OK: ${checked} modules; frontend uses the official Serverless.call contract.`);
