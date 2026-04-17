const { ROUTE } = require('../constants/route');
const { COPY } = require('../constants/copy');

function buildSharePath(roomCode) {
  const code = String(roomCode || '').toUpperCase();
  return `${ROUTE.HOME}?roomCode=${encodeURIComponent(code)}`;
}

function buildRoomShareMessage(snapshot) {
  const count = snapshot ? `${snapshot.playerCount || 0}/${snapshot.maxPlayerCount || 10}` : '';
  return {
    title: `${COPY.APP_TITLE} - 房号 ${snapshot ? snapshot.roomCode : ''}`,
    path: buildSharePath(snapshot ? snapshot.roomCode : ''),
    imageUrl: '',
    query: snapshot ? `roomCode=${snapshot.roomCode}` : '',
    desc: count ? `当前 ${count} 人，点击加入。` : '点击加入房间。',
  };
}

function buildHomeShareMessage(roomCode) {
  return {
    title: COPY.APP_TITLE,
    path: buildSharePath(roomCode),
    imageUrl: '',
    desc: '扫码或点开后可直接进入房间。',
  };
}

module.exports = {
  shareService: {
    buildSharePath,
    buildRoomShareMessage,
    buildHomeShareMessage,
  },
};

