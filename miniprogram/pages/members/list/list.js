const db = wx.cloud.database()
const _ = db.command

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

Page({
  data: {
    keyword: "",
    loading: false,
    members: [],
    membersTotal: 0,
    sortKey: "updatedAt",
    hasBalanceOnly: false
  },

  onShow() {
    this.fetchMembers()
  },

  async onPullDownRefresh() {
    await this.fetchMembers()
    wx.stopPullDownRefresh()
  },

  onKeywordInput(e) {
    this.setData({ keyword: (e.detail.value || "").trim() })
  },

  onSearch() {
    this.fetchMembers()
  },

  async fetchMembers() {
    this.setData({ loading: true })
    const keyword = (this.data.keyword || "").trim()
    const sortKey = this.data.sortKey
    const hasBalanceOnly = !!this.data.hasBalanceOnly

    try {
      let query = db.collection("members")

      const conditions = []
      if (keyword) {
        const reg = db.RegExp({ regexp: keyword, options: "i" })
        conditions.push(_.or([{ name: reg }, { phone: reg }]))
      }

      if (hasBalanceOnly) {
        conditions.push({ balance: _.gt(0) })
      }

      if (conditions.length === 1) query = query.where(conditions[0])
      if (conditions.length >= 2) query = query.where(_.and(conditions))

      if (sortKey === "balance") query = query.orderBy("balance", "desc")
      if (sortKey === "name") query = query.orderBy("name", "asc")
      if (sortKey === "updatedAt") query = query.orderBy("updatedAt", "desc")

      const jobs = [query.limit(50).get()]
      if (!keyword && !hasBalanceOnly) jobs.push(db.collection("members").count())

      const [listRes, countRes] = await Promise.all(jobs)

      const members = (listRes.data || []).map((m) => {
        const balance = typeof m.balance === "number" ? m.balance : 0
        return {
          ...m,
          balance,
          avatarText: avatarText(m.name),
          updatedText: formatTime(m.updatedAt || m.createdAt)
        }
      })

      const membersTotal = countRes ? countRes.total : members.length
      this.setData({ members, membersTotal })
    } catch (err) {
      wx.showToast({ title: "加载失败", icon: "none" })
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
      placeholderText: "输入金额，比如 100",
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
      placeholderText: "比如：充值卡/洗剪吹套餐…",
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
              : "云函数版本不对"
        wx.showToast({ title: msg, icon: "none" })
        await wx.showModal({
          title: "调试信息",
          content: `返回结果：${JSON.stringify(result || null)}`,
          showCancel: false,
          confirmText: "知道了"
        })
        return
      }

      if (typeof result?.afterBalance === "number") {
        const members = (this.data.members || []).map((m) =>
          m._id === memberId ? { ...m, balance: result.afterBalance } : m
        )
        this.setData({ members })
      }

      wx.showToast({ title: "已记录", icon: "success" })
      await this.fetchMembers()
    } catch (err) {
      wx.showToast({ title: "操作失败", icon: "none" })
    }
  }
})
