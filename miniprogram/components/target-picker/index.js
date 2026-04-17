Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    targets: {
      type: Array,
      value: [],
    },
    title: {
      type: String,
      value: '选择目标',
    },
    danger: {
      type: Boolean,
      value: false,
    },
    submitting: {
      type: Boolean,
      value: false,
    },
    confirmLabel: {
      type: String,
      value: '确认目标',
    },
    cancelLabel: {
      type: String,
      value: '取消',
    },
  },
  data: {
    selectedId: '',
  },
  observers: {
    visible(value) {
      if (!value) {
        this.setData({ selectedId: '' });
      }
    },
  },
  methods: {
    selectTarget(e) {
      const targetId = e.currentTarget.dataset.memberId;
      this.setData({ selectedId: targetId });
      const target = this.data.targets.find((item) => item.memberId === targetId);
      this.triggerEvent('select', { target });
    },
    confirmTarget() {
      if (!this.data.selectedId) return;
      const target = this.data.targets.find((item) => item.memberId === this.data.selectedId);
      this.triggerEvent('confirmtarget', { target });
    },
    cancel() {
      this.setData({ selectedId: '' });
      this.triggerEvent('cancel');
    },
  },
});
