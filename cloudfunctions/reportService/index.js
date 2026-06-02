const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

async function getMembershipByOpenId(openId) {
  const res = await db
    .collection("shop_users")
    .where({ userOpenId: openId, status: _.neq("removed") })
    .limit(1)
    .get()
  return (res.data || [])[0] || null
}

async function ensureShopId(openId) {
  const membership = await getMembershipByOpenId(openId)
  return membership ? membership.shopId : null
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
      const y = todayStart - 86400000
      return { start: y, end: y + 86400000 - 1 }
    }
    case "week":
      return { start: todayStart - 6 * 86400000, end: todayStart + 86400000 - 1 }
    case "month":
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
        end: todayStart + 86400000 - 1
      }
    case "lastMonth": {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()
      const lmEnd = new Date(now.getFullYear(), now.getMonth(), 1).getTime() - 1
      return { start: lm, end: lmEnd }
    }
    default:
      return { start: todayStart - 29 * 86400000, end: todayStart + 86400000 - 1 }
  }
}

async function getStats(openId, event) {
  const shopId = await ensureShopId(openId)
  if (!shopId) return { ok: false, message: "shop_context_failed" }

  const period = event?.period || "month"
  const { start, end } = getDateRange(period, event?.startDate, event?.endDate)

  const txQuery = db
    .collection("member_transactions")
    .where({
      shopId,
      createdAt: _.gte(start).and(_.lte(end))
    })

  const allTx = await txQuery.limit(500).get()
  const transactions = allTx.data || []

  let totalRecharge = 0
  let totalConsume = 0
  const dailyMap = {}

  transactions.forEach((t) => {
    const a = Number(t.amount) || 0
    if (t.type === "recharge") totalRecharge += Math.abs(a)
    if (t.type === "consume") totalConsume += Math.abs(a)

    const day = new Date(t.createdAt)
    const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`
    if (!dailyMap[dayKey]) dailyMap[dayKey] = { date: dayKey, recharge: 0, consume: 0, visits: 0 }
    if (t.type === "recharge") dailyMap[dayKey].recharge += Math.abs(a)
    if (t.type === "consume") dailyMap[dayKey].consume += Math.abs(a)
  })

  const visitsRes = await db
    .collection("member_visits")
    .where({
      shopId,
      visitedAt: _.gte(start).and(_.lte(end))
    })
    .limit(500)
    .get()

  const visits = visitsRes.data || []
  visits.forEach((v) => {
    const day = new Date(v.visitedAt)
    const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`
    if (!dailyMap[dayKey]) dailyMap[dayKey] = { date: dayKey, recharge: 0, consume: 0, visits: 0 }
    dailyMap[dayKey].visits++
  })

  const newMembersRes = await db
    .collection("members")
    .where({
      shopId,
      createdAt: _.gte(start).and(_.lte(end)),
      status: _.neq("deleted")
    })
    .count()

  const totalMembersRes = await db
    .collection("members")
    .where({ shopId, status: _.neq("deleted") })
    .count()

  const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date))

  const memberConsumeMap = {}
  transactions.forEach((t) => {
    if (t.type !== "consume") return
    const a = Math.abs(Number(t.amount) || 0)
    if (!memberConsumeMap[t.memberId]) memberConsumeMap[t.memberId] = 0
    memberConsumeMap[t.memberId] += a
  })

  const topMemberIds = Object.entries(memberConsumeMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map((e) => e[0])

  let topMembers = []
  if (topMemberIds.length > 0) {
    const memberRes = await db
      .collection("members")
      .where({ _id: _.in(topMemberIds) })
      .get()
    const memberMap = {}
    ;(memberRes.data || []).forEach((m) => {
      memberMap[m._id] = m.name || "未命名"
    })
    topMembers = topMemberIds.map((id) => ({
      memberId: id,
      name: memberMap[id] || "未知会员",
      totalConsume: Math.round((memberConsumeMap[id] || 0) * 100) / 100
    }))
  }

  totalRecharge = Math.round(totalRecharge * 100) / 100
  totalConsume = Math.round(totalConsume * 100) / 100
  const totalNet = Math.round((totalRecharge - totalConsume) * 100) / 100

  return {
    ok: true,
    data: {
      period,
      start,
      end,
      summary: {
        totalRecharge,
        totalConsume,
        totalNet,
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
  const { OPENID } = cloud.getWXContext()
  const action = event?.action || "getStats"

  if (!OPENID) return { ok: false, message: "openid_missing" }

  if (action === "getStats") return getStats(OPENID, event)

  return { ok: false, message: "unknown_action" }
}
