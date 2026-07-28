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

console.log("result page UI tests passed");
