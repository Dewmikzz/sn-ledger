import React from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App';

vi.mock('../src/store', async () => {
  const { createDemoData } = await import('../src/domain');
  return {
    useLedger: () => ({
      data: createDemoData(),
      ready: true,
      pendingCount: 0,
      attentionCount: 0,
      syncStatus: 'local',
      entryStatus: () => 'local',
    }),
  };
});

afterEach(() => vi.unstubAllGlobals());

it('renders today’s invoice activity when the ledger already has records', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
  });
  const html = renderToString(<App />);

  expect(html).toContain('Total sales');
  expect(html).toContain('LKM-24186');
});
