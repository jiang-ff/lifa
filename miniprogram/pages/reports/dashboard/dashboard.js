const app = getApp()

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

Page({
  data: {
    loading: true,
    noPermission: false,
    period: "month",
    dateLabel: "",
    summary: { totalRecharge: 0, totalConsume: 0, totalNet: 0, newMembers: 0, totalMembers: 0, totalVisits: 0 },
    daily: [],
    topMembers: []
  },

  async onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: "/pages/reports/dashboard/dashboard" })
    }
    await this.loadStats()
  },

  async onPullDownRefresh() {
    await this.loadStats()
    wx.stopPullDownRefresh()
  },

  async loadStats() {
    this.setData({ loading: true })
    try {
      const shop = await app.ensureShopContext()
      if (!shop?.canViewReport) {
        this.setData({
          noPermission: true,
          loading: false,
          daily: [],
          topMembers: [],
          summary: { totalRecharge: 0, totalConsume: 0, totalNet: 0, newMembers: 0, totalMembers: 0, totalVisits: 0 }
        })
        return
      }

      const res = await wx.cloud.callFunction({
        name: "reportService",
        data: {
          action: "getStats",
          period: this.data.period
        }
      })
      const result = res?.result
      if (!result || result.ok !== true) {
        throw new Error(result?.message || "stats_failed")
      }

      const data = result.data || {}
      const start = new Date(data.start)
      const end = new Date(data.end)

      this.setData({
        noPermission: false,
        summary: {
          totalRecharge: data.summary?.totalRecharge || 0,
          totalConsume: data.summary?.totalConsume || 0,
          totalNet: data.summary?.totalNet || 0,
          newMembers: data.summary?.newMembers || 0,
          totalMembers: data.summary?.totalMembers || 0,
          totalVisits: data.summary?.totalVisits || 0
        },
        daily: data.daily || [],
        topMembers: data.topMembers || [],
        dateLabel: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")} ~ ${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`
      })
    } catch (err) {
      this.setData({ noPermission: false })
      wx.showToast({ title: "加载报表失败", icon: "none" })
    } finally {
      this.setData({ loading: false })
    }
  },

  async setPeriod(e) {
    const period = e.currentTarget.dataset.period
    if (!period || period === this.data.period) return
    this.setData({ period }, () => this.loadStats())
  }
})
