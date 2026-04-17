const { callCloudAction } = require('./cloud');
const { sessionStore, setActiveRoom } = require('../store/sessionStore');
const { normalizeError } = require('../mappers/errorMapper');

async function ensureSession() {
  const data = await callCloudAction('bootstrapService', 'ensureSession', {});
  const defaultName = data && data.user && data.user.defaultDisplayName;
  if (defaultName) {
    sessionStore.patch({ displayName: defaultName });
  }
  if (data && data.activeRoom) {
    setActiveRoom(data.activeRoom);
  }
  sessionStore.patch({ envReady: true, bootstrapReady: true });
  return data;
}

async function recoverActiveRoom() {
  const data = await callCloudAction('bootstrapService', 'recoverActiveRoom', {});
  if (data && data.activeRoom) {
    setActiveRoom(data.activeRoom);
  } else {
    setActiveRoom(null);
  }
  return data || { activeRoom: null };
}

module.exports = {
  bootstrapService: {
    ensureSession,
    recoverActiveRoom,
  },
};

