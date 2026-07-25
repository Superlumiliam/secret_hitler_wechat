const assert = require("assert");
const path = require("path");

function loadCreateRoomPage() {
  const pagePath = path.resolve(__dirname, "../../frontend/pages/create-room/index.js");
  let pageDefinition = null;
  global.Page = (definition) => {
    pageDefinition = definition;
  };
  delete require.cache[pagePath];
  require(pagePath);
  return pageDefinition;
}

(async () => {
  const page = loadCreateRoomPage();
  let toastTitle = "";
  let requestCount = 0;
  global.wx = {
    showToast({ title }) {
      toastTitle = title;
    },
  };
  const context = {
    ...page,
    data: {
      ...page.data,
      mode: "roomSettings",
      roomId: "room_1",
      selectedCount: 5,
      seatedPlayerCount: 3,
      highestOccupiedSeatIndex: 6,
      isSubmitting: false,
      isLoadingSettings: false,
    },
    callRoomService: async () => {
      requestCount += 1;
    },
    setData(update) {
      this.data = { ...this.data, ...update };
    },
  };

  await page.onCompleteRoomSettings.call(context);
  assert.strictEqual(requestCount, 0, "room settings must not submit below the highest occupied seat");
  assert.strictEqual(toastTitle, "选择人数不能小于当前最高座位号");
  console.log("room settings highest seat limit test passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
