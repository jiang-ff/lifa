const db = wx.cloud.database()

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

Page({
  data: {
    id: "",
    isEdit: false,
    saving: false,
    currentBalance: 0,
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
    if (!id) return

    wx.setNavigationBarTitle({ title: "编辑会员" })
    this.setData({ id, isEdit: true })
    await this.fetchMember()
  },

  async fetchMember() {
    try {
      const res = await db.collection("members").doc(this.data.id).get()
      const m = res.data
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
      wx.showToast({ title: "加载失败", icon: "none" })
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
      const now = Date.now()
      const payloadBase = {
        name,
        phone,
        gender: form.gender || "未知",
        birthday: form.birthday || "",
        note: (form.note || "").trim(),
        updatedAt: now
      }

      if (phone) {
        const existRes = await db.collection("members").where({ phone }).limit(1).get()
        const exist = (existRes.data || [])[0]
        if (exist && (!this.data.isEdit || exist._id !== this.data.id)) {
          wx.showToast({ title: "手机号已存在", icon: "none" })
          return
        }
      }

      if (this.data.isEdit) {
        await db.collection("members").doc(this.data.id).update({ data: payloadBase })
        wx.showToast({ title: "已保存", icon: "success" })
        wx.navigateBack()
        return
      }

      await db.collection("members").add({
        data: {
          ...payloadBase,
          balance,
          createdAt: now
        }
      })
      wx.showToast({ title: "已创建", icon: "success" })
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

    const res = await wx.showModal({
      title: "删除会员",
      content: "确定要删除该会员？余额与流水也会失去关联。",
      confirmText: "删除",
      confirmColor: "#ef4444"
    })
    if (!res.confirm) return

    try {
      await db.collection("members").doc(this.data.id).remove()
      wx.showToast({ title: "已删除", icon: "success" })
      wx.navigateBack()
    } catch (err) {
      wx.showToast({ title: "删除失败", icon: "none" })
    }
  }
})
