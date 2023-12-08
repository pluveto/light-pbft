export enum ErrorCode {
    NotMaster = 'not-master',
    InvalidType = 'invalid-type',
    InvalidView = 'invalid-view',
    InvalidSequence = 'invalid-sequence',
    InvalidDigest = 'invalid-digest',
    InvalidRequest = 'invalid-request',
    InvalidStatus = 'invalid-status',
    Unknown = 'unknown',
}

export type ErrorMsg = {
    type: 'error'
    code: ErrorCode
    message?: string
};

export function createErrorMsg(code: ErrorCode, message?: string): ErrorMsg {
    return {
        type: 'error',
        code,
        message,
    }
}

export type OkMsg = {
    type: 'ok'
    message?: string
};

export type FindMasterMsg = {
    type: 'find-master'
};

export type QueryStatusMsg = {
    type: 'query-status'
};

export type MasterInfoMsg = {
    type: 'master-info'
    master_name: string
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
};

export type Message =
    // General
    | ErrorMsg
    | OkMsg
    // Domain specific
    | FindMasterMsg
    | MasterInfoMsg
    | QueryStatusMsg
    | QueryAutomataMsg
    // for PBFT
    | RequestMsg
    | PrePrepareMsg
    | PrepareMsg
    | CommitMsg


export type MessageType = Message['type'];

