import { genKeyPair } from '../sign'

export function main() {
    const N = Number(process.argv[2])

    if (isNaN(N)) {
        console.error('Usage: pnpm run keygen <number of key pairs>')
        process.exit(1)
    }

    console.log('index,prikey,pubkey')
    for (let i = 0; i < N; i++) {
        const { prikey, pubkey } = genKeyPair()
        console.log(`${i},${prikey},${pubkey}`)
    }

}

main()
