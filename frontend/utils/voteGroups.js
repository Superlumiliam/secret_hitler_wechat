function createVoteGroupRows(voteGroups, members) {
  const memberById = Object.fromEntries(
    (Array.isArray(members) ? members : []).map((member) => [member.memberId, member]),
  );

  function createMemberCards(memberIds) {
    return (Array.isArray(memberIds) ? memberIds : [])
      .map((memberId) => memberById[memberId])
      .filter((member) => member && Number(member.seatIndex) > 0)
      .sort((a, b) => Number(a.seatIndex) - Number(b.seatIndex))
      .map((member) => ({
        memberId: member.memberId,
        label: `${member.seatIndex}号`,
      }));
  }

  function createGroupRow(key, label, memberIds) {
    const memberCards = createMemberCards(memberIds);
    return {
      key,
      label,
      memberCards,
      memberText: memberCards.length
        ? memberCards.map((member) => `${member.label}玩家`).join("、")
        : "无",
      rowClass: `vote-group-row is-${key}`,
    };
  }

  return [
    createGroupRow("ja", "赞同", voteGroups && voteGroups.jaMemberIds),
    createGroupRow("nein", "反对", voteGroups && voteGroups.neinMemberIds),
  ];
}

module.exports = {
  createVoteGroupRows,
};
