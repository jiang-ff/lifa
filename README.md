# 理发店会员小程序

这是一个面向理发店门店经营场景的小程序，围绕会员管理、员工协作、到店记录、余额流水和经营报表做了一套轻量化闭环。

## 当前能力

- 首次登录自动创建并绑定店铺
- 一个店铺下支持多员工协作，支持邀请码入店
- 角色权限区分 `manager` / `staff`
- 会员新增、编辑、软删除
- 会员搜索、排序、仅看有余额会员
- 会员充值、消费、调账，并保留余额流水
- 会员到店登记、到店次数、最近到店时间、复购提醒
- 经营报表支持今天 / 近 7 天 / 本月 / 上月统计
- 首页会员概览按全量数据统计，不受列表 `limit(50)` 影响
- 报表按分页拉全量交易与到店数据，不受 `limit(500)` 截断影响
- 云函数调用日志与业务操作审计日志
- 开发版 / 体验版支持测试环境与生产环境切换，正式版固定生产环境

## 角色权限

### 店长 `manager`

- 修改店铺资料
- 管理员工与邀请码
- 新增、编辑、删除会员
- 充值、消费、调账
- 登记到店
- 查看经营报表
- 查看监控日志与审计日志

### 员工 `staff`

- 新增、编辑会员
- 登记到店
- 不可删除会员
- 不可调余额
- 不可查看经营报表
- 不可修改店铺资料
- 不可管理员工

## 关键数据集合

- `shops`
- `shop_users`
- `members`
- `member_transactions`
- `member_visits`
- `function_logs`
- `operation_audits`

## 代码结构

- `miniprogram/pages/members/list`：会员首页与门店概览
- `miniprogram/pages/members/edit`：会员新增与编辑
- `miniprogram/pages/members/detail`：会员详情、到店、流水
- `miniprogram/pages/reports/dashboard`：经营报表
- `miniprogram/pages/shop/team`：团队与角色管理
- `miniprogram/pages/shop/settings`：店铺资料、环境切换、日志查看
- `miniprogram/config/env.js`：测试 / 生产双环境配置
- `cloudfunctions/shopService`：店铺上下文、角色权限、团队管理、日志读取
- `cloudfunctions/memberService`：会员查询、保存、删除、到店登记
- `cloudfunctions/adjustBalance`：充值、消费、调账
- `cloudfunctions/reportService`：经营报表统计

## 云函数依赖

4 个云函数目录统一固定为：

```json
{
  "dependencies": {
    "wx-server-sdk": "3.0.4"
  }
}
```

上线时不要再用 `latest`，避免后续自动漂移。

## 环境切换

运行环境配置在 [miniprogram/config/env.js](c:/Users/whisper/Desktop/lifa/miniprogram/config/env.js)：

- `test`：开发版、体验版默认使用
- `prod`：正式版固定使用

上线前请把 `prod.cloudEnvId` 改成真实生产环境 ID。

## 建议索引

- `shop_users.userOpenId`
- `shop_users.shopId + status`
- `members.shopId + status`
- `members.shopId + phone + status`
- `member_transactions.shopId + createdAt`
- `member_transactions.shopId + memberId + createdAt`
- `member_visits.shopId + visitedAt`
- `member_visits.shopId + memberId + visitedAt`
- `function_logs.shopId + createdAt`
- `operation_audits.shopId + createdAt`

## 文档

- 测试用例文档：[docs/TEST_CASES.md](c:/Users/whisper/Desktop/lifa/docs/TEST_CASES.md)
- 微信正式上线部署文档：[docs/WECHAT_PROD_DEPLOYMENT.md](c:/Users/whisper/Desktop/lifa/docs/WECHAT_PROD_DEPLOYMENT.md)

## 关键规则

- 所有会员、流水、到店记录都必须归属到某个 `shopId`
- 同店手机号唯一，不同店可重复
- 会员删除采用软删除
- 高风险动作必须以后端权限校验为准
- 统计口径必须基于全量数据，不允许依赖单页列表结果
- 正式版不允许切换到测试环境

## 当前建议的测试重点

1. 店长 / 员工双角色回归
2. 超过 50 个会员后的首页统计准确性
3. 超过 500 条交易、到店记录后的报表准确性
4. 环境切换后是否命中正确云环境
5. 关键操作后是否写入 `function_logs` 与 `operation_audits`
