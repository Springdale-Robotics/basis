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

  // Fix round 2: JSON.stringify(undefined) is the JS value undefined, not the
  // string "undefined" — TypeScript's lib types claim JSON.stringify always
  // returns string, so this violates describeGoogleSyncError's own `: string`
  // signature at runtime without a type error anywhere to catch it.
  it('returns a real string when the thrown value is undefined', () => {
    const message = describeGoogleSyncError(undefined);
    expect(typeof message).toBe('string');
    expect(message.length).toBeGreaterThan(0);
  });

  it('returns a real string for a value JSON.stringify cannot serialise (circular)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => describeGoogleSyncError(circular)).not.toThrow();
    expect(typeof describeGoogleSyncError(circular)).toBe('string');
  });

  // Fix round 2: this string can land verbatim in a text column and a
  // websocket payload, and CalendarSettingsPage renders it untruncated, so an
  // unrecognised non-Error, non-string throw must not produce an unbounded blob.
  it('caps an oversized, unrecognised error instead of dumping it whole', () => {
    const huge = { detail: 'x'.repeat(5000) };
    const message = describeGoogleSyncError(huge);
    expect(typeof message).toBe('string');
    expect(message.length).toBeLessThan(600);
  });
});

describe('describeGoogleSyncError — Calendar API not enabled', () => {
  // The exact shape google-auth-library throws when the project has not
  // enabled the Calendar API. Taken from a real 403 observed on a live box.
  const serviceDisabled = Object.assign(
    new Error(
      'Google Calendar API has not been used in project 461160055088 before ' +
        'or it is disabled. Enable it by visiting ' +
        'https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=461160055088 ' +
        'then retry.'
    ),
    {
      code: 403,
      response: {
        data: {
          error: {
            code: 403,
            status: 'PERMISSION_DENIED',
            errors: [{ reason: 'accessNotConfigured' }],
          },
        },
      },
    }
  );

  it('explains that the Calendar API must be enabled', () => {
    const message = describeGoogleSyncError(serviceDisabled);
    expect(message).toMatch(/Calendar API/i);
    expect(message).toMatch(/enable/i);
  });

  it('keeps the activation link Google supplied, so the fix is one click', () => {
    expect(describeGoogleSyncError(serviceDisabled)).toContain(
      'https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=461160055088'
    );
  });

  it('does not mistake it for the Testing-consent-screen case', () => {
    expect(describeGoogleSyncError(serviceDisabled)).not.toMatch(/Testing/);
  });

  it('still returns a plain object-shaped provider error unchanged', () => {
    // A 403 that is NOT accessNotConfigured must not get the enable-API advice.
    const forbidden = Object.assign(new Error('Insufficient Permission'), {
      code: 403,
      response: { data: { error: { code: 403, errors: [{ reason: 'forbidden' }] } } },
    });
    expect(describeGoogleSyncError(forbidden)).toBe('Insufficient Permission');
  });
});
