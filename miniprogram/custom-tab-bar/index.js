Component({
  data: {
    selected: "/pages/members/list/list",
    list: [
      { text: "会员", path: "/pages/members/list/list" },
      { text: "报表", path: "/pages/reports/dashboard/dashboard" },
      { text: "团队", path: "/pages/shop/team/team" }
    ]
  },

  methods: {
    switchTab(e) {
      const path = e.currentTarget.dataset.path
      if (path === this.data.selected) return

      wx.switchTab({
        url: path,
        fail() {
          wx.navigateTo({ url: path })
        }
      })
    }
  }
})
