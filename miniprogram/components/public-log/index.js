Component({
  properties: {
    items: {
      type: Array,
      value: [],
    },
    title: {
      type: String,
      value: '公开日志',
    },
    collapsedCount: {
      type: Number,
      value: 8,
    },
    emptyText: {
      type: String,
      value: '暂无公开事件',
    },
  },
  data: {
    expanded: false,
    displayItems: [],
  },
  observers: {
    items(items) {
      this.refreshDisplayItems(items, this.data.expanded, this.data.collapsedCount);
    },
    expanded(expanded) {
      this.refreshDisplayItems(this.data.items, expanded, this.data.collapsedCount);
    },
    collapsedCount(count) {
      this.refreshDisplayItems(this.data.items, this.data.expanded, count);
    },
  },
  methods: {
    refreshDisplayItems(items, expanded, collapsedCount) {
      const source = items || [];
      const displayItems = expanded ? source : source.slice(0, collapsedCount);
      this.setData({ displayItems });
    },
    toggleExpand() {
      this.setData({
        expanded: !this.data.expanded,
      });
      this.triggerEvent('expand', {
        expanded: this.data.expanded,
      });
    },
  },
});
