function formatTime(ts) {
  if (!ts) return "-"
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDate(ts) {
  if (!ts) return "暂无记录"
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function daysAgo(ts) {
  if (!ts) return 999
  return Math.floor((Date.now() - ts) / 86400000)
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

const REPURCHASE_THRESHOLD = 30

Page({
  data: {
    id: "",
    loading: true,
    actionLoading: false,
    visitLoading: false,
    member: {},
    transactions: [],
    avatarText: "?",
    visitCount: 0,
    lastVisitText: "暂无记录",
    repurchaseAlert: "",
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
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().hide()
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
      const res = await wx.cloud.callFunction({
        name: "memberService",
        data: {
          action: "getMemberDetail",
          memberId: this.data.id
        }
      })
      const result = res?.result
      if (!result || result.ok !== true) {
        throw new Error(result?.message || "detail_failed")
      }

      const member = result.data?.member || {}
      const rawTransactions = result.data?.transactions || []
      const transactions = rawTransactions.map((t) => {
        const amountNum = toNumber(t.amount)
        return {
          ...t,
          typeText: t.type === "recharge" ? "充值" : t.type === "consume" ? "消费" : "调整",
          typeChipClass:
            t.type === "recharge" ? "chip-green" : t.type === "consume" ? "chip-red" : "chip-gray",
          amountText: `${amountNum >= 0 ? "+" : ""}${amountNum}`,
          amountClass: amountNum >= 0 ? "amount-plus" : "amount-minus",
          timeText: formatTime(t.createdAt)
        }
      })

      const visitCount = toNumber(result.data?.visitCount)
      const lastVisitAt = result.data?.lastVisitAt || 0
      const lastVisitText = lastVisitAt ? formatDate(lastVisitAt) : "暂无记录"
      const sinceLastVisit = daysAgo(lastVisitAt)
      const repurchaseAlert =
        lastVisitAt && sinceLastVisit >= REPURCHASE_THRESHOLD ? sinceLastVisit : ""

      this.setData({
        member: {
          ...member,
          balance: typeof member.balance === "number" ? member.balance : 0
        },
        avatarText: avatarText(member.name),
        transactions,
        visitCount,
        lastVisitText,
        repurchaseAlert,
        stats: {
          totalRecharge: toNumber(result.data?.stats?.totalRecharge),
          totalConsume: toNumber(result.data?.stats?.totalConsume),
          net: toNumber(result.data?.stats?.net)
        }
      })
    } catch (err) {
      wx.showToast({ title: "加载详情失败", icon: "none" })
    } finally {
      this.setData({ loading: false })
    }
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

  async onVisitRecord() {
    if (this.data.visitLoading) return
    this.setData({ visitLoading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: "memberService",
        data: {
          action: "recordVisit",
          memberId: this.data.id
        }
      })
      const result = res?.result
      if (!result || result.ok !== true) {
        throw new Error(result?.message || "visit_failed")
      }

      wx.showToast({ title: "已登记到店", icon: "success" })
      await this.refreshAll()
    } catch (err) {
      wx.showToast({ title: "登记失败", icon: "none" })
    } finally {
      this.setData({ visitLoading: false })
    }
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
      placeholderText: type === "adjust" ? "例如 -20 或 100" : "请输入数字，例如 100",
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
      placeholderText: "例如：洗剪吹、烫染套餐、手工调账",
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
              : result?.message === "forbidden"
                ? "不能操作其他店铺会员"
                : "余额操作失败"
        wx.showToast({ title: msg, icon: "none" })
        return
      }

      wx.showToast({ title: "已记录", icon: "success" })
      await this.refreshAll()
    } catch (err) {
      wx.showToast({ title: "操作失败", icon: "none" })
    } finally {
      this.setData({ actionLoading: false })
    }
  }
})
