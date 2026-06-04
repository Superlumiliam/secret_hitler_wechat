const CLOUD_ASSET_ROOT =
  "cloud://cloud1-9gcbbsjv4ce11da4.636c-cloud1-9gcbbsjv4ce11da4-1421865979/processed_images/";

const FASCIST_POWER_MAP = {
  5: ["无", "无", "政策预览", "处决", "处决"],
  6: ["无", "无", "政策预览", "处决", "处决"],
  7: ["无", "调查忠诚", "特别选举", "处决", "处决"],
  8: ["无", "调查忠诚", "特别选举", "处决", "处决"],
  9: ["调查忠诚", "调查忠诚", "特别选举", "处决", "处决"],
  10: ["调查忠诚", "调查忠诚", "特别选举", "处决", "处决"],
};

const POLICY_TRACK_ASSET_FILE_IDS = {
  liberalBg: `${CLOUD_ASSET_ROOT}policy-track-liberal-bg.webp`,
  authoritarianBg: `${CLOUD_ASSET_ROOT}policy-track-authoritarian-bg.webp`,
  liberalCard: `${CLOUD_ASSET_ROOT}policy-card-liberal.webp`,
  authoritarianCard: `${CLOUD_ASSET_ROOT}policy-card-authoritarian.webp`,
  liberalSlot: `${CLOUD_ASSET_ROOT}slot-empty-liberal.webp`,
  authoritarianSlot: `${CLOUD_ASSET_ROOT}slot-empty-authoritarian.webp`,
  execution: `${CLOUD_ASSET_ROOT}power-badge-execution.webp`,
  investigate: `${CLOUD_ASSET_ROOT}power-badge-investigate.webp`,
  policyPeek: `${CLOUD_ASSET_ROOT}power-badge-policy-peek.webp`,
  specialElection: `${CLOUD_ASSET_ROOT}power-badge-special-election.webp`,
  playerSeat: `${CLOUD_ASSET_ROOT}player-seat.webp`,
  playerSeatHitler: `${CLOUD_ASSET_ROOT}player-seat-hitler.webp`,
  playerTabletPresident: `${CLOUD_ASSET_ROOT}player-tablet-president.webp`,
  playerTabletMinister: `${CLOUD_ASSET_ROOT}player-tablet-minister.webp`,
  stampFascist: `${CLOUD_ASSET_ROOT}stamp-fascist.webp`,
  stampLiberal: `${CLOUD_ASSET_ROOT}stamp-liberal.webp`,
  identityFascist: `${CLOUD_ASSET_ROOT}identity-fascist.webp`,
  identityHitler: `${CLOUD_ASSET_ROOT}identity-hitler.webp`,
  identityLiberal: `${CLOUD_ASSET_ROOT}identity-liberal.webp`,
  liberalBadge: `${CLOUD_ASSET_ROOT}icon-liberal-badge.webp`,
  authoritarianBadge: `${CLOUD_ASSET_ROOT}icon-authoritarian-badge.webp`,
  frameNarrow: `${CLOUD_ASSET_ROOT}frame-narrow.webp`,
  buttonNormal: `${CLOUD_ASSET_ROOT}button-normal.webp`,
  buttonBlue: `${CLOUD_ASSET_ROOT}button-blue.webp`,
  buttonRed: `${CLOUD_ASSET_ROOT}button-red.webp`,
  nominationButtonFrame: `${CLOUD_ASSET_ROOT}nomination-button-frame.webp`,
  nominationButtonFrameBlue: `${CLOUD_ASSET_ROOT}nomination-button-frame-blue.webp`,
  modalFrameMobile: `${CLOUD_ASSET_ROOT}modal-frame-mobile.webp`,
  modalFrameButtonMobile: `${CLOUD_ASSET_ROOT}modal-frame-button-mobile.webp`,
  modalCancelButtonMobile: `${CLOUD_ASSET_ROOT}modal-cancel-button-mobile.webp`,
  defaultAvatar: `${CLOUD_ASSET_ROOT}man-in-black.webp`,
  electionTrackBg: `${CLOUD_ASSET_ROOT}election-track-bg.webp`,
  electionSlotEmpty: `${CLOUD_ASSET_ROOT}election-slot-empty.webp`,
  electionSlotActive: `${CLOUD_ASSET_ROOT}election-slot-active.webp`,
  drawPileBg: `${CLOUD_ASSET_ROOT}card-bg.webp`,
  discardPileBg: `${CLOUD_ASSET_ROOT}discard-bg.webp`,
  drawPileCard: `${CLOUD_ASSET_ROOT}card.webp`,
  discardPileCard: `${CLOUD_ASSET_ROOT}discard.webp`,
  logoSeal: `${CLOUD_ASSET_ROOT}logo-seal.webp`,
  logoRule: `${CLOUD_ASSET_ROOT}logo-rule.webp`,
};

const POWER_BADGE_ASSET_KEY_MAP = {
  政策预览: "policyPeek",
  调查忠诚: "investigate",
  特别选举: "specialElection",
  处决: "execution",
};

function createLiberalTrack(liberalPolicyCount, assets = {}, newPolicySlot = 0) {
  return Array.from({ length: 5 }, (_, index) => {
    const slot = index + 1;
    const isVictory = slot === 5;
    const isEnacted = slot <= liberalPolicyCount;
    const cardSrc = isEnacted ? assets.liberalCard : assets.liberalSlot;

    return {
      slot,
      label: isVictory ? "自由派胜利" : String(slot),
      isVictory,
      isEnacted,
      cardSrc,
      cellClass: [
        "policy-cell",
        "liberal-cell",
        isEnacted ? "is-enacted" : "is-empty",
        slot === newPolicySlot ? "is-new-policy" : "",
        isVictory ? "is-victory" : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  });
}

function createFascistTrack(targetPlayerCount, fascistPolicyCount, assets = {}, newPolicySlot = 0) {
  const powers = FASCIST_POWER_MAP[targetPlayerCount] || FASCIST_POWER_MAP[6];

  return Array.from({ length: 6 }, (_, index) => {
    const slot = index + 1;
    const isVictory = slot === 6;
    const isEnacted = slot <= fascistPolicyCount;
    const power = isVictory ? "极权派胜利" : powers[index];
    const powerBadgeAssetKey = POWER_BADGE_ASSET_KEY_MAP[power] || "";
    const cardSrc = isEnacted ? assets.authoritarianCard : assets.authoritarianSlot;

    return {
      slot,
      label: isVictory ? "极权派胜利" : String(slot),
      power,
      powerBadgeSrc: powerBadgeAssetKey ? assets[powerBadgeAssetKey] : "",
      isEnacted,
      isVictory,
      cardSrc,
      cellClass: [
        "policy-cell",
        "fascist-cell",
        isEnacted ? "is-enacted" : "is-empty",
        slot === newPolicySlot ? "is-new-policy" : "",
        isVictory ? "is-victory" : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  });
}

module.exports = {
  FASCIST_POWER_MAP,
  POLICY_TRACK_ASSET_FILE_IDS,
  POWER_BADGE_ASSET_KEY_MAP,
  createFascistTrack,
  createLiberalTrack,
};
