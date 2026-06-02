const app = getApp()

function formatDate(ts) {
  if (!ts) return "-"
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

Page({
  data: {
    loading: true,
    inviteCode: "",
    canManageStaff: false,
    currentUser: { roleText: "员工", role: "staff" },
    roleClass: "chip-gray",
    staff: [],
    roleOptions: ["店长", "员工"]
  },

  async onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: "/pages/shop/team/team" })
    }
    await this.loadTeam()
  },

  async loadTeam() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: "shopService",
        data: { action: "listStaff" }
      })
      const result = res?.result
      if (!result || result.ok !== true) {
        throw new Error(result?.message || "load_failed")
      }

      const context = result.data?.context || {}
      const staff = (result.data?.staff || []).map((item) => ({
        ...item,
        joinedText: formatDate(item.joinedAt)
      }))

      const currentUser = staff.find((s) => s.isCurrentUser) || { roleText: "员工", role: "staff" }
      const roleClass =
        currentUser.role === "manager" ? "chip-green" : "chip-gray"

      this.setData({
        inviteCode: context.inviteCode || "",
        canManageStaff: context.canManageStaff || false,
        currentUser,
        roleClass,
        staff
      })
    } catch (err) {
      wx.showToast({ title: "加载团队失败", icon: "none" })
    } finally {
      this.setData({ loading: false })
    }
  },

  copyInviteCode() {
    const code = this.data.inviteCode
    if (!code) return
    wx.setClipboardData({ data: code })
  },

  async refreshCode() {
    try {
      const res = await wx.cloud.callFunction({
        name: "shopService",
        data: { action: "refreshInviteCode" }
      })
      const result = res?.result
      if (!result || result.ok !== true) {
        throw new Error(result?.message || "refresh_failed")
      }
      this.setData({ inviteCode: result.data?.inviteCode || this.data.inviteCode })
      wx.showToast({ title: "已刷新", icon: "success" })
    } catch (err) {
      wx.showToast({ title: "刷新失败", icon: "none" })
    }
  },

  async onRoleChange(e) {
    const index = Number(e.detail.value)
    const staffId = e.currentTarget.dataset.id
    const role = index === 0 ? "manager" : "staff"
    if (!staffId) return

    try {
      const res = await wx.cloud.callFunction({
        name: "shopService",
        data: {
          action: "updateStaffRole",
          staffId,
          role
        }
      })
      const result = res?.result
      if (!result || result.ok !== true) {
        wx.showToast({ title: result?.message || "修改失败", icon: "none" })
        return
      }
      wx.showToast({ title: "角色已更新", icon: "success" })
      await this.loadTeam()
    } catch (err) {
      wx.showToast({ title: "修改失败", icon: "none" })
    }
  },

  async removeStaff(e) {
    const staffId = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || "该员工"
    if (!staffId) return

    const confirmRes = await wx.showModal({
      title: "移除员工",
      content: `确定将 ${name} 从店铺中移除吗？`,
      confirmText: "移除",
      confirmColor: "#ef4444"
    })
    if (!confirmRes.confirm) return

    try {
      const res = await wx.cloud.callFunction({
        name: "shopService",
        data: {
          action: "removeStaff",
          staffId
        }
      })
      const result = res?.result
      if (!result || result.ok !== true) {
        wx.showToast({ title: result?.message || "移除失败", icon: "none" })
        return
      }
      wx.showToast({ title: "已移除", icon: "success" })
      await this.loadTeam()
    } catch (err) {
      wx.showToast({ title: "移除失败", icon: "none" })
    }
  }
})
