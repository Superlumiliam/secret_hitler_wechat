const { createStore } = require('./createStore');

const roomStore = createStore({
  lobbySnapshot: null,
  lobbyVm: null,
  watchMode: 'idle',
  loading: false,
  refreshing: false,
  lastVersion: null,
  error: null,
});

module.exports = { roomStore };

