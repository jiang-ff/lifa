const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

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
  } catch (err) {
    return null
  }
}

async function ensureShopContext(openId) {
  let membership = await getMembershipByOpenId(openId)
  if (!membership) return null

  const shop = await getShopById(membership.shopId)
  if (!shop) return null

  return { openId, shopId: membership.shopId, role: membership.role === "owner" ? "manager" : (membership.role || "staff") }
}

async function listMembers(context, event) {
  const keyword = trimString(event?.keyword)
  const sortKey = event?.sortKey || "updatedAt"
  const hasBalanceOnly = !!event?.hasBalanceOnly

  let query = db.collection("members").where({ shopId: context.shopId, status: _.neq("deleted") })

  if (keyword) {
    const reg = db.RegExp({ regexp: keyword, options: "i" })
    query = query.where(_.or([{ name: reg }, { phone: reg }]))
  }

  if (hasBalanceOnly) {
    query = query.where({ balance: _.gt(0) })
  }

  if (sortKey === "balance") query = query.orderBy("balance", "desc").orderBy("updatedAt", "desc")
  else if (sortKey === "name") query = query.orderBy("name", "asc")
  else query = query.orderBy("updatedAt", "desc")

  const listRes = await query.limit(50).get()
  const members = listRes.data || []

  let stats = { totalMembers: 0, balanceMembers: 0, totalBalance: 0 }
  if (!keyword && !hasBalanceOnly) {
    const countRes = await db
      .collection("members")
      .where({ shopId: context.shopId, status: _.neq("deleted") })
      .count()
    stats.totalMembers = countRes.total || 0
    members.forEach((m) => {
      const b = toNumber(m.balance)
      if (b > 0) stats.balanceMembers++
      stats.totalBalance += b
    })
  } else {
    stats.totalMembers = members.length
    members.forEach((m) => {
      const b = toNumber(m.balance)
      if (b > 0) stats.balanceMembers++
      stats.totalBalance += b
    })
  }

  stats.totalBalance = Math.round(stats.totalBalance * 100) / 100

  return { ok: true, data: { members, total: stats.totalMembers, stats } }
}

async function getMember(context, event) {
  const memberId = trimString(event?.memberId)
  if (!memberId) return { ok: false, message: "member_id_required" }

  const snap = await db.collection("members").doc(memberId).get().catch(() => null)
  if (!snap || !snap.data) return { ok: false, message: "not_found" }
  if (snap.data.shopId !== context.shopId) return { ok: false, message: "forbidden" }

  return { ok: true, data: { member: snap.data } }
}

async function getMemberDetail(context, event) {
  const memberId = trimString(event?.memberId)
  if (!memberId) return { ok: false, message: "member_id_required" }

  const snap = await db.collection("members").doc(memberId).get().catch(() => null)
  if (!snap || !snap.data) return { ok: false, message: "not_found" }
  if (snap.data.shopId !== context.shopId) return { ok: false, message: "forbidden" }

  const member = snap.data

  const txRes = await db
    .collection("member_transactions")
    .where({ memberId })
    .orderBy("createdAt", "desc")
    .limit(30)
    .get()
  const transactions = txRes.data || []

  let totalRecharge = 0
  let totalConsume = 0
  transactions.forEach((t) => {
    const a = toNumber(t.amount)
    if (t.type === "recharge") totalRecharge += Math.abs(a)
    if (t.type === "consume") totalConsume += Math.abs(a)
  })

  totalRecharge = Math.round(totalRecharge * 100) / 100
  totalConsume = Math.round(totalConsume * 100) / 100
  const net = Math.round((totalRecharge - totalConsume) * 100) / 100

  const visitsRes = await db
    .collection("member_visits")
    .where({ memberId, shopId: context.shopId })
    .orderBy("visitedAt", "desc")
    .limit(1)
    .get()
  const lastVisit = (visitsRes.data || [])[0]

  const visitCountRes = await db
    .collection("member_visits")
    .where({ memberId, shopId: context.shopId })
    .count()
  const visitCount = visitCountRes.total || 0

  return {
    ok: true,
    data: {
      member,
      transactions,
      stats: { totalRecharge, totalConsume, net },
      visitCount,
      lastVisitAt: lastVisit ? lastVisit.visitedAt : 0
    }
  }
}

