const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Load the actual source with explicitly injected boundaries; never connect to a DB.
module.exports = function loadTs(file, mocks) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error(`Unmocked dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
};
