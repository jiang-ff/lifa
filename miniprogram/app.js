const {
  listEnvProfiles,
  resolveRuntimeEnv,
  persistRuntimeEnvProfile,
  clearRuntimeEnvProfile
} = require("./config/env")

App({
  onLaunch() {
    if (!wx.cloud) {
      wx.showToast({ title: "请使用支持云开发的基础库", icon: "none" })
      return
    }

    this.initializeCloud()
  },

  globalData: {
    shopContext: null,
    runtimeEnv: null,
    runtimeProfiles: []
  },

  initializeCloud(options = {}) {
    const runtimeEnv = resolveRuntimeEnv({ profile: options.profile })

    wx.cloud.init({
      env: runtimeEnv.cloudEnvId,
      traceUser: true
    })

    this.globalData.runtimeEnv = runtimeEnv
    this.globalData.runtimeProfiles = listEnvProfiles()
    this.globalData.shopContext = null
    return runtimeEnv
  },

  getRuntimeEnv() {
    return this.globalData.runtimeEnv || this.initializeCloud()
  },

  getRuntimeProfiles() {
    if (!this.globalData.runtimeProfiles || this.globalData.runtimeProfiles.length === 0) {
      this.globalData.runtimeProfiles = listEnvProfiles()
    }
    return this.globalData.runtimeProfiles
  },

  async switchRuntimeEnvProfile(profile) {
    const runtimeEnv = this.getRuntimeEnv()
    if (runtimeEnv.isRelease) {
      throw new Error("release_env_locked")
    }

    persistRuntimeEnvProfile(profile)
    return this.initializeCloud({ profile })
  },

  async resetRuntimeEnvProfile() {
    clearRuntimeEnvProfile()
    return this.initializeCloud()
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
