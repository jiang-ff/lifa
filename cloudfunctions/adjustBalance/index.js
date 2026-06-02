const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

async function getMembershipByOpenId(openId) {
  const res = await db.collection("shop_users").where({ userOpenId: openId }).limit(1).get()
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
  const res = await db.collection("shops").add({
    data: {
      name: "我的理发店",
      ownerOpenId: openId,
      contactName: "",
      phone: "",
      address: "",
      note: "",
      createdAt: now,
      updatedAt: now,
      status: "active"
    }
  })

  return {
    _id: res._id,
    name: "我的理发店"
  }
}

async function ensureShopContext(openId) {
  const now = Date.now()
  let membership = await getMembershipByOpenId(openId)
  let shop = membership ? await getShopById(membership.shopId) : null

  if (!membership) {
    shop = await createShopRecord(openId)
    membership = {
      shopId: shop._id,
      userOpenId: openId,
      role: "owner",
      createdAt: now,
      updatedAt: now
    }
    await db.collection("shop_users").add({ data: membership })
  } else if (!shop) {
    shop = await createShopRecord(openId)
    await db.collection("shop_users").doc(membership._id).update({
      data: {
        shopId: shop._id,
        updatedAt: now
      }
    })
    membership.shopId = shop._id
  }

  return {
    shopId: membership.shopId
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const memberId = event?.memberId
  const type = event?.type
  const amountRaw = Number(event?.amount)
  const remark = typeof event?.remark === "string" ? event.remark.trim() : ""

  if (!OPENID) return { ok: false, message: "openid_missing" }
  if (!memberId) return { ok: false, message: "memberId required" }
  if (!["recharge", "consume", "adjust"].includes(type)) return { ok: false, message: "type invalid" }

  if (!Number.isFinite(amountRaw)) return { ok: false, message: "amount invalid" }
  if (amountRaw === 0) return { ok: false, message: "amount invalid" }
  if (Math.abs(amountRaw) > 1e7) return { ok: false, message: "amount too large" }

  const delta =
    type === "recharge" ? Math.abs(amountRaw) : type === "consume" ? -Math.abs(amountRaw) : amountRaw
  const now = Date.now()
  const context = await ensureShopContext(OPENID)

  const res = await db.runTransaction(async (transaction) => {
    const memberRef = transaction.collection("members").doc(memberId)
    const memberSnap = await memberRef.get()
    if (!memberSnap.data) return { ok: false, message: "not_found" }
    const member = memberSnap.data
    if (member.shopId !== context.shopId) {
      return { ok: false, message: "forbidden" }
    }
    const beforeBalance = typeof member.balance === "number" ? member.balance : 0
    const afterBalance = beforeBalance + delta
    if (afterBalance < 0) {
      return { ok: false, message: "insufficient_balance" }
    }

    await memberRef.update({
      data: {
        balance: _.inc(delta),
        updatedAt: now
      }
    })

    await transaction.collection("member_transactions").add({
      data: {
        shopId: context.shopId,
        memberId,
        type,
        amount: delta,
        beforeBalance,
        afterBalance,
        remark,
        createdAt: now
      }
    })

    return { ok: true, beforeBalance, afterBalance }
  })

  return { ...res, version: "2026-05-09" }
}
