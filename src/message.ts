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

export type MasterInfoMsg = {
    type: 'master-info'
    master_addr: string
};

export type RequestMsg = {
    type: 'request'
    timestamp: number
    payload: string
};

export type PrePrepareMsg = {
    type: 'pre-prepare'
    timestamp: number
    view: number
    digest: string
    request: RequestMsg
};

export type ClientMessage = RequestMsg;
export type PeerMessage = ErrorMsg | FindMasterMsg | MasterInfoMsg | PrePrepareMsg;
export type Message = ClientMessage | PeerMessage;

