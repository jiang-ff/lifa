# 理发店会员小程序

这是一个面向理发店店主的会员管理小程序基础版，重点解决三个问题：

1. 会员信息不再记在纸本或 Excel 里。
2. 充值、消费、调账都有流水，方便对账。
3. 不同理发店店主登录后只看到自己店铺的会员数据，不再共用一个通用会员库。

## 当前版本能力

- 店主首次进入时，自动创建并绑定自己的店铺。
- 支持维护店铺名称、联系人、电话、地址、经营备注。
- 支持按当前店铺新增、编辑、删除会员。
- 支持会员搜索、排序、余额筛选。
- 支持会员充值、消费、手动调账。
- 支持查看会员近 30 笔流水和充值消费汇总。

## 需求设计

### 角色

- 店主：当前版本唯一操作角色，管理自己店铺的会员和余额。

### 核心业务流程

1. 店主登录小程序。
2. 系统根据微信 `OPENID` 自动识别或创建所属店铺。
3. 店主完善店铺资料。
4. 店主录入会员资料并设置初始余额。
5. 日常通过会员详情页记录充值、消费、调账。
6. 在会员列表查看当前店铺整体会员数、有余额会员数和总余额。

### 关键规则

- 会员必须归属于某一个 `shopId`。
- 手机号仅要求在同一店铺内唯一，不影响其他店铺录入同号客户。
- 余额流水必须记录 `shopId`，避免跨店铺串单。
- 余额不能被消费到负数。
- 非当前店铺的会员不能被查看、编辑、删除、调余额。

## 数据模型

### `shops`

- `name`: 店铺名称
- `ownerOpenId`: 店主微信 `OPENID`
- `contactName`: 联系人
- `phone`: 联系电话
- `address`: 地址
- `note`: 经营备注
- `status`: 状态
- `createdAt`
- `updatedAt`

### `shop_users`

- `shopId`: 店铺 ID
- `userOpenId`: 用户微信 `OPENID`
- `role`: 当前版本默认为 `owner`
- `createdAt`
- `updatedAt`

### `members`

- `shopId`: 所属店铺 ID
- `name`
- `phone`
- `gender`
- `birthday`
- `note`
- `balance`
- `createdAt`
- `updatedAt`

### `member_transactions`

- `shopId`: 所属店铺 ID
- `memberId`
- `type`: `recharge` / `consume` / `adjust`
- `amount`
- `beforeBalance`
- `afterBalance`
- `remark`
- `createdAt`

## 代码结构

- `miniprogram/pages/members/list`: 当前店铺会员列表和门店概览
- `miniprogram/pages/members/edit`: 会员新增和编辑
- `miniprogram/pages/members/detail`: 会员详情和余额流水
- `miniprogram/pages/shop/settings`: 店铺资料设置
- `cloudfunctions/shopService`: 当前店铺上下文和店铺资料维护
- `cloudfunctions/memberService`: 按店铺隔离的会员查询、保存、删除
- `cloudfunctions/adjustBalance`: 按店铺校验后的余额调整

## 系统测试清单

### 功能测试

1. 首次进入小程序，应自动生成默认店铺，并能进入会员列表页。
2. 进入店铺设置页，保存店铺名称、联系人、电话、地址后，再回列表页应能看到最新店铺信息。
3. 新增会员后，应只出现在当前店铺列表中。
4. 同一店铺下录入重复手机号，应提示已存在。
5. 不同店铺下录入相同手机号，应允许保存。
6. 在会员详情页充值后，会员余额和流水都应更新。
7. 在会员详情页消费超出余额时，应提示余额不足。
8. 删除会员后，该会员及其流水应一并删除。

### 隔离测试

1. 使用微信账号 A 新建会员。
2. 使用微信账号 B 登录同一小程序。
3. 账号 B 不应看到账号 A 所属店铺的会员、余额、流水。
4. 账号 B 若直接构造他店会员 ID 调接口，应返回 `forbidden` 或 `not_found`。

### 回归测试

1. 会员搜索按姓名、手机号可用。
2. 会员列表排序和“仅有余额”筛选可用。
3. 会员详情页复制手机号、拨打电话可用。
4. 下拉刷新会员列表、会员详情后数据应同步。

## 部署说明

1. 在微信开发者工具中上传并部署 `shopService`、`memberService`、`adjustBalance` 云函数。
2. 为新云函数安装 `wx-server-sdk` 依赖。
3. 在云开发数据库中创建集合：
   - `shops`
   - `shop_users`
   - `members`
   - `member_transactions`
4. 建议为以下字段建立索引：
   - `shop_users.userOpenId`
   - `members.shopId`
   - `members.shopId + phone`
   - `member_transactions.shopId + memberId + createdAt`

## 当前已知后续优化点

- 支持一个店铺下多员工协作和角色权限。
- 支持消费项目、套餐、次卡，而不只是余额。
- 支持会员到店次数、最近到店时间、复购提醒。
- 支持经营报表和按时间段统计。