async function saveMember(context, event) {
  const memberId = trimString(event?.memberId)
  const name = trimString(event?.name)
  const phone = trimString(event?.phone)
  const gender = event?.gender || "未知"
  const birthday = trimString(event?.birthday)
  const note = trimString(event?.note)
  const balance = Math.max(0, toNumber(event?.balance))

  if (!name) return { ok: false, message: "name_required" }
  if (phone && !isValidPhone(phone)) return { ok: false, message: "invalid_phone" }

  const now = Date.now()

  if (phone) {
    const dupRes = await db
      .collection("members")
      .where({
        shopId: context.shopId,
        phone,
        status: _.neq("deleted"),
        _id: memberId ? _.neq(memberId) : undefined
      })
      .limit(1)
      .get()
    if ((dupRes.data || []).length > 0) {
      return { ok: false, message: "phone_exists" }
    }
  }

  if (memberId) {
    const snap = await db.collection("members").doc(memberId).get().catch(() => null)
    if (!snap || !snap.data) return { ok: false, message: "not_found" }
    if (snap.data.shopId !== context.shopId) return { ok: false, message: "forbidden" }

    await db.collection("members").doc(memberId).update({
      data: { name, phone, gender, birthday, note, updatedAt: now }
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
      createdAt: now,
      updatedAt: now,
      status: "active"
    }
  })

  return { ok: true, data: { memberId: addRes._id } }
}

async function deleteMember(context, event) {
  const memberId = trimString(event?.memberId)
  if (!memberId) return { ok: false, message: "member_id_required" }

  const snap = await db.collection("members").doc(memberId).get().catch(() => null)
  if (!snap || !snap.data) return { ok: false, message: "not_found" }
  if (snap.data.shopId !== context.shopId) return { ok: false, message: "forbidden" }

  await db.collection("members").doc(memberId).update({
    data: { status: "deleted", updatedAt: Date.now() }
  })
  return { ok: true }
}

async function recordVisit(context, event) {
  const memberId = trimString(event?.memberId)
  const remark = trimString(event?.remark)
  if (!memberId) return { ok: false, message: "member_id_required" }

  const snap = await db.collection("members").doc(memberId).get().catch(() => null)
  if (!snap || !snap.data) return { ok: false, message: "not_found" }
  if (snap.data.shopId !== context.shopId) return { ok: false, message: "forbidden" }

  const now = Date.now()
  const ownerOpenId = context.openId

  const addRes = await db.collection("member_visits").add({
    data: {
      shopId: context.shopId,
      memberId,
      visitedAt: now,
      createdBy: ownerOpenId || "",
      remark: remark || "",
      createdAt: now
    }
  })

  const countRes = await db
    .collection("member_visits")
    .where({ memberId, shopId: context.shopId })
    .count()

  await db.collection("members").doc(memberId).update({
    data: {
      lastVisitAt: now,
      visitCount: countRes.total || 0,
      updatedAt: now
    }
  })

  return { ok: true, data: { visitId: addRes._id, lastVisitAt: now, visitCount: countRes.total || 0 } }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = event?.action || ""

  if (!OPENID) return { ok: false, message: "openid_missing" }

  const context = await ensureShopContext(OPENID)
  if (!context) return { ok: false, message: "shop_context_failed" }

  if (action === "listMembers") return listMembers(context, event)
  if (action === "getMember") return getMember(context, event)
  if (action === "getMemberDetail") return getMemberDetail(context, event)
  if (action === "recordVisit") return recordVisit(context, event)
  if (action === "saveMember") return saveMember(context, event)
  if (action === "deleteMember") return deleteMember(context, event)

  return { ok: false, message: "unknown_action" }
}
