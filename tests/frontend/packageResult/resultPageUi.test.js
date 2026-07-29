const assert = require("assert");
const fs = require("fs");
const path = require("path");

const resultPageDirectory = path.resolve(__dirname, "../../../frontend/packageResult/pages/result");
const markup = fs.readFileSync(path.join(resultPageDirectory, "index.wxml"), "utf8");
const script = fs.readFileSync(path.join(resultPageDirectory, "index.js"), "utf8");
const styles = fs.readFileSync(path.join(resultPageDirectory, "index.wxss"), "utf8");

assert.match(markup, /class="back-control"[^>]*bindtap="onBackHome"/, "result page must keep its home action");
assert.doesNotMatch(markup, /rules-control|onTapRules/, "result page must not render a rules action");
assert.doesNotMatch(script, /onTapRules\s*\(/, "result page must not retain a rules handler");
assert.doesNotMatch(
  script,
  /packageRoom\/pages\/rules\/index/,
  "result page must not retain a rules-page navigation route",
);
assert.doesNotMatch(styles, /\.rules-control\s*\{/, "result page must not retain rules-action styles");
assert.match(markup, /item\.legislativeReview\.lines/, "timeline must render legislative detail lines");
assert.match(markup, /wx:for-item="reviewLine"/, "timeline must render each legislative detail with timeline body styling");
assert.doesNotMatch(markup, /timeline-legislative-review|本轮立法牌面/, "result page must not render a legislative review container or title");
assert.doesNotMatch(styles, /timeline-legislative|\.legislative-history/, "legislative details must not add a separate container or border");
assert.doesNotMatch(markup, /showLegislativeHistory|result\.legislativeHistory|legislative-history-section/, "result page must not render a standalone legislative section");
assert.doesNotMatch(markup, /presidentSeen|chancellorSeen|看到的牌/, "result page must not render seen-card fields");
assert.match(markup, /item\.voteGroupRows/, "result timeline should render grouped vote rows");
assert.match(markup, /\{\{voteItem\.lineText\}\}/, "result timeline should render each vote group as one body line");
assert.doesNotMatch(
  markup,
  /item\.voteRows|timeline-vote-cell|class="\{\{voteItem\.rowClass\}\}"|timeline-vote-label|timeline-vote-members/,
  "result timeline should remove per-seat ballot cells, vote cards, and separate vote headings",
);
assert.match(styles, /\.timeline-vote-groups/);
assert.match(styles, /\.timeline-vote-line/);
assert.match(styles, /white-space:\s*pre-line/, "result timeline should preserve chaos policy as a new line");
assert.doesNotMatch(
  styles,
  /\.timeline-vote-cell|\.timeline-vote-mark|timeline-vote-groups \.vote-group-row|\.timeline-vote-label|\.timeline-vote-members/,
);

console.log("result page UI tests passed");
