# Light PBFT

![许可证](https://img.shields.io/github/license/pluveto/light-pbft?style=flat-square)

一种在 TypeScript 中实现的简单 OSDI PBFT（Practical Byzantine Fault Tolerance）协议。

## 特性

- [x] 完整的 PBFT 协议
  - [x] 3 阶段 BFT 共识（预准备、准备、提交）
  - [x] 检查点机制
  - [x] 动态视图切换
  - [x] 日志缓冲
  - [x] 垃圾回收
  - [x] 验证，包括摘要、序列号、视图号（在水印之间）、等等
  - [x] SECP256K1 签名，SHA256 消息摘要
- [x] 非常详细的日志记录，便于调试和学习
- [x] 具备单元测试和集成测试
- [x] 简单的命令行服务器/客户端
  - [x] REPL 交互式客户端
- [x] 支持自定义网络层
  - 默认：基于 HTTP 的 JSON-RPC
- [x] 支持自定义状态机和存储层
  - 默认：简单的内存存储状态机

**警告**：

- 由于 OSDI99 PBFT 协议不支持延迟节点恢复，因此此实现不适用于生产环境。
- 签名验证已经实现并且可以正常工作，但是由于效率较低且未优化，在测试期间禁用了该功能。

## 使用方法

### 命令

- `pnpm run test`：运行单元测试和集成测试。
- `pnpm run servers`：同时在一个终端中启动所有定义的节点。
- `pnpm run server <node-name>`：启动一个服务器节点。
  - `node-name`：节点的名称，应在配置文件中定义。以下相同。
- `pnpm run client <client-name>`：启动一个客户端节点。
  - `client-name`：客户端的名称。
- `pnpm run keygen <num>`：生成节点或客户端的密钥对。
  - `num`：要生成的密钥对数量。

**注意**：可以使用 `LIGHT_PBFT_CLUSTER_CONFIG` 环境变量指定配置文件的路径。如果未指定，默认值为 `configs/cluster.json`。
例如，你可以运行 `LIGHT_PBFT_CLUSTER_CONFIG=configs/cluster.json pnpm run server node1` 来启动在给定配置文件中定义的名为 node1 的服务器节点。

服务器：

<img src="https://raw.githubusercontent.com/pluveto/0images/master/2023/12/upgit_20231211_1702224876.png" alt="pbft servers" width="500" />

CLI 客户端：

<img src="https://raw.githubusercontent.com/pluveto/0images/master/2023/12/upgit_20231211_1702224932.png" alt="pbft client" width="500px" />

客户端 CLI 命令：

- `help`：打印此消息
- `exit`：退出客户端
- `request <payload>`：向 BFT 集群发送请求
  - `payload`：命令字符串。例如：`key1:value1` 将 key1 设置为 value1，`key1:` 将 key1 设置为空字符串，`key1` 将查询 key1
- `find-master`：查找主节点
- `status`：查询所有节点的状态
- `corrupt <node-name>`：使节点发生故障
  - `node-name`：要使其发生故障的节点的名称

当执行 `request` 命令时，客户端将将其发送到集群中的所有节点，并等待 f+1 个回复。（这是对原始 PBFT 协议的轻微改进，原始协议只将请求发送到主节点。）

你可以调用 `corrupt <master-name>` 来使主节点发生故障，并观察视图切换过程。

**注意**：在启动视图切换过程之前，至少需要一个检查点。因此，在调用 `corrupt <master-name>` 之前，请确保已执行了一些 `request` 命令并生成了检查点。

### 设置命令

- 当执行 `pnpm run client <client-name>` 时，某些命令可以自动执行。它们在 `src/cmd/client.ts` 中定义，例如：

```js
[
    ['status'],
    ['find-master'],
    ['request', 'key1:value1'],
    ['status']
]
```

你可以根据需要将它们更改为其他命令。

## 配置文件结构

为了方便配置系统，我们使用 JSON 文件来指定系统配置。以下是配置文件的结构。

### SystemConfig

顶级配置对象，表示系统配置。它具有以下属性：

- `signature`：指定签名配置的 SignatureConfig 对象。
- `clients`：表示客户端配置的 SenderConfig 对象数组。
- `nodes`：表示节点配置的 NodeConfig 对象数组。
- `params`：指定各种系统参数的 ParamConfig 对象。

### SignatureConfig

表示签名配置，具有以下属性：

- `enabled`：一个布尔值，指示是否启用签名验证。

### ParamConfig

表示系统参数配置，具有以下属性：

- `f`：表示容忍的最大故障节点数的整数。
- `k`：用于计算高水位标记的大数。它与 OSDI99 论文中的 `k` 稍有不同。
  实际上，在这里 `k` 表示检查点生成间隔，它是论文中 `k` 的一半。
  高水位标记计算公式为 `2 * k + lowWaterMark`。

### SenderConfig

表示发送方（客户端或节点）的配置，具有以下属性：

- `name`：发送方的名称。
- `pubkey`：发送方的公钥。
- `prikey`：发送方的私钥。

### NodeConfig

表示节点的配置，具有以下属性：

- `host`：节点的主机地址。
- `port`：节点的端口号。
- `name`：节点的名称。
- `pubkey`：节点的公钥。
- `prikey`：节点的私钥。

### 配置模式

配置模式请参见 [../src/config.ts](../src/config.ts)。

### 示例配置文件

示例配置文件（`cluster.json`）的结构如下：

```json
{
  "signature": {
    "enabled": true
  },
  "nodes": [
    {
      "name": "node1",
      "host": "localhost",
      "port": 3000,
      "pubkey": "public_key_1",
      "prikey": "private_key_1"
    },
    {
      "name": "node2",
      "host": "localhost",
      "port": 3001,
      "pubkey": "public_key_2",
      "prikey": "private_key_2"
    }
  ],
  "clients": [
    {
      "name": "client1",
      "pubkey": "client_public_key_1",
      "prikey": "client_private_key_1"
    }
  ],
  "params": {
    "f": 0,
    "k": 100
  }
}
```

此配置文件指定了一个具有一个客户端（`client1`）和两个节点（`node1` 和 `node2`）的系统。启用了签名验证，并且系统参数设置为 `f` 等于 0，`k` 等于 100。

**注意**：

1. `f` 应计算为 `floor((n - 1) / 3)`，其中 `n` 是系统中节点的数量。
2. `k` 应设置为一个较大的数（例如 100），以避免过于频繁地进行检查点。
3. `prikey` 字段仅用于测试。在实际系统中，私钥应保密。实际上，我们已经对配置文件应用了 `maskPriKeys` 函数，以在加载到节点之前掩盖其他节点的私钥，这遵循了最小特权和知识原则。

## 消息

这里定义了协议中使用的消息。

### 错误处理

#### ErrorCode

错误代码用于指示特定的错误类型。它具有以下值：

- `DuplicatedMsg`：表示重复的消息。
- `InternalError`：表示内部错误。
- `InvalidDigest`：表示无效的摘要。
- `InvalidRequest`：表示无效的请求。
- `InvalidSequence`：表示无效的序列号。
- `InvalidSignature`：表示无效的消息签名。
- `InvalidStatus`：表示无效的状态。
- `InvalidType`：表示无效的消息类型。
- `InvalidView`：表示无效的视图。
- `NotMaster`：表示节点不是主节点。
- `Unknown`：表示未知错误。
- `UnknownSender`：表示未知的发送方。
- `ViewChanging`：表示正在进行视图更改。

#### ErrorMsg

表示错误消息，具有以下属性：

- `type`：消息的类型，设置为 `'error'`。
- `code`：指示特定错误的 ErrorCode。
- `message`：可选的错误消息。

#### OkMsg

表示成功消息，具有以下属性：

- `type`：消息的类型，设置为 `'ok'`。
- `message`：可选的携带消息。

### 自定义消息

这些消息不是标准 PBFT 协议的一部分，但用于改进我们的实现的可用性。

删除它们不会影响协议的正确性。

#### FindMasterMsg

表示查找主节点的消息，具有以下属性：

- `type`：消息的类型，设置为 `'find-master'`。

#### QueryStatusMsg

表示查询节点状态的消息，具有以下属性：

- `type`：消息的类型，设置为 `'query-status'`。

#### MasterInfoMsg

表示包含主节点信息的消息，具有以下属性：

- `type`：消息的类型，设置为 `'master-info'`。
- `name`：主节点的名称。

#### CorruptMsg

表示使节点发生故障（使其变为有错误）的消息，具有以下属性：

- `type`：消息的类型，设置为 `'corrupt'`。
- `name`：要使其发生故障的节点的名称。

#### NodeStatusMsg<TAutomataStatus>

表示包含节点状态的消息，具有以下属性：

- `type`：消息的类型，设置为 `'node-status'`。
- `view`：当前视图号。
- `master`：主节点的名称。
- `automata`：自动机的状态。
- `params`：配置参数。
- `height`：节点的高度。
- `lowWaterMark`：低水位标记值。
- `highWaterMark`：高水位标记值。

#### QueryAutomataMsg

表示查询自动机的消息，具有以下属性：

- `type`：消息的类型，设置为 `'query-automata'`。
- `command`：查询自动机的命令。

### 共识协议消息

#### RequestMsg

表示请求消息，具有以下属性：

- `type`：消息的类型，设置为 `'request'`。
- `timestamp`：请求的时间戳。
- `payload`：请求的有效载荷。

#### ReplyMsg

表示回复消息，具有以下属性：

- `type`：消息的类型，设置为 `'reply'`。
- `view`：视图号。
- `timestamp`：回复的时间戳。
- `node`：节点标识符。
- `result`：回复的结果。

#### CommitMsg

表示提交消息，具有以下属性：

- `type`：消息的类型，设置为 `'commit'`。
- `view`：视图号。
- `sequence`：序列号。
- `digest`：摘要值。
- `node`：节点标识符。

#### PrePrepareMsg

表示预准备消息，具有以下属性：

- `type`：消息的类型，设置为 `'pre-prepare'`。
- `view`：视图号。
- `sequence`：序列号。
- `digest`：摘要值。
- `request`：与预准备消息关联的 RequestMsg。

#### PrepareMsg

表示准备消息，具有以下属性：

- `type`：消息的类型，设置为 `'prepare'`。
- `view`：视图号。
- `sequence`：序列号。
- `digest`：摘要值。
- `node`：节点标识符。

### 本地事件消息

#### CommittedLogMsg

表示已提交日志消息，具有以下属性：

- `type`：消息的类型，设置为 `'committed'`。
- `view`：视图号。
- `sequence`：序列号。
- `digest`：摘要值。
- `node`：节点标识符。

#### PreparedLogMsg

表示已准备日志消息，具有以下属性：

- `type`：消息的类型，设置为 `'prepared'`。
- `view`：视图号。
- `sequence`：序列号。
- `digest`：摘要值。
- `node`：节点标识符。

### 检查点和视图更改消息

#### CheckpointMsg

表示检查点消息，具有以下属性：

- `type`：消息的类型，设置为 `'checkpoint'`。
- `sequence`：序列号。
- `digest`：状态机的摘要值。
- `node`：节点标识符。

#### ViewChangeMsg

表示视图更改消息，具有以下属性：

- `type`：消息的类型，设置为 `'view-change'`。
- `view`：要更改的视图号。
- `node`：发起视图更改的节点标识符。
- `sequence`：最后一个稳定检查点的序列号。
- `proof`：表示 2f+1 个稳定日志的 CheckpointMsg 数组。
- `pendings`：表示待处理的预准备和准备消息的 PendingPrepare 数组。

#### PendingPrepare

表示待处理的预准备和准备消息，具有以下属性：

- `prePrepareMsg`：与待处理准备关联的 PrePrepareMsg。
- `prepareMsgs`：与待处理准备关联的 PrepareMsg 数组。

#### NewViewMsg

表示新视图消息，具有以下属性：

- `type`：消息的类型，设置为 `'new-view'`。
- `view`：要更改为的视图号。
- `sequence`：最后一个稳定检查点的序列号。
- `proof`：表示 2f+1 个视图更改消息的 ViewChangeMsg 数组。
- `pendings`：表示 2f+1 个预准备消息的 PrePrepareMsg 数组。

### LogMessage

表示可以记录的各种消息，包括：

- PrePrepareMsg
- PrepareMsg
- CommitMsg
- CommittedLogMsg
- PreparedLogMsg
- CheckpointMsg
- ViewChangeMsg
- NewViewMsg

### ClientMessage

表示客户端发送的消息，包括：

- RequestMsg
- FindMasterMsg
- CorruptMsg
- QueryStatusMsg
- QueryAutomataMsg

### SourcedMessage

表示带有 'node' 字段的消息。

当启用签名时，协议将验证消息的签名者与节点字段是否相同。

## 自动机

自动机是 PBFT 协议构建在其上的状态机，并且可以通过事务进行传输。

我们的节点不依赖于特定的自动机实现，而是使用接口与自动机进行交互，
这意味着你可以实现自己的自动机并在我们的 PBFT 协议中使用它，甚至可以将事务转发到另一个系统，
即使是用另一种语言编写的系统也可以。

同时，我们提供了一个简单的键值存储自动机实现作为示例。

### Automata 接口

Automata 接口定义了自动机实现应具有的方法和属性。它包括以下内容：

- `transfer(tx: ByteLike): void`：使用给定的输入传输状态机。
- `query(command: ByteLike): ByteLike | undefined`：使用给定的命令查询状态机。
- `status(): TStatus`：返回自动机的当前状态概述。
- `digest(): string`：返回自动机的摘要。可以使用一些自定义策略计算摘要，如增量哈希或链接哈希。

`ByteLike` 类型是一个联合类型，表示类似字节的值，可以是字符串、Buffer 或 Uint8Array。

### KVAutomata 类

KVAutomata 类是 Automata 接口的一个示例实现。它表示一个简单的键值存储自动机。它具有以下属性和方法：

#### 属性

- `state: Map<string, string>`：表示键值存储自动机的当前状态。
- `history: string[]`：存储传输事务的历史记录。
- `height: number`：表示自动机的高度。
- `logger: Logger`：用于记录日志的 Logger 类的实例。
- `lastDigest: string`：存储自动机的最后计算摘要。

#### 构造函数

- `constructor(logger: Logger)`：使用提供的 logger 初始化 KVAutomata 类的新实例。

#### 方法

- `transfer(tx: string): void`：使用给定的事务传输状态机。它根据事务更新状态，计算新的摘要，并记录传输。
- `parse(tx: string): [string, Optional<string>]`：将事务字符串解析为键值对。如果事务不包含值（没有 ':' 分隔符），则将值设置为 `undefined`。
- `query(command: string): Optional<string>`：使用给定的命令（键）查询状态机，并返回状态中对应的值。
- `status(): KVAutomataState`：返回键值存储自动机的当前状态，包括状态、摘要和历史记录。
- `digest(): string`：返回自动机的最后计算摘要。

## 许可证

本项目基于 MIT 许可证进行许可 - 有关详细信息，请参阅 [LICENSE](../LICENSE) 文件。

## 参考资料

- <https://pmg.csail.mit.edu/papers/OSDI99.pdf>
- <https://pmg.csail.mit.edu/papers/bft-tocs.pdf>
- <https://www.cnblogs.com/xiaohuiduan/p/12210891.html>
- <https://yangzhe.me/2019/11/25/pbft>
- <https://fisco-bcos-documentation.readthedocs.io/zh-cn/stable/docs/design/consensus/pbft.html>
- <https://blog.csdn.net/t46414704152abc/article/details/103413324>
- <https://zhuanlan.zhihu.com/p/79729221>
- <https://sawtooth.hyperledger.org/docs/1.2/pbft/architecture.html>
- <http://qyuan.top/2019/09/03/pbft-3/>
- <https://chenquan.me/posts/pbft-key-points/>
