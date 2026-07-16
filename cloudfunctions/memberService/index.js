const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database({ env: cloud.DYNAMIC_CURRENT_ENV })
const _ = db.command
const $ = db.command.aggregate

const FUNCTION_NAME = "memberService"

const ROLE_PERMISSIONS = {
  manager: ["member.write", "member.delete", "balance.write", "visit.write", "report.view", "shop.update", "staff.manage"],
  staff: ["member.write", "visit.write"]
}

function trimString(value) {
  return typeof value === "string" ? value.trim() : ""
}

function isValidPhone(phone) {
  return !phone || /^\d{6,20}$/.test(phone)
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function normalizeRole(role) {
  if (role === "owner") return "manager"
  return ["manager", "staff"].includes(role) ? role : "staff"
}

function can(role, permission) {
  return (ROLE_PERMISSIONS[role] || []).includes(permission)
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

async function ensureShopContext(openId) {
  const membership = await getMembershipByOpenId(openId)
  if (!membership) return null

  const shop = await getShopById(membership.shopId)
  if (!shop || shop.status !== "active") return null

  const role = normalizeRole(membership.role)
  return {
    openId,
    shopId: membership.shopId,
    role,
    canWriteMember: can(role, "member.write"),
    canDeleteMember: can(role, "member.delete"),
    canWriteBalance: can(role, "balance.write"),
    canRecordVisit: can(role, "visit.write"),
    canViewReport: can(role, "report.view"),
    canUpdateShop: can(role, "shop.update")
  }
}

function buildMemberWhere(context, options = {}) {
  const conditions = [{ shopId: context.shopId }, { status: _.neq("deleted") }]
  const keyword = trimString(options.keyword)

  if (keyword) {
    const reg = db.RegExp({ regexp: keyword, options: "i" })
    conditions.push(_.or([{ name: reg }, { phone: reg }]))
  }

  if (options.hasBalanceOnly) {
    conditions.push({ balance: _.gt(0) })
  }

  return _.and(conditions)
}

async function listMembers(context, event) {
  const keyword = trimString(event?.keyword)
  const sortKey = event?.sortKey || "updatedAt"
  const hasBalanceOnly = !!event?.hasBalanceOnly
  const where = buildMemberWhere(context, { keyword, hasBalanceOnly })

  let query = db.collection("members").where(where)
  if (sortKey === "balance") query = query.orderBy("balance", "desc").orderBy("updatedAt", "desc")
  else if (sortKey === "name") query = query.orderBy("name", "asc").orderBy("updatedAt", "desc")
  else query = query.orderBy("updatedAt", "desc")

  const [listRes, filteredCountRes, totalCountRes, balanceCountRes, balanceSumRes] = await Promise.all([
    query.limit(50).get(),
    db.collection("members").where(where).count(),
    db.collection("members").where(buildMemberWhere(context)).count(),
    db.collection("members").where(buildMemberWhere(context, { hasBalanceOnly: true })).count(),
    db
      .collection("members")
      .aggregate()
      .match({ shopId: context.shopId, status: _.neq("deleted") })
      .group({
        _id: null,
        totalBalance: $.sum("$balance")
      })
      .end()
  ])

  return {
    ok: true,
    data: {
      members: listRes.data || [],
      total: filteredCountRes.total || 0,
      stats: {
        totalMembers: totalCountRes.total || 0,
        balanceMembers: balanceCountRes.total || 0,
        totalBalance: Math.round(toNumber(balanceSumRes.list?.[0]?.totalBalance) * 100) / 100
      }
    }
  }
}

async function getMember(context, event) {
  const memberId = trimString(event?.memberId)
  if (!memberId) return { ok: false, message: "member_id_required" }

  const snap = await db.collection("members").doc(memberId).get().catch(() => null)
  if (!snap || !snap.data || snap.data.status === "deleted") return { ok: false, message: "not_found" }
  if (snap.data.shopId !== context.shopId) return { ok: false, message: "forbidden" }

  return { ok: true, data: { member: snap.data } }
}

async function getMemberDetail(context, event) {
  const memberId = trimString(event?.memberId)
  if (!memberId) return { ok: false, message: "member_id_required" }

  const snap = await db.collection("members").doc(memberId).get().catch(() => null)
  if (!snap || !snap.data || snap.data.status === "deleted") return { ok: false, message: "not_found" }
  if (snap.data.shopId !== context.shopId) return { ok: false, message: "forbidden" }

  const [txRes, visitsRes, visitCountRes] = await Promise.all([
    db
      .collection("member_transactions")
      .where({ memberId, shopId: context.shopId })
      .orderBy("createdAt", "desc")
      .limit(30)
      .get(),
    db
      .collection("member_visits")
      .where({ memberId, shopId: context.shopId })
      .orderBy("visitedAt", "desc")
      .limit(1)
      .get(),
    db.collection("member_visits").where({ memberId, shopId: context.shopId }).count()
  ])

  let totalRecharge = 0
  let totalConsume = 0
  for (const item of txRes.data || []) {
    const amount = toNumber(item.amount)
    if (item.type === "recharge") totalRecharge += Math.abs(amount)
    if (item.type === "consume") totalConsume += Math.abs(amount)
  }

  totalRecharge = Math.round(totalRecharge * 100) / 100
  totalConsume = Math.round(totalConsume * 100) / 100
  const lastVisit = (visitsRes.data || [])[0]

  return {
    ok: true,
    data: {
      member: snap.data,
      transactions: txRes.data || [],
      stats: {
        totalRecharge,
        totalConsume,
        net: Math.round((totalRecharge - totalConsume) * 100) / 100
      },
      visitCount: visitCountRes.total || 0,
      lastVisitAt: lastVisit ? lastVisit.visitedAt : 0
    }
  }
}

async function saveMember(context, event) {
  if (!context.canWriteMember) return { ok: false, message: "forbidden" }

  const memberId = trimString(event?.memberId)
  const name = trimString(event?.name)
  const phone = trimString(event?.phone)
  const gender = event?.gender || "未知"
  const birthday = trimString(event?.birthday)
  const note = trimString(event?.note)
  const balance = Math.max(0, toNumber(event?.balance))

  if (!name) return { ok: false, message: "name_required" }
  if (phone && !isValidPhone(phone)) return { ok: false, message: "invalid_phone" }
  if (!memberId && balance > 0 && !context.canWriteBalance) return { ok: false, message: "forbidden" }

  const now = Date.now()

  if (phone) {
    const phoneConditions = [{ shopId: context.shopId }, { phone }, { status: _.neq("deleted") }]
    if (memberId) phoneConditions.push({ _id: _.neq(memberId) })

    const dupRes = await db.collection("members").where(_.and(phoneConditions)).limit(1).get()
    if ((dupRes.data || []).length > 0) return { ok: false, message: "phone_exists" }
  }

  if (memberId) {
    const snap = await db.collection("members").doc(memberId).get().catch(() => null)
    if (!snap || !snap.data || snap.data.status === "deleted") return { ok: false, message: "not_found" }
    if (snap.data.shopId !== context.shopId) return { ok: false, message: "forbidden" }

    await db.collection("members").doc(memberId).update({
      data: { name, phone, gender, birthday, note, updatedAt: now }
    })

    await writeAuditLog({
      shopId: context.shopId,
      operatorOpenId: context.openId,
      operatorRole: context.role,
      targetType: "member",
      targetId: memberId,
      action: "member.update",
      detail: { name, phone, gender, birthday, note }
    })

    return { ok: true, data: { memberId } }
  }

  const addRes = await db.collection("members").add({
    data: {
      shopId: context.shopId,
      name,
      phone,
      gender,
      birthday,
      note,
      balance,
      visitCount: 0,
      lastVisitAt: 0,
      createdAt: now,
      updatedAt: now,
      status: "active"
    }
  })

  await writeAuditLog({
    shopId: context.shopId,
    operatorOpenId: context.openId,
    operatorRole: context.role,
    targetType: "member",
    targetId: addRes._id,
    action: "member.create",
    detail: { name, phone, gender, birthday, balance }
  })

  return { ok: true, data: { memberId: addRes._id } }
}

async function deleteMember(context, event) {
  if (!context.canDeleteMember) return { ok: false, message: "forbidden" }

  const memberId = trimString(event?.memberId)
  if (!memberId) return { ok: false, message: "member_id_required" }

  const snap = await db.collection("members").doc(memberId).get().catch(() => null)
  if (!snap || !snap.data || snap.data.status === "deleted") return { ok: false, message: "not_found" }
  if (snap.data.shopId !== context.shopId) return { ok: false, message: "forbidden" }

  await db.collection("members").doc(memberId).update({
    data: { status: "deleted", updatedAt: Date.now() }
  })

  await writeAuditLog({
    shopId: context.shopId,
    operatorOpenId: context.openId,
    operatorRole: context.role,
    targetType: "member",
    targetId: memberId,
    action: "member.delete",
    detail: { name: snap.data.name || "", phone: snap.data.phone || "" }
  })

  return { ok: true }
}

async function recordVisit(context, event) {
  if (!context.canRecordVisit) return { ok: false, message: "forbidden" }

  const memberId = trimString(event?.memberId)
  const remark = trimString(event?.remark)
  if (!memberId) return { ok: false, message: "member_id_required" }

  const snap = await db.collection("members").doc(memberId).get().catch(() => null)
  if (!snap || !snap.data || snap.data.status === "deleted") return { ok: false, message: "not_found" }
  if (snap.data.shopId !== context.shopId) return { ok: false, message: "forbidden" }

  const now = Date.now()
  const addRes = await db.collection("member_visits").add({
    data: {
      shopId: context.shopId,
      memberId,
      visitedAt: now,
      createdBy: context.openId || "",
      remark: remark || "",
      createdAt: now
    }
  })

  const countRes = await db.collection("member_visits").where({ memberId, shopId: context.shopId }).count()
  await db.collection("members").doc(memberId).update({
    data: {
      lastVisitAt: now,
      visitCount: countRes.total || 0,
      updatedAt: now
    }
  })

  await writeAuditLog({
    shopId: context.shopId,
    operatorOpenId: context.openId,
    operatorRole: context.role,
    targetType: "member",
    targetId: memberId,
    action: "member.recordVisit",
    detail: { visitId: addRes._id, remark }
  })

  return {
    ok: true,
    data: { visitId: addRes._id, lastVisitAt: now, visitCount: countRes.total || 0 }
  }
}

exports.main = async (event) => {
  const startedAt = Date.now()
  const { OPENID } = cloud.getWXContext()
  const action = event?.action || ""

  let context = null
  let result = null
  let errorMessage = ""

  try {
    if (!OPENID) {
      result = { ok: false, message: "openid_missing" }
      return result
    }

    context = await ensureShopContext(OPENID)
    if (!context) {
      result = { ok: false, message: "shop_context_failed" }
      return result
    }

    if (action === "listMembers") result = await listMembers(context, event)
    else if (action === "getMember") result = await getMember(context, event)
    else if (action === "getMemberDetail") result = await getMemberDetail(context, event)
    else if (action === "recordVisit") result = await recordVisit(context, event)
    else if (action === "saveMember") result = await saveMember(context, event)
    else if (action === "deleteMember") result = await deleteMember(context, event)
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
      shopId: context?.shopId || "",
      role: context?.role || "",
      durationMs: Date.now() - startedAt,
      ...pickActionResult(result),
      errorMessage
    })
  }
}
