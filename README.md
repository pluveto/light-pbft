# light pbft

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
- [x] Full logging, make it easy to debug and learn
- [x] With unit tests and integration tests
- [x] Simple command-line server/client
- [x] Support custom network layer
  - default: jsonrpc over http
- [x] Support custom state machine and storage layer
  - default: a simple in-memory storage state machine

**WARNING**: This is not for production use, because the osdi99 PBFT protocol doesn't support lagged node recovery.

## References

- <https://pmg.csail.mit.edu/papers/osdi99.pdf>
- <https://pmg.csail.mit.edu/papers/bft-tocs.pdf>
- <https://www.cnblogs.com/xiaohuiduan/p/12210891.html>
- <https://yangzhe.me/2019/11/25/pbft>
- <https://fisco-bcos-documentation.readthedocs.io/zh-cn/stable/docs/design/consensus/pbft.html>
- <https://blog.csdn.net/t46414704152abc/article/details/103413324>
- <https://zhuanlan.zhihu.com/p/79729221>
- <https://sawtooth.hyperledger.org/docs/1.2/pbft/architecture.html>
- <http://qyuan.top/2019/09/03/pbft-3/>
- <https://chenquan.me/posts/pbft-key-points/>
