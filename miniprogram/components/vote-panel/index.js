Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    submitting: {
      type: Boolean,
      value: false,
    },
    title: {
      type: String,
      value: '投票',
    },
    description: {
      type: String,
      value: '',
    },
  },
  data: {
    selectedVote: '',
  },
  observers: {
    visible(value) {
      if (!value) {
        this.setData({ selectedVote: '' });
      }
    },
  },
  methods: {
    chooseVote(e) {
      const vote = e.currentTarget.dataset.vote;
      this.setData({ selectedVote: vote });
      this.triggerEvent('select', { vote });
    },
    confirmVote() {
      if (!this.data.selectedVote) return;
      this.triggerEvent('confirmvote', { vote: this.data.selectedVote });
    },
    cancel() {
      this.setData({ selectedVote: '' });
      this.triggerEvent('cancel');
    },
  },
});
