const assert = require("assert");
const fs = require("fs");
const path = require("path");

const boardDirectory = path.resolve(__dirname, "../../../frontend/packageRoom/pages/board");
const historyDirectory = path.resolve(__dirname, "../../../frontend/packageRoom/pages/history");
const boardMarkup = fs.readFileSync(path.join(boardDirectory, "index.wxml"), "utf8");
const boardStyles = fs.readFileSync(path.join(boardDirectory, "index.wxss"), "utf8");
const historyMarkup = fs.readFileSync(path.join(historyDirectory, "index.wxml"), "utf8");
const historyStyles = fs.readFileSync(path.join(historyDirectory, "index.wxss"), "utf8");

assert.match(boardMarkup, /voteResult\.voteGroupRows/, "vote result modal should render grouped vote rows");
assert.match(boardMarkup, /policyAssets\.voteResultPanel/, "vote result modal should use the dedicated notice-board asset");
assert.match(boardMarkup, /item\.memberCards/, "vote result modal should render seat cards");
assert.match(boardMarkup, /memberCard\.label/, "vote result modal should use short seat labels");
assert.doesNotMatch(boardMarkup, /item\.memberText/, "vote result modal should not render long player text");
assert.doesNotMatch(boardMarkup, /voteResult\.voteRows|vote-reveal-item/, "vote result modal should remove ballot cards");
assert.match(boardStyles, /\.vote-group-row\.is-ja \.vote-group-label/);
assert.match(boardStyles, /\.vote-group-row\.is-nein \.vote-group-label/);
assert.match(boardStyles, /\.vote-group-member-card/);
assert.match(boardStyles, /\.vote-result-modal\.is-passed \.vote-result-title[\s\S]*color:\s*#0f5c60/);
assert.match(boardStyles, /\.vote-result-modal\.is-failed \.vote-result-title[\s\S]*color:\s*#8b2d23/);

assert.match(historyMarkup, /已进行轮次/);
assert.match(historyMarkup, /自由派/);
assert.match(historyMarkup, /极权派/);
assert.match(historyMarkup, /选举计数器/);
assert.match(historyMarkup, /item\.roundTitle/);
assert.match(historyMarkup, /item\.governmentResultText/);
assert.match(historyMarkup, /item\.detailRows/);
assert.match(historyMarkup, /detailRow\.playerCards/);
assert.doesNotMatch(
  historyMarkup,
  /item\.votes|item\.voteGroupRows|round-medal|showPolicyBadge|executiveResultText|class="legend"/,
  "history should remove the previous round layout",
);
assert.match(historyStyles, /\.round-list::before/);
assert.match(historyStyles, /\.round-board::before/);
assert.match(historyStyles, /\.round-result-badge\.is-passed/);
assert.match(historyStyles, /\.round-result-badge\.is-failed/);
assert.match(historyStyles, /\.round-result-badge\s*\{[^}]*transform:\s*translateY\(10rpx\)/s);
assert.match(historyStyles, /\.history-detail-label\.is-president/);
assert.match(historyStyles, /\.history-detail-label\.is-chancellor/);
assert.match(historyStyles, /\.history-player-card/);
assert.doesNotMatch(historyStyles, /\.vote-cell|\.legend-dot|\.round-medal/);

console.log("room vote group UI tests passed");
