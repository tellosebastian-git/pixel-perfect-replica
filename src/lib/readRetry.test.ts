import { describe, expect, it, vi } from 'vitest';
import { ReadFailure, runReadWithRetry } from './readRetry';

describe('runReadWithRetry', () => {
  it('reintenta hasta dos veces solo ante fallo transitorio', async () => {
    const transient = vi.fn().mockResolvedValueOnce({ data: null, error: { message: 'fetch' }, status: 0 })
      .mockResolvedValueOnce({ data: null, error: { message: 'fetch' }, status: 0 })
      .mockResolvedValueOnce({ data: 'ok', error: null, status: 200 });
    await expect(runReadWithRetry(transient, { signal: new AbortController().signal, delaysMs: [0, 0] })).resolves.toBe('ok');
    expect(transient).toHaveBeenCalledTimes(3);

    const permanent = vi.fn().mockResolvedValue({ data: null, error: { message: 'Unauthorized' }, status: 401 });
    await expect(runReadWithRetry(permanent, { signal: new AbortController().signal, delaysMs: [0, 0] })).rejects.toBeInstanceOf(ReadFailure);
    expect(permanent).toHaveBeenCalledTimes(1);
  });

  it('no acepta como éxito una respuesta que llega después del timeout y aborto', async () => {
    const slowSuccess = vi.fn((signal: AbortSignal) => new Promise(resolve => {
      signal.addEventListener('abort', () => resolve({ data: 'tardío', error: null, status: 200 }));
    }));
    await expect(runReadWithRetry(slowSuccess, {
      signal: new AbortController().signal,
      delaysMs: [],
      timeoutMs: 5,
    })).rejects.toMatchObject({ message: 'read_timeout' });
    expect(slowSuccess).toHaveBeenCalledTimes(1);
  });
});
