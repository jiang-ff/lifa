const app = getApp()

function formatTime(ts) {
  if (!ts) return "-"
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, "0")
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function avatarText(name) {
  const n = (name || "").trim()
  if (!n) return "?"
  return n.slice(0, 1)
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function normalizeMembers(list) {
  const now = Date.now()
  const THIRTY_DAYS = 30 * 86400000
  return (list || []).map((member) => {
    const balance = typeof member.balance === "number" ? member.balance : 0
    const lastVisitAt = member.lastVisitAt || 0
    const daysSinceVisit = lastVisitAt ? Math.floor((now - lastVisitAt) / 86400000) : null
    const needRemind = lastVisitAt && (now - lastVisitAt) > THIRTY_DAYS
    return {
      ...member,
      balance,
      avatarText: avatarText(member.name),
      updatedText: formatTime(member.updatedAt || member.createdAt),
      daysSinceVisit,
      needRemind
    }
  })
}

Page({
  data: {
    keyword: "",
    loading: true,
    members: [],
    membersTotal: 0,
    sortKey: "updatedAt",
    hasBalanceOnly: false,
    shop: null,
    stats: {
      totalMembers: 0,
      balanceMembers: 0,
      totalBalance: 0
    }
  },

  async onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: "/pages/members/list/list" })
    }
    await this.initializePage()
  },

  async onPullDownRefresh() {
    await this.initializePage({ forceRefresh: true })
    wx.stopPullDownRefresh()
  },

  async initializePage(options = {}) {
    this.setData({ loading: true })
    try {
      const shop = await app.ensureShopContext({ forceRefresh: !!options.forceRefresh })
      this.setData({ shop })
      await this.fetchMembers()
    } catch (err) {
      wx.showToast({ title: "加载店铺失败", icon: "none" })
    } finally {
      this.setData({ loading: false })
    }
  },

  onKeywordInput(e) {
    this.setData({ keyword: (e.detail.value || "").trim() })
  },

  onSearch() {
    this.fetchMembers()
  },

  async fetchMembers() {
    const { keyword, sortKey, hasBalanceOnly } = this.data
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: "memberService",
        data: {
          action: "listMembers",
          keyword: (keyword || "").trim(),
          sortKey,
          hasBalanceOnly
        }
      })
      const result = res?.result
      if (!result || result.ok !== true) {
        throw new Error(result?.message || "list_failed")
      }

      const members = normalizeMembers(result.data?.members)
      this.setData({
        members,
        membersTotal: result.data?.total || members.length,
        stats: {
          totalMembers: toNumber(result.data?.stats?.totalMembers),
          balanceMembers: toNumber(result.data?.stats?.balanceMembers),
          totalBalance: toNumber(result.data?.stats?.totalBalance)
        }
      })
    } catch (err) {
      wx.showToast({ title: "加载会员失败", icon: "none" })
    } finally {
      this.setData({ loading: false })
    }
  },

  setSort(e) {
    const key = e.currentTarget.dataset.key
    if (!key || key === this.data.sortKey) return
    this.setData({ sortKey: key }, () => this.fetchMembers())
  },

  toggleHasBalance() {
    this.setData({ hasBalanceOnly: !this.data.hasBalanceOnly }, () => this.fetchMembers())
  },

  goShopSettings() {
    wx.navigateTo({ url: "/pages/shop/settings/settings" })
  },

  goAdd() {
    wx.navigateTo({ url: "/pages/members/edit/edit" })
  },

  goEdit(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/members/edit/edit?id=${id}` })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/members/detail/detail?id=${id}` })
  },

  callPhone(e) {
    const phone = (e.currentTarget.dataset.phone || "").trim()
    if (!phone) {
      wx.showToast({ title: "没有手机号", icon: "none" })
      return
    }
    wx.makePhoneCall({ phoneNumber: phone })
  },

  async quickRecharge(e) {
    const id = e.currentTarget.dataset.id
    await this.adjustMemberBalance(id, "recharge")
  },

  async quickConsume(e) {
    const id = e.currentTarget.dataset.id
    await this.adjustMemberBalance(id, "consume")
  },

  async adjustMemberBalance(memberId, type) {
    if (!memberId) return
    const title = type === "recharge" ? "快速充值" : "快速消费"
    const res = await wx.showModal({
      title,
      editable: true,
      placeholderText: "输入金额，例如 100",
      confirmText: "下一步"
    })
    if (!res.confirm) return

    const amount = Math.abs(toNumber(res.content))
    if (!amount || amount <= 0) {
      wx.showToast({ title: "请输入有效金额", icon: "none" })
      return
    }

    const remarkRes = await wx.showModal({
      title: "备注（可选）",
      editable: true,
      placeholderText: "例如：充卡、洗剪吹套餐",
      confirmText: "提交"
    })
    const remark = remarkRes.confirm ? (remarkRes.content || "").trim() : ""

    try {
      const callRes = await wx.cloud.callFunction({
        name: "adjustBalance",
        data: { memberId, type, amount, remark }
      })
      const result = callRes?.result
      if (!result || result.ok !== true) {
        const msg =
          result?.message === "insufficient_balance"
            ? "余额不足"
            : result?.message === "not_found"
              ? "会员不存在"
              : result?.message === "forbidden"
                ? "不能操作其他店铺会员"
                : "余额操作失败"
        wx.showToast({ title: msg, icon: "none" })
        return
      }

      wx.showToast({ title: "已记录", icon: "success" })
      await this.fetchMembers()
    } catch (err) {
      wx.showToast({ title: "操作失败", icon: "none" })
    }
  }
})
