const path = require('path');

function loadPlugin(name) {
  const mod = require(path.join(__dirname, name));
  const handlers = { save: () => 1 };
  return handlers[name]() + mod.run();
}

async function lazy(file) {
  return import(file);
}

module.exports = { loadPlugin, lazy };
