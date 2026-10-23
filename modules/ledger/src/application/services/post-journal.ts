import { validate as isUuid } from 'uuid';
import { prepareBalancedJournal } from '../../domain/services/prepare-balanced-journal.js';
import { InvalidPostJournalCommandError } from '../errors/invalid-post-journal-command.error.js';
import type { PrepareJournalInput } from '../../domain/value-objects/journal-draft.js';
import type {
  LedgerPostingRepository,
  PostedJournalResult,
} from '../ports/ledger-posting-repository.js';

export interface PostJournalCommand extends PrepareJournalInput {
  readonly transactionType: string;
  readonly correlationId: string;
}

/** Pure orchestration: domain checks first; SQL stays behind the port. */
export function createPostJournalService(repository: LedgerPostingRepository) {
  return async function postJournal(command: PostJournalCommand): Promise<PostedJournalResult> {
    const draft = prepareBalancedJournal(command);

    // UUID syntax only. Tenant authorization must happen
    // in a trusted caller.
    if (!isUuid(draft.tenantId)) {
      throw new InvalidPostJournalCommandError(
        'INVALID_TENANT_UUID',
        'Tenant ID must be a valid UUID',
      );
    }

    for (const posting of draft.postings) {
      if (!isUuid(posting.accountId)) {
        throw new InvalidPostJournalCommandError(
          'INVALID_ACCOUNT_UUID',
          'Every posting account ID must be a valid UUID',
        );
      }
    }

    if (!isUuid(command.correlationId)) {
      throw new InvalidPostJournalCommandError(
        'INVALID_CORRELATION_UUID',
        'Correlation ID must be a valid UUID',
      );
    }

    if (
      typeof command.transactionType !== 'string' ||
      command.transactionType.trim().length === 0 ||
      command.transactionType.length > 80
    ) {
      throw new InvalidPostJournalCommandError(
        'INVALID_TRANSACTION_TYPE',
        'Transaction type must be non-empty and at most 80 characters',
      );
    }

    return repository.postPreparedJournal({
      draft,
      transactionType: command.transactionType,
      correlationId: command.correlationId,
    });
  };
}
