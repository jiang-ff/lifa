const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database({ env: cloud.DYNAMIC_CURRENT_ENV })
const _ = db.command

const FUNCTION_NAME = "shopService"

const ROLE_TEXT = {
  manager: "店长",
  staff: "员工"
}

const ROLE_PERMISSIONS = {
  manager: ["shop.update", "staff.manage", "member.write", "member.delete", "balance.write", "visit.write", "report.view"],
  staff: ["member.write", "visit.write"]
}

function trimString(value) {
  return typeof value === "string" ? value.trim() : ""
}

function isValidPhone(phone) {
  return !phone || /^\d{6,20}$/.test(phone)
}

function normalizeRole(role) {
  if (role === "owner") return "manager"
  return ["manager", "staff"].includes(role) ? role : "staff"
}

function can(role, permission) {
  return (ROLE_PERMISSIONS[role] || []).includes(permission)
}

function createInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

function summarizeError(error) {
  if (!error) return ""
  if (typeof error === "string") return error
  return error.message || String(error)
}

function pickActionResult(result) {
  if (!result) return { ok: false, message: "empty_result" }
  return {
    ok: result.ok === true,
    message: result.message || "",
    code: result.code || ""
  }
}

async function writeFunctionLog(entry) {
  try {
    await db.collection("function_logs").add({
      data: {
        ...entry,
        createdAt: Date.now()
      }
    })
  } catch (error) {
    console.error("writeFunctionLog failed", summarizeError(error))
  }
}

async function writeAuditLog(entry) {
  try {
    await db.collection("operation_audits").add({
      data: {
        ...entry,
        createdAt: Date.now()
      }
    })
  } catch (error) {
    console.error("writeAuditLog failed", summarizeError(error))
  }
}

async function getMembershipByOpenId(openId) {
  const res = await db
    .collection("shop_users")
    .where({ userOpenId: openId, status: _.neq("removed") })
    .limit(1)
    .get()
  return (res.data || [])[0] || null
}

async function getShopById(shopId) {
  if (!shopId) return null
  try {
    const res = await db.collection("shops").doc(shopId).get()
    return res.data || null
  } catch (error) {
    return null
  }
}

async function createShopRecord(openId) {
  const now = Date.now()
  const data = {
    name: "我的理发店",
    ownerOpenId: openId,
    contactName: "",
    phone: "",
    address: "",
    note: "",
    inviteCode: createInviteCode(),
    createdAt: now,
    updatedAt: now,
    status: "active"
  }
  const res = await db.collection("shops").add({ data })
  return { _id: res._id, ...data }
}

function buildContext(openId, membership, shop, createdNow) {
  const now = Date.now()
  const role = normalizeRole(membership.role || "manager")
  const permissions = ROLE_PERMISSIONS[role] || []

  return {
    openId,
    role,
    roleText: ROLE_TEXT[role] || "店长",
    permissions,
    canManageStaff: can(role, "staff.manage"),
    canUpdateShop: can(role, "shop.update"),
    canWriteMember: can(role, "member.write"),
    canDeleteMember: can(role, "member.delete"),
    canWriteBalance: can(role, "balance.write"),
    canRecordVisit: can(role, "visit.write"),
    canViewReport: can(role, "report.view"),
    shopId: shop._id,
    shopName: shop.name || "我的理发店",
    contactName: shop.contactName || "",
    phone: shop.phone || "",
    address: shop.address || "",
    note: shop.note || "",
    inviteCode: shop.inviteCode || "",
    createdAt: shop.createdAt || now,
    updatedAt: shop.updatedAt || now,
    needsSetup: !shop.contactName || !shop.phone,
    createdNow: !!createdNow
  }
}

async function ensureShopContext(openId) {
  const now = Date.now()
  let createdNow = false
  let membership = await getMembershipByOpenId(openId)
  let shop = membership ? await getShopById(membership.shopId) : null

  if (!membership) {
    shop = await createShopRecord(openId)
    membership = {
      shopId: shop._id,
      userOpenId: openId,
      role: "manager",
      displayName: "",
      status: "active",
      createdAt: now,
      updatedAt: now
    }
    await db.collection("shop_users").add({ data: membership })
    createdNow = true
  } else if (!shop) {
    shop = await createShopRecord(openId)
    createdNow = true
    await db.collection("shop_users").doc(membership._id).update({
      data: {
        shopId: shop._id,
        role: membership.role || "manager",
        status: "active",
        updatedAt: now
      }
    })
    membership.shopId = shop._id
  }

  if (!shop.inviteCode) {
    shop.inviteCode = createInviteCode()
    await db.collection("shops").doc(shop._id).update({
      data: { inviteCode: shop.inviteCode, updatedAt: now }
    })
  }

  return buildContext(openId, membership, shop, createdNow)
}

