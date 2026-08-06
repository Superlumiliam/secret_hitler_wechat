const assert = require("assert");
const path = require("path");

function loadUserProfilePage() {
  const pagePath = path.resolve(__dirname, "../../frontend/pages/user-profile/index.js");
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

function createContext(page, data = {}) {
  return {
    ...page,
    data: {
      ...page.data,
      ...data,
    },
    setData(update) {
      this.data = { ...this.data, ...update };
    },
  };
}

async function assertPageRefreshesAuthoritativeStats() {
  const calls = [];
  global.wx = {
    cloud: {
      async callFunction(options) {
        calls.push(options);
        return {
          result: {
            success: true,
            data: {
              multiplayerGameCount: 8,
              multiplayerWinCount: 5,
              multiplayerLossCount: 3,
              liberalWinCount: 2,
              fascistWinCount: 3,
            },
          },
        };
      },
    },
  };
  const page = loadUserProfilePage();
  const context = createContext(page);

  await page.onShow.call(context);

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].name, "bootstrapService");
  assert.strictEqual(calls[0].data.action, "getPersonalStats");
  assert.deepStrictEqual(
    context.data.personalStats.map((item) => item.value),
    [8, "63%", 2, 3],
  );
}

async function assertProfileSaveDoesNotCopyStats() {
  let savedProfile = null;
  global.wx = {
    getStorageSync() {
      return {
        profileCompleted: true,
        displayName: "旧名字",
        multiplayerGameCount: 99,
        multiplayerWinCount: 99,
      };
    },
    setStorage({ data, success }) {
      savedProfile = data;
      success();
    },
    showToast() {},
    reLaunch() {},
  };
  const page = loadUserProfilePage();
  const context = createContext(page, {
    avatarUrl: "avatar.png",
    avatarDirty: false,
    isSaving: false,
    redirect: "",
  });

  await page.onSubmitProfile.call(context, {
    detail: {
      value: {
        displayName: "新名字",
      },
    },
  });

  assert(savedProfile);
  for (const field of [
    "multiplayerGameCount",
    "multiplayerWinCount",
    "multiplayerLossCount",
    "liberalWinCount",
    "fascistWinCount",
  ]) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(savedProfile, field), false, `${field} must stay server-owned`);
  }
}

(async () => {
  await assertPageRefreshesAuthoritativeStats();
  await assertProfileSaveDoesNotCopyStats();
  console.log("user profile stats tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
