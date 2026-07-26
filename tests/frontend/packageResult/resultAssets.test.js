const assert = require("assert");
const path = require("path");

const resultPagePath = path.resolve(
  __dirname,
  "../../../frontend/packageResult/pages/result/index.js",
);

function loadResultPage() {
  let definition = null;
  global.Page = (pageDefinition) => {
    definition = pageDefinition;
  };
  delete require.cache[resultPagePath];
  require(resultPagePath);
  return definition;
}

function createPlayers(playerCount) {
  return Array.from({ length: playerCount }, (_, index) => ({
    memberId: `mem_${index + 1}`,
    avatarUrl: `cloud://room_assets/player-${index + 1}.webp`,
  }));
}

function createPageContext(page) {
  return {
    ...page,
    data: {
      ...page.data,
      policyAssets: {},
      resultAssetSrcByKey: {},
    },
  };
}

function installCloudMock(requestSizes) {
  global.wx = {
    cloud: {
      async getTempFileURL({ fileList }) {
        requestSizes.push(fileList.length);
        assert(fileList.length <= 50, "each temporary URL request must stay within the cloud API limit");
        return {
          fileList: fileList.map((fileID) => ({
            fileID,
            status: 0,
            tempFileURL: `https://temp.example/${encodeURIComponent(fileID)}`,
          })),
        };
      },
    },
  };
}

async function assertNormalTenPlayerAssetsResolve() {
  const requestSizes = [];
  installCloudMock(requestSizes);
  const page = loadResultPage();
  const hydrated = await page.hydrateResultAssets.call(createPageContext(page), {
    finalPlayers: createPlayers(10),
  });

  assert.deepStrictEqual(requestSizes, [30], "result page should only request its 20 fixed assets and 10 avatars");
  assert(hydrated.policyAssets.liberalBg, "liberal policy track background should resolve");
  assert(hydrated.policyAssets.authoritarianCard, "authoritarian policy card should resolve");
  assert(hydrated.resultAssets["result-success-liberal"], "result story image should resolve");
  assert(hydrated.resultAssets["result-role-chip-dictator"], "identity role chip should resolve");
  assert(
    hydrated.finalPlayers.every((player) => player.avatarUrl.indexOf("https://temp.example/") === 0),
    "all player avatars should resolve",
  );
}

async function assertOversizedInputsAreBatched() {
  const requestSizes = [];
  installCloudMock(requestSizes);
  const page = loadResultPage();
  const hydrated = await page.hydrateResultAssets.call(createPageContext(page), {
    finalPlayers: createPlayers(40),
  });

  assert.deepStrictEqual(requestSizes, [50, 10], "future oversized inputs should be split into safe batches");
  assert(
    hydrated.finalPlayers.every((player) => player.avatarUrl.indexOf("https://temp.example/") === 0),
    "assets from every batch should be merged",
  );
}

(async () => {
  try {
    await assertNormalTenPlayerAssetsResolve();
    await assertOversizedInputsAreBatched();
    console.log("result asset hydration tests passed");
  } finally {
    delete global.Page;
    delete global.wx;
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
