const assert = require("assert");
const { createVoteGroupRows } = require("../../frontend/packageRoom/utils/voteGroups");

const members = [
  { memberId: "mem_3", seatIndex: 3 },
  { memberId: "mem_1", seatIndex: 1 },
  { memberId: "mem_2", seatIndex: 2 },
];

const groupedRows = createVoteGroupRows(
  {
    jaMemberIds: ["mem_3", "mem_1"],
    neinMemberIds: ["mem_2"],
  },
  members,
);

assert.deepStrictEqual(
  groupedRows.map((row) => ({
    key: row.key,
    label: row.label,
    memberText: row.memberText,
  })),
  [
    { key: "ja", label: "赞同", memberText: "1号玩家、3号玩家" },
    { key: "nein", label: "反对", memberText: "2号玩家" },
  ],
  "vote group rows should use seat labels in ascending order",
);
assert.deepStrictEqual(groupedRows[0].memberCards.map((member) => member.label), ["1号", "3号"]);

const unanimousRows = createVoteGroupRows(
  {
    jaMemberIds: ["mem_1", "mem_2", "mem_3"],
    neinMemberIds: [],
  },
  members,
);
assert.strictEqual(unanimousRows[1].memberText, "无", "empty vote groups should render as 无");

console.log("vote group formatter tests passed");
