const { ROUTE, ROUTE_HINT } = require('../constants/route');
const { ROOM_STATUS, PHASE } = require('../constants/phase');

function resolveRouteBySnapshot(snapshot) {
  if (!snapshot) {
    return ROUTE.HOME;
  }
  if (snapshot.roomStatus === ROOM_STATUS.EXPIRED) {
    return ROUTE.HOME;
  }
  if (snapshot.roomStatus === ROOM_STATUS.LOBBY || snapshot.routeHint === ROUTE_HINT.LOBBY) {
    return ROUTE.LOBBY;
  }
  if (snapshot.roomStatus === ROOM_STATUS.ENDED || snapshot.currentPhase === PHASE.GAME_ENDED || snapshot.routeHint === ROUTE_HINT.RESULT) {
    return ROUTE.RESULT;
  }
  if (snapshot.currentPhase === PHASE.ROLE_REVEAL || snapshot.routeHint === ROUTE_HINT.IDENTITY) {
    return ROUTE.IDENTITY;
  }
  return ROUTE.BOARD;
}

function redirectToRoute(route, query) {
  const url = buildUrl(route, query);
  wx.redirectTo({ url });
}

function reLaunchToRoute(route, query) {
  const url = buildUrl(route, query);
  wx.reLaunch({ url });
}

function navigateToRoute(route, query) {
  const url = buildUrl(route, query);
  wx.navigateTo({ url });
}

function buildUrl(route, query) {
  const params = query
    ? Object.keys(query)
        .filter((key) => query[key] !== undefined && query[key] !== null && query[key] !== '')
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
        .join('&')
    : '';
  return params ? `${route}?${params}` : route;
}

function navigateBySnapshot(snapshot, behavior) {
  const route = resolveRouteBySnapshot(snapshot);
  if (behavior === 'relaunch') {
    reLaunchToRoute(route);
    return;
  }
  if (behavior === 'redirect') {
    redirectToRoute(route);
    return;
  }
  navigateToRoute(route);
}

module.exports = {
  resolveRouteBySnapshot,
  redirectToRoute,
  reLaunchToRoute,
  navigateToRoute,
  buildUrl,
  navigateBySnapshot,
};

