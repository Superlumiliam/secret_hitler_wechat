const assert = require("assert");

const pagePath = require.resolve("../../../frontend/packageRoom/pages/identity/index.js");
let pageDefinition = null;
global.Page = (definition) => {
  pageDefinition = definition;
};
delete require.cache[pagePath];
require(pagePath);

const knownMembers = pageDefinition.createKnownMembers(
  [
    {
      memberId: "member_2",
      displayName: "真实昵称",
      role: "HITLER",
      avatarUrl: "",
    },
  ],
  {},
  [{ memberId: "member_2", seatIndex: 2 }],
);

assert.strictEqual(knownMembers[0].displayName, "2号玩家");
assert.strictEqual(knownMembers[0].initial, "2");

console.log("identity page teammate labels passed");