async function updateProfile(openId, profile) {
  const context = await ensureShopContext(openId)
  if (!context.canUpdateShop) return { ok: false, message: "forbidden" }

  const name = trimString(profile?.name)
  const contactName = trimString(profile?.contactName)
  const phone = trimString(profile?.phone)
  const address = trimString(profile?.address)
  const note = trimString(profile?.note)

  if (!name) return { ok: false, message: "shop_name_required" }
  if (!isValidPhone(phone)) return { ok: false, message: "invalid_phone" }

  const now = Date.now()
  await db.collection("shops").doc(context.shopId).update({
    data: { name, contactName, phone, address, note, updatedAt: now }
  })

  await writeAuditLog({
    shopId: context.shopId,
    operatorOpenId: openId,
    operatorRole: context.role,
    targetType: "shop",
    targetId: context.shopId,
    action: "shop.updateProfile",
    detail: { name, contactName, phone, address, note }
  })

  return {
    ok: true,
    data: {
      ...context,
      shopName: name,
      contactName,
      phone,
      address,
      note,
      updatedAt: now,
      needsSetup: !contactName || !phone,
      createdNow: false
    }
  }
}

async function listStaff(openId) {
  const context = await ensureShopContext(openId)
  const filters = context.canManageStaff
    ? { shopId: context.shopId, status: _.neq("removed") }
    : { shopId: context.shopId, userOpenId: openId, status: _.neq("removed") }

  const res = await db.collection("shop_users").where(filters).orderBy("createdAt", "asc").get()
  const staff = (res.data || []).map((item) => ({
    _id: item._id,
    displayName: item.displayName || (item.userOpenId === openId ? "我" : "未命名员工"),
    userOpenId: item.userOpenId,
    role: normalizeRole(item.role),
    roleText: ROLE_TEXT[normalizeRole(item.role)] || "员工",
    joinedAt: item.createdAt || item.updatedAt || 0,
    isCurrentUser: item.userOpenId === openId
  }))

  return { ok: true, data: { context, staff } }
}

async function updateStaffRole(openId, event) {
  const context = await ensureShopContext(openId)
  if (!context.canManageStaff) return { ok: false, message: "forbidden" }

  const staffId = trimString(event?.staffId)
  const role = normalizeRole(event?.role)
  if (!staffId) return { ok: false, message: "staff_id_required" }

  const snap = await db.collection("shop_users").doc(staffId).get().catch(() => null)
  const staff = snap?.data
  if (!staff || staff.shopId !== context.shopId) return { ok: false, message: "not_found" }
  if (staff.userOpenId === openId) return { ok: false, message: "cannot_change_self" }

  await db.collection("shop_users").doc(staffId).update({
    data: { role, updatedAt: Date.now() }
  })

  await writeAuditLog({
    shopId: context.shopId,
    operatorOpenId: openId,
    operatorRole: context.role,
    targetType: "shop_user",
    targetId: staffId,
    action: "staff.updateRole",
    detail: { userOpenId: staff.userOpenId, role }
  })

  return { ok: true }
}

async function removeStaff(openId, event) {
  const context = await ensureShopContext(openId)
  if (!context.canManageStaff) return { ok: false, message: "forbidden" }

  const staffId = trimString(event?.staffId)
  if (!staffId) return { ok: false, message: "staff_id_required" }

  const snap = await db.collection("shop_users").doc(staffId).get().catch(() => null)
  const staff = snap?.data
  if (!staff || staff.shopId !== context.shopId) return { ok: false, message: "not_found" }
  if (staff.userOpenId === openId) return { ok: false, message: "cannot_remove_self" }

  await db.collection("shop_users").doc(staffId).update({
    data: { status: "removed", updatedAt: Date.now() }
  })

  await writeAuditLog({
    shopId: context.shopId,
    operatorOpenId: openId,
    operatorRole: context.role,
    targetType: "shop_user",
    targetId: staffId,
    action: "staff.remove",
    detail: { userOpenId: staff.userOpenId }
  })

  return { ok: true }
}

async function refreshInviteCode(openId) {
  const context = await ensureShopContext(openId)
  if (!context.canManageStaff) return { ok: false, message: "forbidden" }

  const inviteCode = createInviteCode()
  await db.collection("shops").doc(context.shopId).update({
    data: { inviteCode, updatedAt: Date.now() }
  })

  await writeAuditLog({
    shopId: context.shopId,
    operatorOpenId: openId,
    operatorRole: context.role,
    targetType: "shop",
    targetId: context.shopId,
    action: "shop.refreshInviteCode",
    detail: { inviteCode }
  })

  return { ok: true, data: { inviteCode } }
}

