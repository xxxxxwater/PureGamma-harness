# PureGamma Evidence Trust v0.2.0

[English](README.md) | 中文

提供会话内 Evidence Ledger（证据账本）、Unknown Registry（未知项登记表）及**绑定目标的签名验证关卡**的 Cordis 插件。参见[实现](index.js)、[签名校验器](attestations.mjs)及 [CI 证明生成器](verify-ci-and-sign.mjs)。

## 兼容性与安全默认值

PureGamma 桌面安装器以 AUDIT 模式挂载本插件，不拦截工具。按会话保存的哈希链账本记录最终工具名、结果状态、摘要和调用顺序，不存储原始参数及输出。未知问题按原文保存，请勿在问题文本中放入密钥。

V2 ENFORCE 模式**要求可信的 Ed25519 公钥及明确的发布或交易签名规则**。旧版仅凭普通验证工具返回成功的策略不再授权受保护的执行。protectedTools 中未分类的名称会被拒绝。更新插件后，请在重启前检查现有 profile 覆盖配置。

### 发布证明

签名载荷包括确切仓库、40 位十六进制提交 SHA、64 位十六进制构建产物 SHA-256、十进制 CI 运行 ID、固定工作流、成功结论、签发与到期时间以及签名者身份。工具自身的参数必须与全部字段一致。

GitHub Actions 证明生成器核验运行状态、event=push、branch=master、工作流 ID、头部提交，以及恰好一个具有 GitHub 提供的 sha256 摘要的 CI 产物。该摘要绑定 **Actions 产物归档**，并非从中提取的每个可执行文件。部署流程若使用提取后的文件，需另外签署逐文件清单。

签名采用 Ed25519，待签名字节为 "PureGamma.Trust.Attestation.v1\n"，随后接载荷的规范 JSON。公钥必须显式固定，并限定为发布或交易用途。SHA 哈希或工具成功输出本身均不构成授权。

### 交易证明

签名交易声明绑定**确切订单参数**的 SHA-256：venue、account、symbol、side、quantity、price、notional_usd、leverage、reduce_only、client_order_id；同时绑定交易场所、账户、品种、名义金额、杠杆、允许决定、到期时间和可信签名者。

关卡检查配置的账户与交易场所白名单、最大名义金额和最大杠杆。有效期最多 300 秒，建议不超过 120 秒。同一主机上的不同会话之间，每个订单摘要只能由一份证明授权一次；.spent 预留操作具有原子性，执行失败不会退还。重新签发信封也不能绕过已消耗的订单摘要。

本地防护独立按 quantity * price * linearContracts[symbol] 重算预期美元敞口，并拒绝缺少品种、超过 maxNotionalUsd，或偏差超出 maxDeviationBps 的请求。偏差允许范围为 0 至 100 个基点，默认 10。linearContracts 必须显式列出以美元报价的线性合约，并使用经交易场所核验的每张合约对应基础资产数量。**不可把该算法用于反向、quanto 或非美元报价产品**，这些产品需独立的类型化适配器及经验证的换算模型。数学上不一致的签名订单不会仅因存在签名者而变得安全。

外部风险签名服务**必须**独立核验账户余额、可用杠杆、标记价格、强平缓冲、合约乘数及交易权限。本插件不连接交易所，也不执行持仓对账。启用实盘前，必须先通过模拟交易及故障注入测试验证外部风险服务和订单适配器。多主机安装应使用集中式原子预留服务。

### 跨会话证据与未知项

pg_trust_link_evidence 不导入原始输出。它检查来源会话的哈希链，并把确切证据 ID 及来源账本头摘要关联到当前会话。这类关联是历史引用，不是签名授权。签名证明文件保存在主机本地共享保险库中；仅在全部目标声明仍匹配时，各会话才可复用发布证明。

ENFORCE 模式要求使用**新签发的签名证明**关闭未知项；所有已解决的未知项必须引用确切匹配的证明。旧版验证工具的成功结果仅可在 AUDIT 模式关闭未知项，不能用于 ENFORCE。

## 配置示例

通过 PureGamma 安装器安装；内置补丁默认维持 Audit 模式。以下示例会替换一条**完整**的 profile 补丁行。请用实际值替换示例密钥和工具标识；离线生成新的 Ed25519 密钥对，此处只固定公钥 PEM，绝不可发布私钥 PEM：

~~~yaml
- patch:
    id: evidence-trust
    config:
      mode: enforce
      protectedTools: []
      verifierTools: []
      mutationTools: []
      attestations:
        trustedKeys:
          - id: release-2026-10
            kinds: [release]
            publicKeyPem: |
              -----BEGIN PUBLIC KEY-----
              REPLACE_WITH_GENERATED_PUBLIC_KEY
              -----END PUBLIC KEY-----
        release:
          tools: [publish_release]
          repository: xxxxxwater/PureGamma-harness
          workflow: Verified Production Build
          maxAgeSeconds: 1800
          paths:
            repository: repository
            commit_sha: commit_sha
            artifact_sha256: artifact_sha256
            run_id: run_id
            workflow: workflow
