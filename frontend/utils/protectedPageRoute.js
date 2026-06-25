function normalizeUrl(url) {
  const value = String(url || "");
  return value.charAt(0) === "/" ? value : `/${value}`;
}

function buildPageUrl(pagePath, query = {}) {
  const params = Object.keys(query)
    .filter((key) => query[key] !== undefined && query[key] !== null && String(query[key]) !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(query[key]))}`)
    .join("&");
  return `${normalizeUrl(pagePath)}${params ? `?${params}` : ""}`;
}

function canReLaunch() {
  return typeof wx !== "undefined" && wx && typeof wx.reLaunch === "function";
}

function reLaunchPage(url) {
  if (!canReLaunch()) {
    return false;
  }

  wx.reLaunch({
    url: normalizeUrl(url),
  });
  return true;
}

function reLaunchIfPageStacked(url, page, flagName = "__isResettingPageStack") {
  if (typeof getCurrentPages !== "function") {
    return false;
  }

  const pages = getCurrentPages();
  if (!Array.isArray(pages) || pages.length <= 1 || !canReLaunch()) {
    return false;
  }

  if (page && flagName) {
    page[flagName] = true;
  }
  wx.reLaunch({
    url: normalizeUrl(url),
  });
  return true;
}

module.exports = {
  buildPageUrl,
  reLaunchIfPageStacked,
  reLaunchPage,
};
