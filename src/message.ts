import { ParamConfig } from './config'

export enum ErrorCode {
    NotMaster = 'not-master',
    InvalidType = 'invalid-type',
    InvalidView = 'invalid-view',
    InvalidSequence = 'invalid-sequence',
    InvalidDigest = 'invalid-digest',
    InvalidRequest = 'invalid-request',
    InvalidStatus = 'invalid-status',
    InternalError = 'internal-error',
    DuplicatedMsg = 'duplicated-msg',
    ViewChanging = 'view-changing',
    Unknown = 'unknown',
}

export type ErrorMsg = {
    type: 'error'
    code: ErrorCode
    message?: string
};

export function createErrorMsg(code: ErrorCode, message?: string): Message {
    return {
        type: 'error',
        code,
        message,
    }
}

export class RemoteError extends Error {
    code: ErrorCode
    constructor(code: ErrorCode, message?: string) {
        super(message)
        this.code = code
    }
}

export function requires(condition: boolean, code: ErrorCode, message?: string) {
    if (!condition) {
        throw new RemoteError(code, message)
    }
}

export type OkMsg = {
    type: 'ok'
    message?: string
};

export function ok(message?: string): OkMsg {
    return {
        type: 'ok',
        message,
    }
}

export type FindMasterMsg = {
    type: 'find-master'
};

export type QueryStatusMsg = {
    type: 'query-status'
};

export type MasterInfoMsg = {
    type: 'master-info'
    name: string
};

export type NodeStatusMsg<TAutomataStatus> = {
    type: 'node-status'
    view: number
    master: string
    automata: TAutomataStatus
    params: ParamConfig
    height: number
    lowWaterMark: number
    highWaterMark: number
}

export type RequestMsg = {
    type: 'request'
    timestamp: number
    payload: string
};

// <REPLY, v, t, c, i, r>
export type ReplyMsg = {
    type: 'reply'
    view: number
    timestamp: number
    node: string
    result: string
}

export type QueryAutomataMsg = {
    type: 'query-automata'
    command: string
};

export type CommitMsg = {
    type: 'commit'
    view: number
    sequence: number
    digest: string
    node: string
}

export type CommittedLogMsg = {
    type: 'committed'
    view: number
    sequence: number
    digest: string
    node: string
}

export type PrePrepareMsg = {
    type: 'pre-prepare'
    view: number
    sequence: number
    digest: string
    request: RequestMsg
};

export type PrepareMsg = {
    type: 'prepare'
    view: number
    sequence: number
    digest: string
    node: string
};

export type PreparedLogMsg = {
    type: 'prepared'
    view: number
    sequence: number
    digest: string
    node: string
};

// view change

export type CheckpointMsg = {
    type: 'checkpoint'
    sequence: number
    digest: string // digest of the state machine
    node: string
}

export type ViewChangeMsg = {
    type: 'view-change'
    view: number // the view to change to
    node: string // the node who initiates the view change
    sequence: number // the sequence of the last stable checkpoint, i.e., n in the paper
    proof: CheckpointMsg[] // 2f+1 stable logs, i.e., C in the paper
    pendings: PendingPrepare[] // pending pre-prepare msgs and related prepare msgs, i.e., P in the paper
}

export type PendingPrepare = {
    prePrepareMsg: PrePrepareMsg
    prepareMsgs: PrepareMsg[]
}

export type NewViewMsg = {
    type: 'new-view'
    view: number // the view to change to
    sequence: number // the sequence of the last stable checkpoint, i.e., n in the paper
    proof: ViewChangeMsg[] // 2f+1 view change msgs, i.e., V in the paper
    pendings: PrePrepareMsg[] // 2f+1 pre-prepare msgs, i.e., O in the paper
}

export type LogMessage =
    // for PBFT
    | PrePrepareMsg
    | PrepareMsg
    | CommitMsg
    // local log
    | CommittedLogMsg
    | PreparedLogMsg
    // for view change
    | CheckpointMsg
    | ViewChangeMsg
    | NewViewMsg

export type Message =
    | RequestMsg
    | ReplyMsg
    | LogMessage
    // General
    | ErrorMsg
    | OkMsg
    // Domain specific
    | FindMasterMsg
    | MasterInfoMsg
    | QueryStatusMsg
    | QueryAutomataMsg
    | NodeStatusMsg<unknown>


export type MessageType = Message['type'];

