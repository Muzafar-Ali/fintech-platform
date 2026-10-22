export type PostingSide = 'DEBIT' | 'CREDIT';

export interface JournalPostingInput {
  readonly accountId: string;
  readonly side: PostingSide;
  readonly amountMinor: bigint;
}

export interface PreparedJournalPosting {
  readonly accountId: string;
  readonly side: PostingSide;
  readonly amountMinor: bigint;
  readonly lineNo: number;
}
