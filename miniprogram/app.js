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
  },

  globalData: {
    shopContext: null
  },

  async ensureShopContext(options = {}) {
    const forceRefresh = !!options.forceRefresh
    const cached = this.globalData.shopContext
    if (!forceRefresh && cached && cached.shopId) {
      return cached
    }

    const res = await wx.cloud.callFunction({
      name: "shopService",
      data: { action: "getContext" }
    })
    const result = res?.result
    if (!result || result.ok !== true || !result.data?.shopId) {
      throw new Error(result?.message || "shop_context_failed")
    }

    this.globalData.shopContext = result.data
    return result.data
  },

  async refreshShopContext() {
    return this.ensureShopContext({ forceRefresh: true })
  },

  async updateShopProfile(profile) {
    const res = await wx.cloud.callFunction({
      name: "shopService",
      data: {
        action: "updateProfile",
        profile
      }
    })
    const result = res?.result
    if (!result || result.ok !== true || !result.data?.shopId) {
      throw new Error(result?.message || "update_shop_failed")
    }

    this.globalData.shopContext = result.data
    return result.data
  }
})
