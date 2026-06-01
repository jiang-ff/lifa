App({
  onLaunch() {
    if (!wx.cloud) {
      wx.showToast({ title: "请使用支持云开发的基础库", icon: "none" })
      return
    }

    wx.cloud.init({
      env: "cloud1-d6gmq1pam45528b5f",
      traceUser: true
    })
  }
})
