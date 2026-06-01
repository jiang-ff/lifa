const db = wx.cloud.database()

function formatTime(ts) {
  if (!ts) return "-"
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function avatarText(name) {
  const n = (name || "").trim()
  if (!n) return "?"
  return n.slice(0, 1)
}

Page({
  data: {
    id: "",
    loading: true,
    actionLoading: false,
    member: {},
    transactions: [],
    avatarText: "?",
    stats: {
      totalRecharge: 0,
      totalConsume: 0,
      net: 0
    }
  },

  async onLoad(options) {
    const id = options?.id || ""
    if (!id) {
      wx.showToast({ title: "缺少会员ID", icon: "none" })
      wx.navigateBack()
      return
    }
    this.setData({ id })
    await this.refreshAll()
  },

  async onPullDownRefresh() {
    await this.refreshAll()
    wx.stopPullDownRefresh()
  },

  async refreshAll() {
    this.setData({ loading: true })
    try {
      await Promise.all([this.fetchMember(), this.fetchTransactions()])
    } finally {
      this.setData({ loading: false })
    }
  },

  async fetchMember() {
    const res = await db.collection("members").doc(this.data.id).get()
    const m = res.data || {}
    this.setData({
      member: {
        ...m,
        balance: typeof m.balance === "number" ? m.balance : 0
      },
      avatarText: avatarText(m.name)
    })
  },

  async fetchTransactions() {
    const res = await db
      .collection("member_transactions")
      .where({ memberId: this.data.id })
      .orderBy("createdAt", "desc")
      .limit(30)
      .get()
    const rawList = res.data || []
    let totalRecharge = 0
    let totalConsume = 0
    let net = 0

    const list = rawList.map((t) => {
      const typeText = t.type === "recharge" ? "充值" : t.type === "consume" ? "消费" : "调整"
      const amountNum = toNumber(t.amount)
      const amountText = `${amountNum >= 0 ? "+" : ""}${amountNum}`

      if (t.type === "recharge") totalRecharge += Math.abs(amountNum)
      if (t.type === "consume") totalConsume += Math.abs(amountNum)
      net += amountNum

      const typeChipClass =
        t.type === "recharge" ? "chip-green" : t.type === "consume" ? "chip-red" : "chip-gray"

      return {
        ...t,
        typeText,
        typeChipClass,
        amountText,
        amountClass: amountNum >= 0 ? "amount-plus" : "amount-minus",
        timeText: formatTime(t.createdAt)
      }
    })

    this.setData({
      transactions: list,
      stats: {
        totalRecharge,
        totalConsume,
        net: net >= 0 ? `+${net}` : `${net}`
      }
    })
  },

  goEdit() {
    wx.navigateTo({ url: `/pages/members/edit/edit?id=${this.data.id}` })
  },

  callPhone() {
    const phone = (this.data.member?.phone || "").trim()
    if (!phone) {
      wx.showToast({ title: "没有手机号", icon: "none" })
      return
    }
    wx.makePhoneCall({ phoneNumber: phone })
  },

  copyPhone() {
    const phone = (this.data.member?.phone || "").trim()
    if (!phone) {
      wx.showToast({ title: "没有手机号", icon: "none" })
      return
    }
    wx.setClipboardData({ data: phone })
  },

  async onRecharge() {
    await this.adjustBalance("recharge")
  },

  async onConsume() {
    await this.adjustBalance("consume")
  },

  async onAdjust() {
    await this.adjustBalance("adjust")
  },

  async adjustBalance(type) {
    if (this.data.actionLoading) return

    const title = type === "recharge" ? "充值金额" : type === "consume" ? "消费金额" : "余额调整（可正可负）"
    const res = await wx.showModal({
      title,
      editable: true,
      placeholderText: type === "adjust" ? "比如 -20 或 100" : "请输入数字，比如 100",
      confirmText: "确定"
    })
    if (!res.confirm) return

    const amountInput = toNumber(res.content)
    const amount = type === "adjust" ? amountInput : Math.abs(amountInput)
    if (!amount || amount === 0) {
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

    this.setData({ actionLoading: true })
    try {
      const callRes = await wx.cloud.callFunction({
        name: "adjustBalance",
        data: {
          memberId: this.data.id,
          type,
          amount,
          remark
        }
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
        this.setData({ "member.balance": result.afterBalance })
      }
      wx.showToast({ title: "已记录", icon: "success" })
      const expected = typeof result?.afterBalance === "number" ? result.afterBalance : null
      await this.refreshAll()
      const actual = this.data.member?.balance
      if (typeof expected === "number" && typeof actual === "number" && actual !== expected) {
        wx.showToast({ title: "数据未同步：检查云环境是否一致", icon: "none" })
      }
    } catch (err) {
      wx.showToast({ title: "操作失败", icon: "none" })
    } finally {
      this.setData({ actionLoading: false })
    }
  }
})
