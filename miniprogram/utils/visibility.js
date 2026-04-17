const { createEmitter } = require('./emitter');

const visibilityBus = createEmitter();

function emitVisible() {
  visibilityBus.emit('visible', {});
}

function emitHidden() {
  visibilityBus.emit('hidden', {});
}

module.exports = {
  visibilityBus,
  emitVisible,
  emitHidden,
};

