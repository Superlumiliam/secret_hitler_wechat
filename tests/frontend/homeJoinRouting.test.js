const assert = require("assert");
const path = require("path");

function loadHomePage() {
  const pagePath = path.resolve(__dirname, "../../frontend/pages/home/index.js");
  const profileStorePath = path.resolve(__dirname, "../../frontend/utils/userProfileStore.js");
  let pageDefinition = null;
  global.Page = (definition) => {
    pageDefinition = definition;
  };
  delete require.cache[profileStorePath];
  delete require.cache[pagePath];
  require(pagePath);
  return pageDefinition;
}

function createContext(page) {
  return {
    ...page,
    data: {
      ...page.data,
      joinCode: "654321",
      joinDialogVisible: true,
      isJoining: false,
    },
    setData(update) {
      this.data = { ...this.data, ...update };
    },
    uploadRoomAvatarIfNeeded: async () => "",
  };
}

async function assertRoomCodeJoinRoutesByServerHint() {
  const reLaunches = [];
  const redirects = [];
  let nextRoom = null;
  global.wx = {
    getStorage({ success }) {
      success({
        data: {
          profileCompleted: true,
          displayName: "房间码用户",
          avatarUrl: "",
        },
      });
    },
    cloud: {
      callFunction: async ({ name, data }) => {
        assert.strictEqual(name, "roomService");
        assert.strictEqual(data.action, "joinRoom");
        assert.strictEqual(data.payload.roomCode, "654321");
        return {
          result: {
            success: true,
            data: nextRoom,
          },
        };
      },
    },
    reLaunch({ url }) {
      reLaunches.push(url);
    },
    redirectTo({ url }) {
      redirects.push(url);
    },
    showToast() {},
  };
  global.getApp = () => ({
    globalData: {
      initialLobbySnapshots: {},
    },
  });

  const home = loadHomePage();
  nextRoom = {
    roomId: "room_in_game",
    memberId: "mem_late_spectator",
    memberType: "spectator",
    roomStatus: "in_game",
    routeHint: "board",
  };
  await home.onJoinRoom.call(createContext(home));
  assert.strictEqual(
    reLaunches[0],
    "/packageRoom/pages/board/index?roomId=room_in_game",
  );
  assert.strictEqual(redirects.length, 0);

  nextRoom = {
    roomId: "room_lobby",
    memberId: "mem_spectator",
    memberType: "spectator",
    roomStatus: "lobby",
    routeHint: "lobby",
    lobbySnapshot: {},
  };
  await home.onJoinRoom.call(createContext(home));
  assert.strictEqual(
    redirects[0],
    "/packageRoom/pages/lobby/index?roomId=room_lobby&memberId=mem_spectator&joinedAs=spectator",
  );
}

assertRoomCodeJoinRoutesByServerHint()
  .then(() => {
    console.log("home join routing tests passed");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
