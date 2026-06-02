const app = getApp()

Page({
  data: {
    loading: true,
    saving: false,
    form: {
      name: "",
      contactName: "",
      phone: "",
      address: "",
      note: ""
    }
  },

  async onShow() {
    await this.loadShop()
  },

  async loadShop() {
    this.setData({ loading: true })
    try {
      const shop = await app.refreshShopContext()
      this.setData({
        form: {
          name: shop.shopName || "",
          contactName: shop.contactName || "",
          phone: shop.phone || "",
          address: shop.address || "",
          note: shop.note || ""
        }
      })
    } catch (err) {
      wx.showToast({ title: "加载店铺失败", icon: "none" })
    } finally {
      this.setData({ loading: false })
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    const value = e.detail.value
    this.setData({ [`form.${field}`]: value })
  },

  async onSave() {
    if (this.data.saving) return
    const form = this.data.form
    const name = (form.name || "").trim()
    const phone = (form.phone || "").trim()

    if (!name) {
      wx.showToast({ title: "请输入店铺名称", icon: "none" })
      return
    }
    if (phone && !/^\d{6,20}$/.test(phone)) {
      wx.showToast({ title: "联系电话格式不对", icon: "none" })
      return
    }

    this.setData({ saving: true })
    try {
      await app.updateShopProfile({
        name,
        contactName: (form.contactName || "").trim(),
        phone,
        address: (form.address || "").trim(),
        note: (form.note || "").trim()
      })
      wx.showToast({ title: "店铺已更新", icon: "success" })
      wx.navigateBack()
    } catch (err) {
      wx.showToast({ title: "保存失败", icon: "none" })
    } finally {
      this.setData({ saving: false })
    }
  }
})
