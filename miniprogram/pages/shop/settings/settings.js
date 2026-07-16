const app = getApp()

const AUDIT_ACTION_TEXT = {
  "shop.updateProfile": "更新店铺资料",
  "shop.refreshInviteCode": "刷新邀请码",
  "staff.updateRole": "调整员工角色",
  "staff.remove": "移除员工",
  "staff.joinByInviteCode": "邀请码入店",
  "member.create": "新增会员",
  "member.update": "编辑会员",
  "member.delete": "删除会员",
  "member.recordVisit": "登记到店",
  "balance.recharge": "会员充值",
  "balance.consume": "会员消费",
  "balance.adjust": "会员调账"
}

const FUNCTION_ACTION_TEXT = {
  getContext: "获取门店上下文",
  updateProfile: "更新店铺资料",
  listStaff: "读取团队列表",
  updateStaffRole: "修改员工角色",
  removeStaff: "移除员工",
  refreshInviteCode: "刷新邀请码",
  joinByInviteCode: "邀请码入店",
  getMonitorLogs: "查看监控日志",
  listMembers: "读取会员列表",
  getMember: "读取会员资料",
  getMemberDetail: "读取会员详情",
  saveMember: "保存会员",
  deleteMember: "删除会员",
  recordVisit: "登记到店",
  getStats: "读取经营报表"
}

function formatDateTime(ts) {
  if (!ts) return "-"
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatRole(role) {
  if (role === "manager") return "店长"
  if (role === "staff") return "员工"
  return "未知"
}

function summarizeAuditDetail(detail) {
  if (!detail || typeof detail !== "object") return ""
  const keys = Object.keys(detail).slice(0, 3)
  return keys.map((key) => `${key}: ${detail[key]}`).join(" / ")
}

function buildRuntimeView(runtimeEnv) {
  if (!runtimeEnv) {
    return {
      stageText: "-",
      stageClass: "chip-gray",
      profileLabel: "-",
      cloudEnvId: "-",
      canSwitch: false,
      hasManualOverride: false,
      profiles: []
    }
  }

  const stageMap = {
    develop: { text: "开发版", className: "chip-indigo" },
    trial: { text: "体验版", className: "chip-warning" },
    release: { text: "正式版", className: "chip-green" }
  }

  const stage = stageMap[runtimeEnv.stage] || { text: runtimeEnv.stage || "未知", className: "chip-gray" }
  return {
    ...runtimeEnv,
    stageText: stage.text,
    stageClass: stage.className,
    profileLabel: runtimeEnv.label || runtimeEnv.profile || "-",
    cloudEnvId: runtimeEnv.cloudEnvId || "-",
    profiles: runtimeEnv.profiles || []
  }
}

function normalizeFunctionLogs(list) {
  return (list || []).map((item) => ({
    ...item,
    actionText: FUNCTION_ACTION_TEXT[item.action] || item.action || "未命名操作",
    functionLabel: item.functionName || "unknown",
    roleText: formatRole(item.role),
    statusText: item.ok ? "成功" : "失败",
    statusClass: item.ok ? "chip-green" : "chip-red",
    timeText: formatDateTime(item.createdAt),
    durationText: `${Number(item.durationMs) || 0} ms`,
    messageText: item.message || item.errorMessage || "-"
  }))
}

function normalizeAuditLogs(list) {
  return (list || []).map((item) => ({
    ...item,
    actionText: AUDIT_ACTION_TEXT[item.action] || item.action || "未命名操作",
    roleText: formatRole(item.operatorRole),
    timeText: formatDateTime(item.createdAt),
    detailText: summarizeAuditDetail(item.detail)
  }))
}

Page({
  data: {
    loading: true,
    noPermission: false,
    saving: false,
    logsLoading: false,
    canManageStaff: false,
    runtimeEnv: buildRuntimeView(null),
    functionLogs: [],
    operationAudits: [],
    form: {
      name: "",
      contactName: "",
      phone: "",
      address: "",
      note: ""
    }
  },

  async onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().hide()
    }
    await this.loadShop()
  },

  async loadShop() {
    this.setData({
      loading: true,
      runtimeEnv: buildRuntimeView(app.getRuntimeEnv())
    })

    try {
      const shop = await app.refreshShopContext()
      this.setData({
        noPermission: !shop?.canUpdateShop,
        canManageStaff: !!shop?.canManageStaff,
        form: {
          name: shop.shopName || "",
          contactName: shop.contactName || "",
          phone: shop.phone || "",
          address: shop.address || "",
          note: shop.note || ""
        }
      })

      if (shop?.canManageStaff) {
        await this.loadMonitorLogs({ silent: true })
      } else {
        this.setData({ functionLogs: [], operationAudits: [] })
      }
    } catch (err) {
      wx.showToast({ title: "加载店铺失败", icon: "none" })
    } finally {
      this.setData({ loading: false })
    }
  },

  async loadMonitorLogs(options = {}) {
    if (!this.data.canManageStaff) return

    this.setData({ logsLoading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: "shopService",
        data: { action: "getMonitorLogs" }
      })
      const result = res?.result
      if (!result || result.ok !== true) {
        throw new Error(result?.message || "monitor_logs_failed")
      }

      this.setData({
        functionLogs: normalizeFunctionLogs(result.data?.functionLogs),
        operationAudits: normalizeAuditLogs(result.data?.operationAudits)
      })
    } catch (err) {
      if (!options.silent) {
        wx.showToast({ title: "加载日志失败", icon: "none" })
      }
    } finally {
      this.setData({ logsLoading: false })
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    const value = e.detail.value
    this.setData({ [`form.${field}`]: value })
  },

  async onSwitchEnv(e) {
    const profile = e.currentTarget.dataset.profile
    const runtimeEnv = this.data.runtimeEnv
    if (!profile || !runtimeEnv.canSwitch || profile === runtimeEnv.profile) return

    const profileInfo = (runtimeEnv.profiles || []).find((item) => item.key === profile)
    const confirmRes = await wx.showModal({
      title: "切换环境",
      content: `将切换到${profileInfo?.label || profile}，并重新加载小程序数据。`,
      confirmText: "立即切换"
    })
    if (!confirmRes.confirm) return

    try {
      await app.switchRuntimeEnvProfile(profile)
      wx.showToast({ title: "环境已切换", icon: "success" })
      setTimeout(() => {
        wx.reLaunch({ url: "/pages/members/list/list" })
      }, 350)
    } catch (err) {
      wx.showToast({
        title: err?.message === "release_env_locked" ? "正式版不可切换环境" : "切换失败",
        icon: "none"
      })
    }
  },

  async onResetEnv() {
    if (!this.data.runtimeEnv.hasManualOverride) return
    try {
      await app.resetRuntimeEnvProfile()
      wx.showToast({ title: "已恢复默认环境", icon: "success" })
      setTimeout(() => {
        wx.reLaunch({ url: "/pages/members/list/list" })
      }, 350)
    } catch (err) {
      wx.showToast({ title: "恢复失败", icon: "none" })
    }
  },

  async onSave() {
    if (this.data.saving || this.data.noPermission) return
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
