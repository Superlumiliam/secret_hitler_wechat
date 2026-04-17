Component({
  properties: {
    status: {
      type: String,
      value: 'idle',
    },
    text: {
      type: String,
      value: '',
    },
    retryText: {
      type: String,
      value: '重试',
    },
  },
  methods: {
    retry() {
      this.triggerEvent('retry', {});
    },
  },
});
