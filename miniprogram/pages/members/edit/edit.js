const app = getApp()

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

Page({
  data: {
    id: "",
    isEdit: false,
    shop: null,
    noPermission: false,
    saving: false,
    currentBalance: 0,
    shopName: "",
    genderOptions: ["未知", "男", "女"],
    genderIndex: 0,
    form: {
      name: "",
      phone: "",
      gender: "未知",
      birthday: "",
      note: "",
      balance: 0
    }
  },

  async onLoad(options) {
    const id = options?.id || ""
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().hide()
    }
    try {
      const shop = await app.ensureShopContext()
      this.setData({
        shop,
        shopName: shop.shopName || "",
        noPermission: !shop?.canWriteMember
      })
    } catch (err) {
      wx.showToast({ title: "加载店铺失败", icon: "none" })
    }

    if (this.data.noPermission) return
    if (!id) return

    wx.setNavigationBarTitle({ title: "编辑会员" })
    this.setData({ id, isEdit: true })
    await this.fetchMember()
  },

  async fetchMember() {
    try {
      const res = await wx.cloud.callFunction({
        name: "memberService",
        data: {
          action: "getMember",
          memberId: this.data.id
        }
      })
      const result = res?.result
      if (!result || result.ok !== true) {
        throw new Error(result?.message || "get_member_failed")
      }

      const m = result.data?.member || {}
      const genderIndex = Math.max(0, this.data.genderOptions.indexOf(m.gender || "未知"))
      const balance = typeof m.balance === "number" ? m.balance : 0
      this.setData({
        genderIndex,
        currentBalance: balance,
        form: {
          name: m.name || "",
          phone: m.phone || "",
          gender: m.gender || "未知",
          birthday: m.birthday || "",
          note: m.note || "",
          balance
        }
      })
    } catch (err) {
      wx.showToast({ title: "加载会员失败", icon: "none" })
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    const value = e.detail.value
    this.setData({ [`form.${field}`]: value })
  },

  onGenderChange(e) {
    const genderIndex = Number(e.detail.value) || 0
    this.setData({
      genderIndex,
      "form.gender": this.data.genderOptions[genderIndex] || "未知"
    })
  },

  onBirthdayChange(e) {
    this.setData({ "form.birthday": e.detail.value })
  },

  async onSave() {
    if (this.data.saving) return
    if (this.data.noPermission) return

    const form = this.data.form
    const name = (form.name || "").trim()
    const phone = (form.phone || "").trim()
    const balance = Math.max(0, toNumber(form.balance))

    if (!name) {
      wx.showToast({ title: "请输入姓名", icon: "none" })
      return
    }
    if (phone && !/^\d{6,20}$/.test(phone)) {
      wx.showToast({ title: "手机号格式不对", icon: "none" })
      return
    }

    this.setData({ saving: true })
    try {
      const res = await wx.cloud.callFunction({
        name: "memberService",
        data: {
          action: "saveMember",
          memberId: this.data.id,
          name,
          phone,
          gender: form.gender || "未知",
          birthday: form.birthday || "",
          note: (form.note || "").trim(),
          balance
        }
      })
      const result = res?.result
      if (!result || result.ok !== true) {
        const msg =
          result?.message === "phone_exists"
            ? "该手机号已存在"
            : result?.message === "forbidden"
              ? "当前角色不能执行此操作"
            : result?.message === "not_found"
              ? "会员不存在"
              : "保存失败"
        wx.showToast({ title: msg, icon: "none" })
        return
      }

      wx.showToast({ title: this.data.isEdit ? "已保存" : "已创建", icon: "success" })
      wx.navigateBack()
    } catch (err) {
      wx.showToast({ title: "保存失败", icon: "none" })
    } finally {
      this.setData({ saving: false })
    }
  },

  goDetail() {
    if (!this.data.id) return
    wx.navigateTo({ url: `/pages/members/detail/detail?id=${this.data.id}` })
  },

  async onDelete() {
    if (!this.data.isEdit) return
    if (!this.data.shop?.canDeleteMember) return

    const res = await wx.showModal({
      title: "删除会员",
      content: "确定要删除这位会员吗？该会员的余额和流水记录也会一并删除。",
      confirmText: "删除",
      confirmColor: "#ef4444"
    })
    if (!res.confirm) return

    try {
      const callRes = await wx.cloud.callFunction({
        name: "memberService",
        data: {
          action: "deleteMember",
          memberId: this.data.id
        }
      })
      const result = callRes?.result
      if (!result || result.ok !== true) {
        throw new Error(result?.message || "delete_failed")
      }

      wx.showToast({ title: "已删除", icon: "success" })
      wx.navigateBack()
    } catch (err) {
      wx.showToast({ title: "删除失败", icon: "none" })
    }
  }
})
