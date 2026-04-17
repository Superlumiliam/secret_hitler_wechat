Component({
  properties: {
    task: {
      type: Object,
      value: null,
    },
    submitting: {
      type: Boolean,
      value: false,
    },
  },
  methods: {
    openTask() {
      if (!this.data.task) return;
      this.triggerEvent('open', this.data.task);
    },
  },
});
