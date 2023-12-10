# Light PBFT

![License](https://img.shields.io/github/license/pluveto/light-pbft?style=flat-square)

[中文文档](docs/README.zh-CN.md)

A simple implementation of OSDI PBFT (Practical Byzantine Fault Tolerance) protocol in TypeScript.

## Feature

- [x] Full PBFT protocol
  - [x] 3 Phase BFT consensus (pre-prepare, prepare, commit)
  - [x] Checkpoint mechanism
  - [x] Dynamic view change
  - [x] Log buffering
  - [x] Garbage collection
  - [x] Validation, including digest, sequence number, view number (between watermark), etc.
  - [x] SECP256K1 signature, SHA256 message digest
- [x] Very detailed logging, make it easy to debug and learn
- [x] With unit tests and integration tests
- [x] Simple command-line server/client
  - [x] REPL interactive client
- [x] Support custom network layer
  - default: jsonrpc over http
- [x] Support custom state machine and storage layer
  - default: a simple in-memory storage state machine

**WARNING**:

- This is not for production use, because the OSDI99 PBFT protocol doesn't support lagged node recovery.
- Signature verification is implemented and it works, but it's expensive and not optimized, so it's disabled during tests.

## Usage

### Commands

- `pnpm run test`: Run unit tests and integration tests.
- `pnpm run servers`: Simultaneously start all defined nodes within a terminal.
- `pnpm run server <node-name>`: Start a server node.
  - `node-name`: Name of the node. It should be defined in the configuration file. Same below.
- `pnpm run client <client-name>`: Start a client node.
  - `client-name`: Name of the client.
- `pnpm run keygen <num>`: Generate key pairs for nodes or clients.
  - `num`: Number of key pairs to generate.

**NOTE**: `LIGHT_PBFT_CLUSTER_CONFIG` environment can be used to specify the path of the configuration file. If not specified, the default value is `configs/cluster.json`.
For example, you can run `LIGHT_PBFT_CLUSTER_CONFIG=configs/cluster.json pnpm run server node1` to start a server node called node1 defined in the given configuration file.

Servers:

![servers.png](https://raw.githubusercontent.com/pluveto/0images/master/2023/12/upgit_20231211_1702224876.png)

CLI Client:

![client.png](https://raw.githubusercontent.com/pluveto/0images/master/2023/12/upgit_20231211_1702224932.png)

Client CLI Commands:

- `help`: print this message
- `exit`: exit client
- `request <payload>`: send request to BFT cluster
  - `payload`: a command string. Examples: `key1:value1` will set key1 to value1, `key1:` set key1 to empty string, `key1` will query key1
- `find-master`: find master node
- `status`: query status of all nodes
- `corrupt <node-name>`: corrupt a node
  - `node-name`: name of the node to corrupt

When a `request` command is executed, the client will send it to all nodes in the cluster, and wait for f+1 replies. (This is a slight improvement over the original PBFT protocol, which only send the request to the master node.)

You can invoke `corrupt <master-name>` to corrupt a master node, and observe the view change process.

**NOTE**: At least one checkpoint is required before the view change process can be started. So make sure you have executed some `request` commands and a checkpoint has been generated before invoking `corrupt <master-name>`.

### Setup Commands

- when you execute `pnpm run client <client-name>`, some commands can be executed automatically. They are defined in `src/cmd/client.ts`, like:

```js
[
    ['status'],
    ['find-master'],
    ['request', 'key1:value1'],
    ['status']
]
```

You can change them to whatever you want.

## Configuration File Structure

To easily configure the system, we use a JSON file to specify the system configuration. Here is the structure of the configuration file.

### SystemConfig

The top-level configuration object representing the system configuration. It has the following properties:

- `signature`: SignatureConfig object specifying the signature configuration.
- `clients`: An array of SenderConfig objects representing client configurations.
- `nodes`: An array of NodeConfig objects representing node configurations.
- `params`: ParamConfig object specifying various system parameters.

### SignatureConfig

Represents the signature configuration with the following properties:

- `enabled`: A boolean value indicating whether signature verification is enabled.

### ParamConfig

Represents the system parameter configuration with the following properties:

- `f`: An integer representing the maximum number of faulty nodes tolerated.
- `k`: A large number used to calculate the high-water mark. It is slightly different from the `k` mentioned in the OSDI99 paper.
    Actually here k means the checkpoint generation interval, and it's half of the `k` in the paper.
    The highWaterMark is calculated as `2 * k + lowWaterMark`.

### SenderConfig

Represents the configuration for a sender (client or node) with the following properties:

- `name`: Name of the sender.
- `pubkey`: Public key of the sender.
- `prikey`: Private key of the sender.

### NodeConfig

Represents the configuration for a node with the following properties:

- `host`: Host address of the node.
- `port`: Port number of the node.
- `name`: Name of the node.
- `pubkey`: Public key of the node.
- `prikey`: Private key of the node.

### Configuration Schema

See [src/config.ts](src/config.ts) for the configuration schema.

### Example Configuration File

An example configuration file (`cluster.json`) would have the following structure:

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

This configuration file specifies a system with one client (`client1`) and two nodes (`node1` and `node2`). The signature verification is enabled, and the system parameters are set with `f` equal to 0 and `k` equal to 100.

**NOTE**:

1. `f` should be calculated as `floor((n - 1) / 3)` where `n` is the number of nodes in the system.
2. `k` should be set to a large number (e.g., 100) to avoid checkpointing too frequently.
3. The `prikey` field is only used for testing. In a real system, the private key should be kept secret. In fact we have applied a `maskPriKeys` function to the configuration file to mask the private keys of other nodes before the configuration file is loaded to a node, which follows the principle of least privilege and knowledge.

## Messages

Here we defined the messages used in the protocol.

### Error Handling

#### ErrorCode

Error codes are used to indicate the specific error type. It has the following values:

- `DuplicatedMsg`: Indicates a duplicated message.
- `InternalError`: Indicates an internal error.
- `InvalidDigest`: Indicates an invalid digest.
- `InvalidRequest`: Indicates an invalid request.
- `InvalidSequence`: Indicates an invalid sequence number.
- `InvalidSignature`: Indicates an invalid message signature.
- `InvalidStatus`: Indicates an invalid status.
- `InvalidType`: Indicates an invalid message type.
- `InvalidView`: Indicates an invalid view.
- `NotMaster`: Indicates that the node is not the master.
- `Unknown`: Indicates an unknown error.
- `UnknownSender`: Indicates an unknown sender.
- `ViewChanging`: Indicates a view change is in progress.

#### ErrorMsg

Represents an error message with the following properties:

- `type`: Type of the message, set to `'error'`.
- `code`: ErrorCode indicating the specific error.
- `message`: Optional error message.

#### OkMsg

Represents a successful message with the following properties:

- `type`: Type of the message, set to `'ok'`.
- `message`: Optional piggyback message.

### Custom Messages

These messages are not part of the standard PBFT protocol, but are used to improve our implementation's usability.

They can be removed without affecting the correctness of the protocol.

#### FindMasterMsg

Represents a message to find the master node. It has the following property:

- `type`: Type of the message, set to `'find-master'`.

#### QueryStatusMsg

Represents a message to query the status of a node. It has the following property:

- `type`: Type of the message, set to `'query-status'`.

#### MasterInfoMsg

Represents a message containing master node information with the following properties:

- `type`: Type of the message, set to `'master-info'`.
- `name`: Name of the master node.

#### CorruptMsg

Represents a message to corrupt a node (make it faulty) with the following properties:

- `type`: Type of the message, set to `'corrupt'`.
- `name`: Name of the node to corrupt.

#### NodeStatusMsg<TAutomataStatus>

Represents a message containing the status of a node with the following properties:

- `type`: Type of the message, set to `'node-status'`.
- `view`: Current view number.
- `master`: Name of the master node.
- `automata`: Status of the automata.
- `params`: Configuration parameters.
- `height`: Height of the node.
- `lowWaterMark`: Low watermark value.
- `highWaterMark`: High watermark value.

#### QueryAutomataMsg

Represents a message to query the automata with the following properties:

- `type`: Type of the message, set to `'query-automata'`.
- `command`: Command to query the automata.

### Consensus Protocol Messages

#### RequestMsg

Represents a request message with the following properties:

- `type`: Type of the message, set to `'request'`.
- `timestamp`: Timestamp of the request.
- `payload`: Payload of the request.

#### ReplyMsg

Represents a reply message with the following properties:

- `type`: Type of the message, set to `'reply'`.
- `view`: View number.
- `timestamp`: Timestamp of the reply.
- `node`: Node identifier.
- `result`: Result of the reply.

#### CommitMsg

Represents a commit message with the following properties:

- `type`: Type of the message, set to `'commit'`.
- `view`: View number.
- `sequence`: Sequence number.
- `digest`: Digest value.
- `node`: Node identifier.

#### PrePrepareMsg

Represents a pre-prepare message with the following properties:

- `type`: Type of the message, set to `'pre-prepare'`.
- `view`: View number.
- `sequence`: Sequence number.
- `digest`: Digest value.
- `request`: RequestMsg associated with the pre-prepare message.

#### PrepareMsg

Represents a prepare message with the following properties:

- `type`: Type of the message, set to `'prepare'`.
- `view`: View number.
- `sequence`: Sequence number.
- `digest`: Digest value.
- `node`: Node identifier.

### Local Event Messages

#### CommittedLogMsg

Represents a committed log message with the following properties:

- `type`: Type of the message, set to `'committed'`.
- `view`: View number.
- `sequence`: Sequence number.
- `digest`: Digest value.
- `node`: Node identifier.

#### PreparedLogMsg

Represents a prepared log message with the following properties:

- `type`: Type of the message, set to `'prepared'`.
- `view`: View number.
- `sequence`: Sequence number.
- `digest`: Digest value.
- `node`: Node identifier.

### Checkpoint && View Change Messages

#### CheckpointMsg

Represents a checkpoint message with the following properties:

- `type`: Type of the message, set to `'checkpoint'`.
- `sequence`: Sequence number.
- `digest`: Digest value of the state machine.
- `node`: Node identifier.

#### ViewChangeMsg

Represents a view change message with the following properties:

- `type`: Type of the message, set to `'view-change'`.
- `view`: View number to change to.
- `node`: Node identifier initiating the view change.
- `sequence`: Sequence number of the last stable checkpoint.
- `proof`: Array of CheckpointMsg representing 2f+1 stable logs.
- `pendings`: Array of PendingPrepare representing pending pre-prepare and prepare messages.

#### PendingPrepare

Represents pending pre-prepare and prepare messages with the following properties:

- `prePrepareMsg`: PrePrepareMsg associated with the pending prepare.
- `prepareMsgs`: Array of PrepareMsg associated with the pending prepare.

#### NewViewMsg

Represents a new view message with the following properties:

- `type`: Type of the message, set to `'new-view'`.
- `view`: View number to change to.
- `sequence`: Sequence number of the last stable checkpoint.
- `proof`: Array of ViewChangeMsg representing 2f+1 view change messages.
- `pendings`: Array of PrePrepareMsg representing 2f+1 pre-prepare messages.

### LogMessage

Represents various messages that can be logged, including:

- PrePrepareMsg
- PrepareMsg
- CommitMsg
- CommittedLogMsg
- PreparedLogMsg
- CheckpointMsg
- ViewChangeMsg
- NewViewMsg

### ClientMessage

Represents messages sent by clients, including:

- RequestMsg
- FindMasterMsg
- CorruptMsg
- QueryStatusMsg
- QueryAutomataMsg

### SourcedMessage

Represents messages with a 'node' field.

When signature is enabled, the protocol will verify the signer of the message is the same as the node field.

## Automata

The automata is the state machine that the PBFT protocol is built on, and can be transferred with a transaction.

Our nodes doesn't depend on a specific automata implementation, but instead use an interface to interact with the automata,
which means that you can implement your own automata and use it in our PBFT protocol, you can even forward the transaction to another system,
even written in another language.

In the meantime, we provide a simple key-value storage automata implementation as an example.

### Automata Interface

The Automata interface defines the methods and properties that an automata implementation should have. It includes the following:

- `transfer(tx: ByteLike): void`: Transfers the state machine with the given input.
- `query(command: ByteLike): ByteLike | undefined`: Queries the state machine with the given command.
- `status(): TStatus`: Returns the current status overview of the automata.
- `digest(): string`: Returns the digest of the automata. You can use some custom strategy to compute the digest, like incremental hash or linked hash.

The `ByteLike` type is a union type that represents a byte-like value, which can be a string, Buffer, or Uint8Array.

### KVAutomata Class

The KVAutomata class is an example implementation of the Automata interface. It represents a simple key-value storage automata. It has the following properties and methods:

#### Properties

- `state: Map<string, string>`: Represents the current state of the key-value storage automata.
- `history: string[]`: Stores the history of transferred transactions.
- `height: number`: Represents the height of the automata.
- `logger: Logger`: An instance of the Logger class used for logging.
- `lastDigest: string`: Stores the last computed digest of the automata.

#### Constructor

- `constructor(logger: Logger)`: Initializes a new instance of the KVAutomata class with the provided logger.

#### Methods

- `transfer(tx: string): void`: Transfers the state machine with the given transaction. It updates the state based on the transaction, computes the new digest, and logs the transfer.
- `parse(tx: string): [string, Optional<string>]`: Parses the transaction string into a key-value pair. If the transaction does not contain a value (no ':' delimiter), the value is set to `undefined`.
- `query(command: string): Optional<string>`: Queries the state machine with the given command (key) and returns the corresponding value from the state.
- `status(): KVAutomataState`: Returns the current status of the key-value storage automata, including the state, digest, and history.
- `digest(): string`: Returns the last computed digest of the automata.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## References

- <https://pmg.csail.mit.edu/papers/OSDI99.pdf>
- <https://pmg.csail.mit.edu/papers/bft-tocs.pdf>
- <https://www.cnblogs.com/xiaohuiduan/p/12210891.html>
- <https://yangzhe.me/2019/11/25/pbft>
- <https://fisco-bcos-documentation.readthedocs.io/zh-cn/stable/docs/design/consensus/pbft.html>
- <https://blog.csdn.net/t46414704152abc/article/details/103413324>
- <https://zhuanlan.zhihu.com/p/79729221>
- <https://sawtooth.hyperledger.org/docs/1.2/pbft/architecture.html>
- <http://qyuan.top/2019/09/03/pbft-3/>
- <https://pluveto.me/posts/pbft-key-points/>
