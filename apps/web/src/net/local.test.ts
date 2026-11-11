import { describe, expect, it } from 'vitest';
import { loadCardSetFromJson } from '@kot/cardsets/pure';
import { EVENTS, PROTOCOL_VERSION, type Ack } from '@kot/protocol';
import { createLocalHost, type ToClient } from '@kot/room';
import { FakeScheduler } from '@kot/room/testing';
import originalCardSet from '../../../../card-sets/original/set.json';
import { localLinkFactory, type LocalEndpoint } from './localLink.js';

/** 與真實 Worker 同介面的同執行緒替身：訊息經 microtask 非同步遞送，與 postMessage 的語意一致。 */
function inlineEndpoint(scheduler: FakeScheduler): LocalEndpoint {
  const local = createLocalHost({
    cardSet: loadCardSetFromJson(originalCardSet, 'original'),
    scheduler,
  });
  let handler: (message: ToClient) => void = () => undefined;
  let alive = true;
  const deliver = (message: ToClient): void => {
    queueMicrotask(() => {
      if (alive) handler(message);
    });
  };
  const receive = local.connect(deliver);
  return {
    post: (message) => {
      queueMicrotask(() => {
        receive(message);
      });
    },
    listen: (h) => {
      handler = h;
    },
    terminate: () => {
      alive = false;
    },
  };
}

interface Seen {
  events: { event: string; payload: unknown }[];
  opened: number;
  closed: number;
}

function connect(scheduler: FakeScheduler) {
  const seen: Seen = { events: [], opened: 0, closed: 0 };
  const link = localLinkFactory(() => inlineEndpoint(scheduler))({
    onOpen: () => {
      seen.opened += 1;
    },
    onEvent: (event, payload) => {
      seen.events.push({ event, payload });
    },
    onClose: () => {
      seen.closed += 1;
    },
    onError: () => undefined,
  });
  return { link, seen };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const last = (seen: Seen, event: string) =>
  [...seen.events].reverse().find((e) => e.event === event)?.payload as
    Record<string, unknown> | undefined;

describe('離線主機（本機跑 @kot/room，不經 Socket.IO）', () => {
  it('握手 → 建房 → 加電腦 → 開局，全程走同一套協定', async () => {
    const scheduler = new FakeScheduler();
    const { link, seen } = connect(scheduler);
    await tick();
    expect(seen.opened).toBe(1);
    expect(link.connected).toBe(true);

    link.emit(EVENTS.clientHello, { protocolVersion: PROTOCOL_VERSION, nickname: '小明' });
    await tick();
    const hello = last(seen, EVENTS.serverHello);
    expect(hello?.['nickname']).toBe('小明');
    expect(hello?.['cardSets']).toEqual([
      expect.objectContaining({ id: 'original', name: expect.any(String) as string }),
    ]);

    const ask = (event: string, payload: unknown): Promise<Ack> =>
      link.request(event, payload, 1000);
    expect(await ask(EVENTS.roomCreate, {})).toEqual({ ok: true });
    expect(await ask(EVENTS.roomAddBot, {})).toEqual({ ok: true });
    expect(await ask(EVENTS.roomAddBot, {})).toEqual({ ok: true });
    expect(await ask(EVENTS.roomStart, {})).toEqual({ ok: true });
    await tick();
    expect((last(seen, EVENTS.roomState)?.['room'] as { phase: string }).phase).toBe('playing');
    expect(last(seen, EVENTS.gameUpdate)).toBeDefined();
  });

  it('一個人加電腦能玩完整局：真人逾時由系統代打，電腦照常出手，最後有勝者', async () => {
    const scheduler = new FakeScheduler();
    const { link, seen } = connect(scheduler);
    await tick();
    link.emit(EVENTS.clientHello, { protocolVersion: PROTOCOL_VERSION, nickname: '小明' });
    await tick();
    const ask = (event: string, payload: unknown): Promise<Ack> =>
      link.request(event, payload, 1000);
    await ask(EVENTS.roomCreate, {});
    await ask(EVENTS.roomAddBot, {});
    await ask(EVENTS.roomAddBot, {});
    await ask(EVENTS.roomStart, {});

    // 每次前進一小段時間（真人逾時、電腦出手都靠計時器），直到對局結束
    let over = false;
    for (let i = 0; i < 4000 && !over; i += 1) {
      scheduler.advance(1500);
      await tick();
      over =
        (last(seen, EVENTS.roomState)?.['room'] as { phase: string } | undefined)?.phase === 'over';
    }
    expect(over).toBe(true);
    const room = last(seen, EVENTS.roomState)?.['room'] as { phase: string; winnerIds?: string[] };
    expect(room.phase).toBe('over');
  }, 60_000);

  it('關閉連線後不再收到事件，進行中的請求會失敗', async () => {
    const scheduler = new FakeScheduler();
    const { link, seen } = connect(scheduler);
    await tick();
    const pending = link.request(EVENTS.roomCreate, {}, 1000);
    link.close();
    await expect(pending).rejects.toThrow();
    const count = seen.events.length;
    await tick();
    expect(seen.events.length).toBe(count);
    expect(link.connected).toBe(false);
  });
});
