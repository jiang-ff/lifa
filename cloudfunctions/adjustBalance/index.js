const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database({ env: cloud.DYNAMIC_CURRENT_ENV })
const _ = db.command

const FUNCTION_NAME = "adjustBalance"

const ROLE_PERMISSIONS = {
  manager: ["balance.write"],
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

async function ensureShopContext(openId) {
  const membership = await getMembershipByOpenId(openId)
  if (!membership) return null

  const role = normalizeRole(membership.role)
  return {
    shopId: membership.shopId,
    openId,
    role,
    canWriteBalance: can(role, "balance.write")
  }
}

exports.main = async (event) => {
  const startedAt = Date.now()
  const { OPENID } = cloud.getWXContext()
  const memberId = event?.memberId
  const type = event?.type
  const amountRaw = Number(event?.amount)
  const remark = typeof event?.remark === "string" ? event.remark.trim() : ""

  let context = null
  let result = null
  let errorMessage = ""

  try {
    if (!OPENID) {
      result = { ok: false, message: "openid_missing" }
      return result
    }
    if (!memberId) {
      result = { ok: false, message: "memberId required" }
      return result
    }
    if (!["recharge", "consume", "adjust"].includes(type)) {
      result = { ok: false, message: "type invalid" }
      return result
    }
    if (!Number.isFinite(amountRaw) || amountRaw === 0) {
      result = { ok: false, message: "amount invalid" }
      return result
    }
    if (Math.abs(amountRaw) > 1e7) {
      result = { ok: false, message: "amount too large" }
      return result
    }

    context = await ensureShopContext(OPENID)
    if (!context) {
      result = { ok: false, message: "shop_context_failed" }
      return result
    }
    if (!context.canWriteBalance) {
      result = { ok: false, message: "forbidden" }
      return result
    }

    const delta =
      type === "recharge" ? Math.abs(amountRaw) : type === "consume" ? -Math.abs(amountRaw) : amountRaw
    const now = Date.now()

    result = await db.runTransaction(async (transaction) => {
      const memberRef = transaction.collection("members").doc(memberId)
      const memberSnap = await memberRef.get()
      if (!memberSnap.data || memberSnap.data.status === "deleted") return { ok: false, message: "not_found" }

      const member = memberSnap.data
      if (member.shopId !== context.shopId) return { ok: false, message: "forbidden" }

      const beforeBalance = typeof member.balance === "number" ? member.balance : 0
      const afterBalance = beforeBalance + delta
      if (afterBalance < 0) return { ok: false, message: "insufficient_balance" }

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

      return {
        ok: true,
        beforeBalance,
        afterBalance,
        memberName: member.name || "",
        memberPhone: member.phone || ""
      }
    })

    if (result.ok === true) {
      await writeAuditLog({
        shopId: context.shopId,
        operatorOpenId: context.openId,
        operatorRole: context.role,
        targetType: "member",
        targetId: memberId,
        action: `balance.${type}`,
        detail: {
          amount: result.afterBalance - result.beforeBalance,
          beforeBalance: result.beforeBalance,
          afterBalance: result.afterBalance,
          remark,
          memberName: result.memberName,
          memberPhone: result.memberPhone
        }
      })
    }

    return { ...result, version: "2026-06-04" }
  } catch (error) {
    errorMessage = summarizeError(error)
    console.error(`${FUNCTION_NAME} failed`, error)
    result = { ok: false, message: "internal_error" }
    return result
  } finally {
    await writeFunctionLog({
      functionName: FUNCTION_NAME,
      action: type || "",
      openId: OPENID || "",
      shopId: context?.shopId || "",
      role: context?.role || "",
      targetId: memberId || "",
      durationMs: Date.now() - startedAt,
      ...pickActionResult(result),
      errorMessage
    })
  }
}
