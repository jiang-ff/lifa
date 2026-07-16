const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database({ env: cloud.DYNAMIC_CURRENT_ENV })
const _ = db.command

const FUNCTION_NAME = "reportService"

const ROLE_PERMISSIONS = {
  manager: ["report.view"],
  staff: []
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

async function getMembershipByOpenId(openId) {
  const res = await db
    .collection("shop_users")
    .where({ userOpenId: openId, status: _.neq("removed") })
    .limit(1)
    .get()
  return (res.data || [])[0] || null
}

async function ensureShopContext(openId) {
  const membership = await getMembershipByOpenId(openId)
  if (!membership) return null

  const role = normalizeRole(membership.role)
  return {
    shopId: membership.shopId,
    role,
    canViewReport: can(role, "report.view")
  }
}

function getDateRange(period, startDate, endDate) {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()

  if (startDate && endDate) {
    return { start: new Date(startDate).getTime(), end: new Date(endDate).getTime() + 86400000 - 1 }
  }

  switch (period) {
    case "today":
      return { start: todayStart, end: todayStart + 86400000 - 1 }
    case "yesterday": {
      const yesterdayStart = todayStart - 86400000
      return { start: yesterdayStart, end: yesterdayStart + 86400000 - 1 }
    }
    case "week":
      return { start: todayStart - 6 * 86400000, end: todayStart + 86400000 - 1 }
    case "month":
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
        end: todayStart + 86400000 - 1
      }
    case "lastMonth": {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()
      const monthEnd = new Date(now.getFullYear(), now.getMonth(), 1).getTime() - 1
      return { start: monthStart, end: monthEnd }
    }
    default:
      return { start: todayStart - 29 * 86400000, end: todayStart + 86400000 - 1 }
  }
}

async function fetchAllPaged(collectionName, whereClause, orderField, fieldSpec) {
  const countRes = await db.collection(collectionName).where(whereClause).count()
  const total = countRes.total || 0
  const batchSize = 100
  const records = []

  for (let skip = 0; skip < total; skip += batchSize) {
    let query = db
      .collection(collectionName)
      .where(whereClause)
      .orderBy(orderField, "asc")
      .skip(skip)
      .limit(batchSize)

    if (fieldSpec) {
      query = query.field(fieldSpec)
    }

    const res = await query.get()
    records.push(...(res.data || []))
  }

  return records
}

function buildDayKey(timestamp) {
  const day = new Date(timestamp)
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`
}

async function getStats(context, event) {
  if (!context.canViewReport) return { ok: false, message: "forbidden" }

  const period = event?.period || "month"
  const { start, end } = getDateRange(period, event?.startDate, event?.endDate)
  const txWhere = { shopId: context.shopId, createdAt: _.gte(start).and(_.lte(end)) }
  const visitWhere = { shopId: context.shopId, visitedAt: _.gte(start).and(_.lte(end)) }

  const [transactions, visits, newMembersRes, totalMembersRes] = await Promise.all([
    fetchAllPaged("member_transactions", txWhere, "createdAt", {
      memberId: true,
      type: true,
      amount: true,
      createdAt: true
    }),
    fetchAllPaged("member_visits", visitWhere, "visitedAt", {
      memberId: true,
      visitedAt: true
    }),
    db
      .collection("members")
      .where({
        shopId: context.shopId,
        createdAt: _.gte(start).and(_.lte(end)),
        status: _.neq("deleted")
      })
      .count(),
    db.collection("members").where({ shopId: context.shopId, status: _.neq("deleted") }).count()
  ])

  let totalRecharge = 0
  let totalConsume = 0
  const dailyMap = {}
  const memberConsumeMap = {}

  for (const item of transactions) {
    const amount = Math.abs(Number(item.amount) || 0)
    const dayKey = buildDayKey(item.createdAt)
    if (!dailyMap[dayKey]) dailyMap[dayKey] = { date: dayKey, recharge: 0, consume: 0, visits: 0 }

    if (item.type === "recharge") {
      totalRecharge += amount
      dailyMap[dayKey].recharge += amount
    }

    if (item.type === "consume") {
      totalConsume += amount
      dailyMap[dayKey].consume += amount
      memberConsumeMap[item.memberId] = (memberConsumeMap[item.memberId] || 0) + amount
    }
  }

  for (const item of visits) {
    const dayKey = buildDayKey(item.visitedAt)
    if (!dailyMap[dayKey]) dailyMap[dayKey] = { date: dayKey, recharge: 0, consume: 0, visits: 0 }
    dailyMap[dayKey].visits += 1
  }

  const daily = Object.values(dailyMap)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((item) => ({
      ...item,
      recharge: Math.round(item.recharge * 100) / 100,
      consume: Math.round(item.consume * 100) / 100
    }))

  const topMemberIds = Object.entries(memberConsumeMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([memberId]) => memberId)

  let topMembers = []
  if (topMemberIds.length > 0) {
    const memberRes = await db.collection("members").where({ _id: _.in(topMemberIds) }).get()
    const memberMap = {}
    for (const member of memberRes.data || []) {
      memberMap[member._id] = member.name || "未命名"
    }

    topMembers = topMemberIds.map((memberId) => ({
      memberId,
      name: memberMap[memberId] || "未知会员",
      totalConsume: Math.round((memberConsumeMap[memberId] || 0) * 100) / 100
    }))
  }

  totalRecharge = Math.round(totalRecharge * 100) / 100
  totalConsume = Math.round(totalConsume * 100) / 100

  return {
    ok: true,
    data: {
      period,
      start,
      end,
      summary: {
        totalRecharge,
        totalConsume,
        totalNet: Math.round((totalRecharge - totalConsume) * 100) / 100,
        newMembers: newMembersRes.total || 0,
        totalMembers: totalMembersRes.total || 0,
        totalVisits: visits.length
      },
      daily,
      topMembers,
      transactionCount: transactions.length
    }
  }
}

exports.main = async (event) => {
  const startedAt = Date.now()
  const { OPENID } = cloud.getWXContext()
  const action = event?.action || "getStats"

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

    if (action === "getStats") result = await getStats(context, event)
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