async function getMonitorLogs(context) {
  if (!context.canManageStaff) return { ok: false, message: "forbidden" }

  const [functionRes, auditRes] = await Promise.all([
    db
      .collection("function_logs")
      .where({ shopId: context.shopId })
      .field({
        functionName: true,
        action: true,
        role: true,
        ok: true,
        message: true,
        code: true,
        errorMessage: true,
        durationMs: true,
        createdAt: true
      })
      .orderBy("createdAt", "desc")
      .limit(12)
      .get(),
    db
      .collection("operation_audits")
      .where({ shopId: context.shopId })
      .field({
        targetType: true,
        targetId: true,
        action: true,
        operatorRole: true,
        detail: true,
        createdAt: true
      })
      .orderBy("createdAt", "desc")
      .limit(12)
      .get()
  ])

  return {
    ok: true,
    data: {
      functionLogs: functionRes.data || [],
      operationAudits: auditRes.data || []
    }
  }
}

async function joinByInviteCode(openId, event) {
  const inviteCode = trimString(event?.inviteCode).toUpperCase()
  const displayName = trimString(event?.displayName)
  if (!inviteCode) return { ok: false, message: "invite_code_required" }

  const shopRes = await db.collection("shops").where({ inviteCode, status: "active" }).limit(1).get()
  const shop = (shopRes.data || [])[0]
  if (!shop) return { ok: false, message: "invite_not_found" }

  const now = Date.now()
  const membership = await getMembershipByOpenId(openId)
  if (membership && membership.shopId === shop._id) {
    await db.collection("shop_users").doc(membership._id).update({
      data: { displayName, status: "active", updatedAt: now }
    })

    await writeAuditLog({
      shopId: shop._id,
      operatorOpenId: openId,
      operatorRole: normalizeRole(membership.role),
      targetType: "shop_user",
      targetId: membership._id,
      action: "staff.joinByInviteCode",
      detail: { displayName, mode: "refresh_self_profile" }
    })

    return { ok: true, data: buildContext(openId, { ...membership, displayName }, shop, false) }
  }

  if (membership) {
    await db.collection("shop_users").doc(membership._id).update({
      data: {
        shopId: shop._id,
        role: "staff",
        displayName,
        status: "active",
        updatedAt: now
      }
    })

    await writeAuditLog({
      shopId: shop._id,
      operatorOpenId: openId,
      operatorRole: "staff",
      targetType: "shop_user",
      targetId: membership._id,
      action: "staff.joinByInviteCode",
      detail: { displayName, mode: "move_to_new_shop" }
    })
  } else {
    const addRes = await db.collection("shop_users").add({
      data: {
        shopId: shop._id,
        userOpenId: openId,
        role: "staff",
        displayName,
        status: "active",
        createdAt: now,
        updatedAt: now
      }
    })

    await writeAuditLog({
      shopId: shop._id,
      operatorOpenId: openId,
      operatorRole: "staff",
      targetType: "shop_user",
      targetId: addRes._id,
      action: "staff.joinByInviteCode",
      detail: { displayName, mode: "new_join" }
    })
  }

  return {
    ok: true,
    data: buildContext(openId, { shopId: shop._id, userOpenId: openId, role: "staff", displayName }, shop, false)
  }
}

exports.main = async (event) => {
  const startedAt = Date.now()
  const { OPENID } = cloud.getWXContext()
  const action = event?.action || "getContext"

  let context = null
  let result = null
  let errorMessage = ""

  try {
    if (!OPENID) {
      result = { ok: false, message: "openid_missing" }
      return result
    }

    if (action === "getContext") {
      const data = await ensureShopContext(OPENID)
      context = data
      result = { ok: true, data }
      return result
    }

    context = await ensureShopContext(OPENID)
    if (action === "updateProfile") result = await updateProfile(OPENID, event?.profile || {})
    else if (action === "listStaff") result = await listStaff(OPENID)
    else if (action === "updateStaffRole") result = await updateStaffRole(OPENID, event)
    else if (action === "removeStaff") result = await removeStaff(OPENID, event)
    else if (action === "refreshInviteCode") result = await refreshInviteCode(OPENID)
    else if (action === "getMonitorLogs") result = await getMonitorLogs(context)
    else if (action === "joinByInviteCode") result = await joinByInviteCode(OPENID, event)
    else result = { ok: false, message: "unknown_action" }

    return result
  } catch (error) {
    errorMessage = summarizeError(error)
    console.error(`${FUNCTION_NAME} failed`, error)
    result = { ok: false, message: "internal_error" }
    return result
  } finally {
    await writeFunctionLog({
      functionName: FUNCTION_NAME,
      action,
      openId: OPENID || "",
      shopId: context?.shopId || result?.data?.shopId || "",
      role: context?.role || result?.data?.role || "",
      durationMs: Date.now() - startedAt,
      ...pickActionResult(result),
      errorMessage
    })
  }
}
