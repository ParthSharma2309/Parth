import { describe, it, expect } from 'vitest';
import { classifyError } from '../../server/lib/gemini.ts';

describe('classifyError', () => {
  it('classifies 401 and invalid API key errors as auth', () => {
    expect(classifyError({ status: 401, message: 'Unauthorized' })).toBe('auth');
    expect(classifyError({ message: 'API_KEY_INVALID: key is not valid' })).toBe('auth');
  });

  it('classifies 403 and permission denied as forbidden', () => {
    expect(classifyError({ status: 403, message: 'Forbidden' })).toBe('forbidden');
    expect(classifyError({ message: 'PERMISSION_DENIED on resource' })).toBe('forbidden');
  });

  it('classifies 404 and model not found as not_found', () => {
    expect(classifyError({ status: 404, message: 'Model not found' })).toBe('not_found');
    expect(
      classifyError({ message: 'models/gemini-invalid could not be found or is not available' })
    ).toBe('not_found');
  });

  it('classifies 429 and RESOURCE_EXHAUSTED as quota', () => {
    expect(classifyError({ status: 429, message: 'Rate limit exceeded' })).toBe('quota');
    expect(
      classifyError({ message: 'RESOURCE_EXHAUSTED: Quota exceeded for quota metric' })
    ).toBe('quota');
  });

  it('classifies 503 and high demand as unavailable', () => {
    expect(classifyError({ status: 503, message: 'Service unavailable' })).toBe('unavailable');
    expect(classifyError({ message: 'The model is experiencing spikes in demand' })).toBe(
      'unavailable'
    );
  });

  it('classifies 504, AbortError, and timeouts as timeout', () => {
    expect(classifyError({ status: 504, message: 'Gateway Timeout' })).toBe('timeout');
    expect(classifyError({ name: 'AbortError', message: 'The operation was aborted' })).toBe(
      'timeout'
    );
    expect(classifyError({ message: 'DEADLINE_EXCEEDED' })).toBe('timeout');
  });

  it('classifies 400 as bad_request', () => {
    expect(classifyError({ status: 400, message: 'Invalid argument provided' })).toBe(
      'bad_request'
    );
  });

  it('classifies unrecognized errors as unknown', () => {
    expect(classifyError({ status: 500, message: 'Some internal unexpected condition' })).toBe(
      'unknown'
    );
  });
});
