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

export class ErrorWithCode extends Error {
    code: ErrorCode
    constructor(code: ErrorCode, message?: string) {
        super(message)
        this.code = code
    }
}

export function requires(condition: boolean, code: ErrorCode, message?: string) {
    if (!condition) {
        throw new ErrorWithCode(code, message)
    }
}

export type OkMsg = {
    type: 'ok'
    message?: string
};

export function createOkMsg(message?: string): OkMsg {
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

export type RequestMsg = {
    type: 'request'
    timestamp: number
    payload: string
};

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
    node: string
    sequence: number
    stableProof: CommittedLogMsg[] // 2f+1 stable logs
    P: Pm[]
}

export type Pm = {
    prePrepareMsgs: PrePrepareMsg[]
    prepareMsgs: PrepareMsg[]
}

export type NewViewMsg = {
    type: 'new-view'
    view: number
    sequence: number
    V: ViewChangeMsg[] // 2f+1 view change msgs
    O: PrePrepareMsg[] // 2f+1 pre-prepare msgs
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
    | LogMessage
    // General
    | ErrorMsg
    | OkMsg
    // Domain specific
    | FindMasterMsg
    | MasterInfoMsg
    | QueryStatusMsg
    | QueryAutomataMsg


export type MessageType = Message['type'];

