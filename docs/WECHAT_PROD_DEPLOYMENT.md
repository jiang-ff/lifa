# 理发店会员小程序正式上线部署文档

## 1. 文档目标

本文档用于指导项目部署到微信小程序正式环境，覆盖环境准备、云开发配置、云函数部署、提审发布、上线后巡检和回滚。

## 2. 当前项目部署信息

| 项目项 | 当前值 |
| --- | --- |
| 小程序 AppID | `wx95d05dde35d863bb` |
| 项目名 | `lifa-member` |
| 小程序目录 | `miniprogram/` |
| 云函数目录 | `cloudfunctions/` |
| 基础库版本 | `3.4.7` |
| 云函数依赖 | `wx-server-sdk@3.0.4` |

## 3. 上线前目标架构

建议至少准备两个云环境：

- `test`：开发联调、体验版验证
- `prod`：正式环境

运行环境配置在 [miniprogram/config/env.js](c:/Users/whisper/Desktop/lifa/miniprogram/config/env.js)。上线前必须确认：

1. `test.cloudEnvId` 指向测试环境
2. `prod.cloudEnvId` 指向生产环境
3. 正式版只连接 `prod`

## 4. 账号与权限准备

上线前需要准备：

- 微信小程序管理员账号
- 至少 1 个开发者账号
- 微信开发者工具登录权限
- CloudBase 云环境管理权限
- 小程序提审和发布权限

## 5. 发布前检查清单

- `AppID` 正确
- 小程序名称、类目、图标、简介已配置完成
- 隐私政策与用户信息说明已准备
- `miniprogram/config/env.js` 已配置真实 `test/prod` 环境 ID
- 测试用例已执行完成
- 店长 / 员工双角色回归通过
- 首页统计、报表统计已做抽样核对
- 日志与审计功能已验证

## 6. 本地准备

### 6.1 安装微信开发者工具

下载并安装最新稳定版微信开发者工具：

https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html

### 6.2 导入项目

在微信开发者工具中导入项目，确认：

- `AppID = wx95d05dde35d863bb`
- `miniprogramRoot = miniprogram/`
- `cloudfunctionRoot = cloudfunctions/`

对应配置见 [project.config.json](c:/Users/whisper/Desktop/lifa/project.config.json:1)。

### 6.3 配置环境 ID

打开 [miniprogram/config/env.js](c:/Users/whisper/Desktop/lifa/miniprogram/config/env.js)，替换成真实环境 ID，例如：

```js
const ENV_PROFILES = {
  test: {
    key: "test",
    label: "测试环境",
    cloudEnvId: "your-test-env-id",
    description: "开发版与体验版默认使用"
  },
  prod: {
    key: "prod",
    label: "生产环境",
    cloudEnvId: "your-prod-env-id",
    description: "正式版固定使用，上线前请替换为正式环境 ID"
  }
}
```

## 7. 云开发环境准备

### 7.1 创建并绑定云环境

在微信开发者工具或 CloudBase 控制台中创建 `test` 与 `prod` 环境，并绑定到当前小程序 `AppID`。

参考：

- https://docs.cloudbase.net/quick-start/miniprogram

### 7.2 创建数据库集合

在 `test` 与 `prod` 环境都创建以下集合：

- `shops`
- `shop_users`
- `members`
- `member_transactions`
- `member_visits`
- `function_logs`
- `operation_audits`

### 7.3 配置数据库权限

当前前端全部通过云函数访问数据库，云函数也已显式使用管理端数据库客户端。因此正式环境建议统一设置为：

- `仅管理端可读写`

这样可以避免前端直接绕过云函数访问数据库。

参考：

- https://docs.cloudbase.net/database/security-rules
- https://docs.cloudbase.net/error-code/DATABASE_PERMISSION_DENIED

### 7.4 配置索引

建议在 `test` 与 `prod` 都创建以下索引：

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

## 8. 云函数配置与部署

### 8.1 云函数清单

- `shopService`
- `memberService`
- `adjustBalance`
- `reportService`

### 8.2 依赖版本

4 个云函数目录都已固定为：

```json
{
  "dependencies": {
    "wx-server-sdk": "3.0.4"
  }
}
```

不要改回 `latest`。

### 8.3 云函数调用权限

建议云函数设置为“登录用户可调用”，避免匿名访问。

规则示例：

```json
{
  "rules": {
    "*": {
      "invoke": "auth != null"
    }
  }
}
```

参考：

- https://docs.cloudbase.net/cloud-function/security-rules

### 8.4 上传并部署云函数

在微信开发者工具中依次对以下云函数执行“上传并部署：云端安装依赖”：

1. `shopService`
2. `memberService`
3. `adjustBalance`
4. `reportService`

每个云函数部署后检查：

- 云端版本时间已刷新
- 依赖安装成功
- 无语法错误

参考：

- https://docs.cloudbase.net/cloud-function/how-use

## 9. 环境联调建议

### 9.1 测试环境联调

先在开发版确认当前连接的是 `test`：

