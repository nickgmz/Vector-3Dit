// Loads the browser-style modules into Node for unit tests.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
module.exports = function load(files) {
  for (const f of files) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
    vm.runInThisContext(code, { filename: f });
  }
  return globalThis.V3D;
};
