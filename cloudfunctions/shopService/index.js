const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const ROLE_TEXT = {
  manager: "店长",
  staff: "员工"
}

const ROLE_PERMISSIONS = {
  manager: ["shop.update", "staff.manage", "member.write", "member.delete", "balance.write", "report.view"],
  staff: ["member.write", "balance.write"]
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

async function getMembershipByOpenId(openId) {
  const res = await db.collection("shop_users").where({ userOpenId: openId, status: _.neq("removed") }).limit(1).get()
  return (res.data || [])[0] || null
}

async function getShopById(shopId) {
  if (!shopId) return null
  try {
    const res = await db.collection("shops").doc(shopId).get()
    return res.data || null
  } catch (err) {
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
  if (!can(context.role, "shop.update")) {
    return { ok: false, message: "forbidden" }
  }

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
  if (!can(context.role, "staff.manage")) return { ok: false, message: "forbidden" }

  const res = await db
    .collection("shop_users")
    .where({ shopId: context.shopId, status: _.neq("removed") })
    .orderBy("createdAt", "asc")
    .get()

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
  if (!can(context.role, "staff.manage")) return { ok: false, message: "forbidden" }

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
  return { ok: true }
}

async function removeStaff(openId, event) {
  const context = await ensureShopContext(openId)
  if (!can(context.role, "staff.manage")) return { ok: false, message: "forbidden" }

  const staffId = trimString(event?.staffId)
  if (!staffId) return { ok: false, message: "staff_id_required" }

  const snap = await db.collection("shop_users").doc(staffId).get().catch(() => null)
  const staff = snap?.data
  if (!staff || staff.shopId !== context.shopId) return { ok: false, message: "not_found" }
  if (staff.userOpenId === openId) return { ok: false, message: "cannot_remove_self" }

  await db.collection("shop_users").doc(staffId).update({
    data: { status: "removed", updatedAt: Date.now() }
  })
  return { ok: true }
}

async function refreshInviteCode(openId) {
  const context = await ensureShopContext(openId)
  if (!can(context.role, "staff.manage")) return { ok: false, message: "forbidden" }

  const inviteCode = createInviteCode()
  await db.collection("shops").doc(context.shopId).update({
    data: { inviteCode, updatedAt: Date.now() }
  })
  return { ok: true, data: { inviteCode } }
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
  } else {
    await db.collection("shop_users").add({
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
  }

  return {
    ok: true,
    data: buildContext(openId, { shopId: shop._id, userOpenId: openId, role: "staff", displayName }, shop, false)
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = event?.action || "getContext"

  if (!OPENID) return { ok: false, message: "openid_missing" }
  if (action === "getContext") return { ok: true, data: await ensureShopContext(OPENID) }
  if (action === "updateProfile") return updateProfile(OPENID, event?.profile || {})
  if (action === "listStaff") return listStaff(OPENID)
  if (action === "updateStaffRole") return updateStaffRole(OPENID, event)
  if (action === "removeStaff") return removeStaff(OPENID, event)
  if (action === "refreshInviteCode") return refreshInviteCode(OPENID)
  if (action === "joinByInviteCode") return joinByInviteCode(OPENID, event)

  return { ok: false, message: "unknown_action" }
}
