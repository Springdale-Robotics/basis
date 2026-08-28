import { describe, expect, it } from 'vitest';
import { describeGoogleSyncError } from '../../src/modules/calendars/google-sync.service.js';

describe('describeGoogleSyncError', () => {
  it('explains invalid_grant as the seven-day Testing expiry', () => {
    const message = describeGoogleSyncError(
      Object.assign(new Error('invalid_grant'), { response: { data: { error: 'invalid_grant' } } })
    );
    expect(message).toContain('Testing');
    expect(message).toContain('reconnect');
  });

  it('recognises invalid_grant from a bare message too', () => {
    expect(describeGoogleSyncError(new Error('invalid_grant: Token has been expired or revoked.')))
      .toContain('Testing');
  });

  it('passes other errors through readably', () => {
    expect(describeGoogleSyncError(new Error('Quota exceeded'))).toContain('Quota exceeded');
  });

  it('survives a non-Error being thrown', () => {
    expect(typeof describeGoogleSyncError('something odd')).toBe('string');
  });
});
