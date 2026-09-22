import { AxiosError } from 'axios';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { afterEach, expect, it, vi } from 'vitest';
import api from './client';
import { commitOrderImport } from './orderImport';

vi.mock('./client', async () => {
  const { default: axios } = await import('axios');
  return { default: axios.create({ timeout: 120000 }) };
});

afterEach(() => vi.useRealTimers());

it('keeps a confirmed batch pending beyond two minutes and receives its result once', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const adapter = vi.fn((config: InternalAxiosRequestConfig) => new Promise<AxiosResponse>((resolve, reject) => {
    const timeout = config.timeout ? setTimeout(() => reject(new AxiosError('timeout', 'ECONNABORTED')), config.timeout) : undefined;
    finish = () => {
      clearTimeout(timeout);
      resolve({ data: { created: 129, retained_sources: 2 }, status: 200, statusText: 'OK', headers: {}, config });
    };
  }));
  api.defaults.adapter = adapter;
  const succeeded = vi.fn();
  const failed = vi.fn();
  const request = commitOrderImport('synthetic-session', {}, {}, [], { 'synthetic#0': 2700 }, 3).then(succeeded, failed);
  await vi.advanceTimersByTimeAsync(120001);
  expect(failed).not.toHaveBeenCalled();
  expect(succeeded).not.toHaveBeenCalled();
  finish();
  await request;
  expect(succeeded).toHaveBeenCalledWith(expect.objectContaining({ data: { created: 129, retained_sources: 2 } }));
  expect(adapter).toHaveBeenCalledTimes(1);
  expect(JSON.parse(adapter.mock.calls[0][0].data)).toEqual({
    session_id: 'synthetic-session', expected_version: 3, confirmed_issue_numbers: { 'synthetic#0': 2700 },
  });
  expect(api.defaults.timeout).toBe(120000);
});
