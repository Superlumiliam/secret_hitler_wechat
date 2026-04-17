const { createStore } = require('./createStore');

const gameStore = createStore({
  snapshot: null,
  boardVm: null,
  taskVm: null,
  identityVm: null,
  resultVm: null,
  watchMode: 'idle',
  loading: false,
  refreshing: false,
  commandLocks: {},
  lastVersion: null,
  error: null,
});

module.exports = { gameStore };

