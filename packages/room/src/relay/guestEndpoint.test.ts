import { describe, expect, it } from 'vitest';
import { RELAY_EVENTS } from '@kot/protocol';
import { FakeScheduler } from '../testing.js';
import { createGuestEndpoint } from './guestEndpoint.js';
import type { RelaySocket } from './socket.js';
import type { ToClient } from '../local/protocol.js';

/** 手動控制的中繼連線：記下 join，由測試決定伺服器怎麼回。 */
function fakeSocket() {
  let onConnect: () => void = () => undefined;
  const joins: Array<(result: unknown) => void> = [];
  const socket: RelaySocket = {
    connected: true,
    emit: (event, _payload, ack) => {
      if (event === RELAY_EVENTS.join && ack) joins.push(ack);
    },
    onEvent: () => undefined,
    onConnect: (handler) => {
      onConnect = handler;
    },
    onDisconnect: () => undefined,
    onConnectError: () => undefined,
    disconnect: () => undefined,
  };
  return { socket, joins, connect: () => onConnect() };
}

function setup(resuming: boolean | undefined) {
  const scheduler = new FakeScheduler();
  const fake = fakeSocket();
  const received: ToClient[] = [];
  const endpoint = createGuestEndpoint(fake.socket, 'ABCDE', {
    scheduler,
    joinRetryMs: 1_000,
    joinGiveUpMs: 10_000,
    ...(resuming === undefined ? {} : { resuming }),
  });
  endpoint.listen((message) => received.push(message));
  fake.connect();
  return { scheduler, fake, received };
}

const errors = (received: ToClient[]): string[] =>
  received.flatMap((m) => (m.t === 'error' ? [m.code] : []));

describe('客人端點：加入重試', () => {
  it('房號找不到：一般加入立刻回報錯誤', () => {
    const { fake, received } = setup(undefined);
    fake.joins[0]?.({ ok: false, code: 'room_not_found' });
    expect(errors(received)).toEqual(['room_not_found']);
  });

  it('重新整理後接回（resuming）：房號暫時找不到時在期限內重試，找回後不報錯', () => {
    const { scheduler, fake, received } = setup(true);
    fake.joins[0]?.({ ok: false, code: 'room_not_found' });
    expect(errors(received)).toEqual([]);
    scheduler.advance(1_000);
    expect(fake.joins).toHaveLength(2);
    fake.joins[1]?.({ ok: true });
    scheduler.advance(20_000);
    expect(fake.joins).toHaveLength(2); // 加入成功就不再重試
    expect(errors(received)).toEqual([]);
  });

  it('接回一直找不到：超過期限就放棄並回報錯誤', () => {
    const { scheduler, fake, received } = setup(true);
    let answered = 0;
    for (let i = 0; i < 20; i += 1) {
      while (answered < fake.joins.length) {
        fake.joins[answered]?.({ ok: false, code: 'room_not_found' });
        answered += 1;
      }
      scheduler.advance(1_000);
    }
    expect(errors(received)).toEqual(['room_not_found']);
    expect(fake.joins.length).toBeLessThanOrEqual(12);
  });

  it('曾經加入成功，之後中斷再連上又找不到房號：也算接回，會重試', () => {
    const { scheduler, fake, received } = setup(undefined);
    fake.joins[0]?.({ ok: true });
    fake.connect(); // 重新連上
    fake.joins[1]?.({ ok: false, code: 'room_not_found' });
    expect(errors(received)).toEqual([]);
    scheduler.advance(1_000);
    expect(fake.joins).toHaveLength(3);
  });
});
