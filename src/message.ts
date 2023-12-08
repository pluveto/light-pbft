export enum ErrorCode {
    NOT_MASTER = 'not-master',
    INVALID_TYPE = 'invalid-type',
    UNKNOWN = 'unknown',
}

export type ErrorMsg = {
    type: 'error'
    code: ErrorCode
    message: string
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

export type ClientMessage = RequestMsg | QueryStatusMsg;
export type PeerMessage = ErrorMsg | FindMasterMsg | MasterInfoMsg | PrePrepareMsg | PrepareMsg | CommitMsg;
export type Message = ClientMessage | PeerMessage;
export type MessageType = Message['type'];

