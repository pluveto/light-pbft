import * as elliptic from 'elliptic'
import * as process from 'process'

const ec = new elliptic.ec('secp256k1')

const N = Number(process.argv[2])

if (isNaN(N)) {
    console.error('Usage: pnpm run keygen <number of key pairs>')
    process.exit(1)
}

for (let i = 0; i < N; i++) {
    const keyPair = ec.genKeyPair()
    console.log(`[${i + 1}]`)
    console.log(`prikey: ${keyPair.getPrivate('hex')}`)
    console.log(`pubkey: ${keyPair.getPublic('hex')}`)
}
