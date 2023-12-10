
import { ByteLike } from './automata'
import elliptic from 'elliptic'
const ec = new elliptic.ec('secp256k1')

export function genKeyPair() {
    const keyPair = ec.genKeyPair()
    return {
        prikey: keyPair.getPrivate('hex'),
        pubkey: keyPair.getPublic('hex')
    }
}

export function sign(prikey: string, msg: ByteLike) {
    const key = ec.keyFromPrivate(prikey)
    const signature = key.sign(msg)
    return signature.toDER('hex')
}

export function verify(pubkey: string, msg: ByteLike, signature: string) {
    const key = ec.keyFromPublic(pubkey, 'hex')
    try {
        return key.verify(msg, signature)
    } catch (error) {
        return false
    }
}
