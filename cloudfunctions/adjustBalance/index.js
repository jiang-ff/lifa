const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const memberId = event?.memberId
  const type = event?.type
  const amountRaw = Number(event?.amount)
  const remark = typeof event?.remark === "string" ? event.remark.trim() : ""

  if (!memberId) return { ok: false, message: "memberId required" }
  if (!["recharge", "consume", "adjust"].includes(type)) return { ok: false, message: "type invalid" }

  if (!Number.isFinite(amountRaw)) return { ok: false, message: "amount invalid" }
  if (amountRaw === 0) return { ok: false, message: "amount invalid" }
  if (Math.abs(amountRaw) > 1e7) return { ok: false, message: "amount too large" }

  const delta =
    type === "recharge" ? Math.abs(amountRaw) : type === "consume" ? -Math.abs(amountRaw) : amountRaw
  const now = Date.now()

  const res = await db.runTransaction(async (transaction) => {
    const memberRef = transaction.collection("members").doc(memberId)
    const memberSnap = await memberRef.get()
    if (!memberSnap.data) return { ok: false, message: "not_found" }
    const member = memberSnap.data
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