~~~

独立的模拟交易示例；若同时使用两类规则，请合并到同一个 attestations 对象下：

~~~yaml
attestations:
  trustedKeys:
    - id: risk-gateway-v1
      kinds: [trade]
      publicKeyPem: "<public Ed25519 PEM>"
  trade:
    tools: [trade_place]
    allowedVenues: [binance-pm]
    allowedAccounts: [paper-1]
    maxNotionalUsd: 1000
    maxLeverage: 2
    linearContracts: { BTCUSDT: 1 }
    maxDeviationBps: 10
    maxAgeSeconds: 90
    paths:
      venue: venue
      account: account
      symbol: symbol
      side: side
      quantity: quantity
      price: price
      notional_usd: notional_usd
      leverage: leverage
      reduce_only: reduce_only
      client_order_id: client_order_id
~~~

严格路径必须匹配实际工具参数 schema，不能照搬示例名称。未受保护的别名、通用 shell 工具及直接经纪商 API 均在此按名称防护的范围之外，必须纳入沙箱或明确保护。仅配置旧版工具成功验证器的 enforce 策略会在插件启动时失败。

## CI 签名流程

1. 离线创建 Ed25519 签名密钥对，仅在本地 Harness profile 固定公钥 PEM，绝不把私钥复制到聊天会话。
2. 创建 GitHub environment puregamma-trust-signing，配置必要审核人，把 PG_TRUST_CI_PRIVATE_KEY_PEM 存为 environment secret，并把 PG_TRUST_CI_WORKFLOW_ID 与 PG_TRUST_CI_KEY_ID 定义为 environment variables；只允许可信 CI 工作流 ID。
3. 成功且可信的 master PUSH 工作流必须上传具有 GitHub sha256 摘要的 Actions 产物。使用其运行 ID 和确切产物名手动触发 .github/workflows/puregamma-trust-attest.yml；签名器会在生成信封前核验 GitHub 元数据。
4. 下载 puregamma-signed-attestation 产物，把其中 JSON 信封交给 pg_trust_import_attestation。
5. 使用 pg_trust_check_gate 预览关卡，提供实际发布工具名及完整参数；它本身不能授予执行权。

独立的 sign-attestation.mjs 是供离线、独立核验的风险网关进程使用的密钥操作原语，不确认 CI 事实或账户安全；不得对仅由智能体编写的载荷直接签名。

## 智能体工具

| 工具 | 功能 |
| --- | --- |
| pg_trust_status | 当前会话的证据、关联、签名证明数量及模式 |
| pg_trust_open_unknown | 记录由本地证据 ID 支撑的问题 |
| pg_trust_resolve_unknown | Audit 使用旧版 verification_evidence_id；enforce 使用签名 attestation_id |
| pg_trust_import_attestation | 核验 Ed25519 签名、范围与有效期，并保存签名信封 |
| pg_trust_link_evidence | 关联另一会话的确切历史证据 |
| pg_trust_check_gate | 使用 target_tool 和 target_arguments 执行只读预检 |

账本位于 $DSH_HOME/pg-trust-ledgers/<sha256(session-id)>.jsonl；签名信封位于 $DSH_HOME/pg-trust-ledgers/attestations-v1/*.json；已消耗标记也保存在该处。单会话写入锁及持久化尾部检查拒绝并发或过期追加，包括长度相同的尾部篡改。崩溃或不确定写入会保留写入锁并阻止后续写入；手工恢复前应调查并备份账本。多个进程不得同时写入同一会话，该锁不是分布式锁。

签名授权会在派发前记录为仅含哈希的凭据，其中包含签名证明 ID、工具身份和规范目标摘要。凭据写入失败会拒绝操作，已预留的交易仍视为消耗。这些凭据是审计记录，不是可复用授权。

账本可以检测修改，但无法阻止有权限的本地攻击者重写全部记录。共享保险库仅在本机有效；生产多主机部署需要集中式事务授权服务。

## 测试与启用

~~~sh
node --test pg-harness/plugins/dsh-evidence-trust/*.test.mjs pg-harness/install.test.mjs
~~~

CI 也运行 Node 语法检查和插件兼容性测试。这些测试验证插件行为，不验证外部签名机构、发布流程或实盘交易适配器的正确性。

使用 PureGamma 安装器安装或更新插件，然后重启 Harness。现有 V1 账本仍可读取；启用 enforce 前，请先在审计或模拟交易环境测试。
