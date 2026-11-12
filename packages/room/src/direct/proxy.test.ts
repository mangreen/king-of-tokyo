import { describe, expect, it } from 'vitest';
import { createFakeDirectNetwork } from './fake.js';
import { createProxyConnector, isProxyEvent, isProxyRequest, serveProxy } from './proxy.js';
import type { RtcSignal } from '../local/protocol.js';

describe('跨執行緒直連代理（Worker ⇄ 主執行緒）', () => {
  it('Worker 端的對等端透過代理驅動主執行緒的真實連線，訊框雙向往返', () => {
    const net = createFakeDirectNetwork();
    // postMessage 以記憶體內函式模擬；故意經過 structuredClone 確認訊息可被複製
    const ref: { worker?: ReturnType<typeof createProxyConnector> } = {};
    const main = serveProxy(net.connector, (m) => {
      ref.worker?.handle(structuredClone(m));
    });
    const worker = createProxyConnector((m) => {
      expect(main.handle(structuredClone(m))).toBe(true);
    });
    ref.worker = worker;

    const hostLog: string[] = [];
    const guestLog: string[] = [];
    const offers: RtcSignal[] = [];
    const hostPeer = worker.connector('host', {
      signal: (d) => offers.push(d),
      open: () => hostLog.push('open'),
      message: (f) => hostLog.push(f),
      close: () => hostLog.push('close'),
    });
    expect(offers).toHaveLength(1);

    // 客人端在「主執行緒」直接用真實 connector（不經代理）
    const guestPeer = net.connector('guest', {
      signal: (d) => {
        hostPeer.signal(d);
      },
      open: () => guestLog.push('open'),
      message: (f) => guestLog.push(f),
      close: () => guestLog.push('close'),
    });
    guestPeer.signal(offers[0] as RtcSignal);
    net.openAll();
    expect(hostLog).toEqual(['open']);
    hostPeer.send('Mhello');
    guestPeer.send('Mworld');
    expect(guestLog).toEqual(['open', 'Mhello']);
    expect(hostLog).toEqual(['open', 'Mworld']);

    hostPeer.close();
    expect(guestLog.at(-1)).toBe('close');
  });

  it('辨識與忽略不相干的訊息', () => {
    const worker = createProxyConnector(() => undefined);
    expect(worker.handle({ t: 'open' })).toBe(false);
    expect(worker.handle(null)).toBe(false);
    expect(isProxyRequest({ k: 'rtc-new', id: 1, role: 'host' })).toBe(true);
    expect(isProxyRequest({ k: 'rtc-open', id: 1 })).toBe(false);
    expect(isProxyEvent({ k: 'rtc-open', id: 1 })).toBe(true);
    // 對未知 id 的事件靜默忽略
    expect(worker.handle({ k: 'rtc-frame', id: 99, frame: 'M' })).toBe(true);
  });

  it('closeAll 收掉所有連線', () => {
    const net = createFakeDirectNetwork();
    const main = serveProxy(net.connector, () => undefined);
    main.handle({ k: 'rtc-new', id: 1, role: 'host' });
    main.closeAll();
    expect(net.created).toEqual(['host']);
  });
});
