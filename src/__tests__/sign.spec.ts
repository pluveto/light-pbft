import { genKeyPair, sign, verify } from '../sign'

describe('genKeyPair', () => {
    it('should generate a valid key pair', () => {
        const keyPair = genKeyPair()
        expect(keyPair).toHaveProperty('prikey')
        expect(keyPair).toHaveProperty('pubkey')
        expect(keyPair.prikey).toBeTruthy()
        expect(keyPair.pubkey).toBeTruthy()
    })
})

// Define a mock message for signing and verifying
const message = 'This is a message to be signed'

describe('sign', () => {
    it('should sign a message with a private key', () => {
        const { prikey } = genKeyPair()
        const signature = sign(prikey, message)
        expect(signature).toBeTruthy()
    })
})

describe('verify', () => {
    it('should verify a signature with a public key', () => {
        const { prikey, pubkey } = genKeyPair()
        const signature = sign(prikey, message)
        const verified = verify(pubkey, message, signature)
        expect(verified).toBeTruthy()
    })

    it('should return false for an invalid signature', () => {
        const { pubkey } = genKeyPair()
        const invalidSignature = '0'
        const verified = verify(pubkey, message, invalidSignature)
        expect(verified).toBeFalsy()
    })
})
