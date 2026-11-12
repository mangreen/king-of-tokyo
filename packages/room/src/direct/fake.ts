/**
 * 測試用的記憶體內直連：房主與客人用一個共用的「網路」配對。
 * 通道要手動 open()（模擬連線建立需要時間），可以 drop() 模擬斷線。
 */
import type { RtcSignal } from '../local/protocol.js';
import type { DirectConnector, DirectPeer, DirectPeerEvents, DirectRole } from './types.js';

interface FakeEnd {
  role: DirectRole;
  events: DirectPeerEvents;
  closed: boolean;
}

interface Pair {
  host: FakeEnd | null;
  guest: FakeEnd | null;
  open: boolean;
  /** 還沒送達的訊框（模擬傳輸延遲時用）。 */
  held: { to: FakeEnd; frame: string }[];
}

export interface FakeDirectNetwork {
  connector: DirectConnector;
  /** 目前配對成功、尚未開啟的連線數。 */
  readonly pending: number;
  /** 開啟所有已配對的連線（兩端都收到 open）。 */
  openAll(): void;
  /** 中斷所有連線（兩端都收到 close）。 */
  dropAll(): void;
  /** true＝訊框先扣住，flush() 才送達（用來測順序）。 */
  hold: boolean;
  flush(): void;
  /** 直接塞一個訊框給某一端（模擬對方送來壞資料）。 */
  inject(to: DirectRole, frame: string): void;
  /** 所有對等端的建立紀錄（角色）。 */
  readonly created: DirectRole[];
}

export function createFakeDirectNetwork(): FakeDirectNetwork {
  const pairs = new Map<string, Pair>();
  const created: DirectRole[] = [];
  let counter = 0;

  const deliver = (pair: Pair, to: FakeEnd, frame: string): void => {
    if (to.closed) return;
    to.events.message(frame);
  };

  const closePair = (pair: Pair): void => {
    for (const end of [pair.host, pair.guest]) {
      if (end && !end.closed) {
        end.closed = true;
        end.events.close();
      }
    }
  };

  const network: FakeDirectNetwork = {
    hold: false,
    created,
    get pending() {
      return [...pairs.values()].filter((p) => !p.open && p.host && p.guest).length;
    },
    openAll() {
      for (const pair of pairs.values()) {
        if (pair.open || !pair.host || !pair.guest) continue;
        pair.open = true;
        pair.host.events.open();
        pair.guest.events.open();
      }
    },
    dropAll() {
      for (const pair of pairs.values()) closePair(pair);
    },
    inject(to, frame) {
      for (const pair of pairs.values()) {
        const end = to === 'host' ? pair.host : pair.guest;
        if (end && !end.closed) end.events.message(frame);
      }
    },
    flush() {
      for (const pair of pairs.values()) {
        const held = pair.held.splice(0);
        for (const { to, frame } of held) deliver(pair, to, frame);
      }
    },
    connector(role, events): DirectPeer {
      created.push(role);
      const end: FakeEnd = { role, events, closed: false };
      let pair: Pair | null = null;
      if (role === 'host') {
        counter += 1;
        const key = `fake-${String(counter)}`;
        pair = { host: end, guest: null, open: false, held: [] };
        pairs.set(key, pair);
        events.signal({ k: 'desc', type: 'offer', sdp: key });
      }
      const peer: DirectPeer = {
        signal(data: RtcSignal) {
          if (role === 'guest' && data.k === 'desc' && data.type === 'offer') {
            const found = pairs.get(data.sdp);
            if (!found) return;
            pair = found;
            found.guest = end;
            events.signal({ k: 'desc', type: 'answer', sdp: data.sdp });
          }
        },
        send(frame) {
          if (!pair?.open || end.closed) return;
          const to = role === 'host' ? pair.guest : pair.host;
          if (!to) return;
          if (network.hold) pair.held.push({ to, frame });
          else deliver(pair, to, frame);
        },
        close() {
          if (end.closed) return;
          end.closed = true;
          // 對方會收到 close（模擬連線中斷）
          const other = role === 'host' ? pair?.guest : pair?.host;
          if (other && !other.closed) {
            other.closed = true;
            other.events.close();
          }
        },
      };
      return peer;
    },
  };
  return network;
}