1. 打开店铺设置页
2. 查看“运行环境”卡片
3. 确认环境标签为测试环境
4. 走一轮完整业务流程：
   - 自动建店
   - 员工邀请码加入
   - 新增会员
   - 充值 / 消费 / 调账
   - 到店登记
   - 查看报表
   - 查看日志

### 9.2 生产环境冒烟

在体验版切换到 `prod` 后，再做一轮最小冒烟：

1. 店长登录成功
2. 可新增会员
3. 可登记到店
4. 可查看报表
5. 设置页可看到最近日志

## 10. 生产数据初始化

正式上线前建议完成以下初始化：

- 创建至少 1 个店长测试账号
- 用店长账号首次进入，自动创建生产店铺
- 验证邀请码、员工加入、会员创建、报表、日志均可正常使用

## 11. 微信公众平台提审准备

### 11.1 基础资料

在微信公众平台检查并补齐：

- 小程序名称
- 类目
- 简介
- 图标
- 联系方式

### 11.2 隐私与合规

本项目会保存以下业务数据，提审前应在隐私政策中如实声明：

- 店铺联系人与联系方式
- 会员姓名、手机号、性别、生日、备注
- 余额与交易流水
- 到店记录
- 员工角色与门店协作关系

建议同步准备：

- 隐私政策链接或正文
- 数据收集用途说明
- 数据删除 / 更正联系方式

### 11.3 体验成员

建议先上传开发版并添加体验成员做 UAT：

- 店长体验账号
- 员工体验账号
- 产品 / 运营验收账号

## 12. 上传代码

### 12.1 上传前确认

- `env.js` 已填写真实 `test/prod` 环境
- 4 个云函数已部署到对应环境
- 数据库权限与索引已配置
- 测试通过

### 12.2 上传版本

在微信开发者工具执行“上传”。

版本号建议：

- `1.0.0`
- `1.0.1`

版本描述建议写清本次上线内容，例如：

```text
1.0.0 正式版：支持多员工协作、会员管理、余额流水、到店登记、经营报表、角色权限、日志审计与双环境切换
```

## 13. 提审说明建议

可在审核备注中填写：

```text
本小程序用于理发店门店会员管理。审核人员首次进入后会自动创建演示店铺，无需注册账号密码。可直接在会员页新增会员，在会员详情页执行到店登记，在报表页查看经营统计，在团队页查看员工协作，在店铺设置页查看店铺资料。
```

## 14. 正式发布

审核通过后，在微信公众平台版本管理中执行“发布”。

发布后正式用户访问的即为当前审核通过版本。

## 15. 上线后巡检

### 15.1 核心链路巡检

1. 首次进入是否自动建店
2. 店长是否可新增会员
3. 店长是否可充值 / 消费 / 调账
4. 员工是否不能调余额和查看报表
5. 到店登记是否成功
6. 报表是否能正常统计
7. 设置页日志是否持续写入

### 15.2 数据巡检

检查数据库：

- `shops` 是否正常新增
- `shop_users` 角色是否正确
- `members` 是否正常写入
- `member_transactions` 是否正常写入
- `member_visits` 是否正常写入
- `function_logs` 是否持续写入
- `operation_audits` 是否持续写入关键操作

### 15.3 性能巡检

观察：

- 首页打开速度
- 会员详情打开速度
- 报表页加载速度
- 云函数错误率

## 16. 回滚方案

如果正式发布后发现严重问题，建议按以下方式处理：

1. 暂停继续提审新版本
2. 在微信公众平台回滚到上一个稳定版本
3. 保留当前生产数据库，不直接删除线上数据
4. 在 `test` 环境修复问题并完成回归
5. 重新上传、提审、发布

## 17. 本项目特别注意事项

### 17.1 环境切换规则

- 开发版默认连接 `test`
- 体验版默认连接 `test`
- 正式版固定连接 `prod`
- 设置页中的环境切换仅用于非正式版

### 17.2 日志与审计

当前版本已接入两类日志：

- `function_logs`：记录云函数调用结果、耗时、角色、错误信息
- `operation_audits`：记录关键业务写操作

建议上线后每周抽查一次，重点看：

- 是否有高频失败调用
- 是否有异常越权尝试
- 是否有关键写操作未落审计

### 17.3 统计准确性

当前版本已修复：

- 首页概览不再受会员列表 `limit(50)` 影响
- 报表不再受交易 / 到店 `limit(500)` 影响

上线后仍建议对大样本门店做定期抽样核对。

## 18. 参考资料

- 微信开发者工具下载：https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html
- CloudBase 小程序快速开始：https://docs.cloudbase.net/quick-start/miniprogram
- CloudBase 云函数使用说明：https://docs.cloudbase.net/cloud-function/how-use
- CloudBase 云函数权限控制：https://docs.cloudbase.net/cloud-function/security-rules
- CloudBase 数据库权限说明：https://docs.cloudbase.net/database/security-rules
- CloudBase 权限报错说明：https://docs.cloudbase.net/error-code/DATABASE_PERMISSION_DENIED
