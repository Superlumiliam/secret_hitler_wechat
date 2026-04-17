const { RULE_SECTIONS } = require('../../../static/rulesContent');
const { COPY } = require('../../../constants/copy');
const { ROUTE } = require('../../../constants/route');
const { navigateToRoute, reLaunchToRoute } = require('../../../utils/router');

Page({
  data: {
    sections: RULE_SECTIONS,
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: '局内规则' });
  },

  handleBackHome() {
    reLaunchToRoute(ROUTE.HOME);
  },

  handleOpenBoard() {
    navigateToRoute(ROUTE.BOARD);
  },

  onShareAppMessage() {
    return {
      title: COPY.APP_TITLE,
      path: '/pages/home/index',
    };
  },
});
