import type { Ack } from '@kot/protocol';
import type { ClientLink, LinkFactory, LinkHandlers } from './link.js';
import type { LocalEndpoint } from '@kot/room';

export type { LocalEndpoint };

/** 連到一個「房主」（本機 Worker 或經中繼的遠端房主）。onOpen 會在對方就緒後非同步呼叫。 */
export function localLinkFactory(createEndpoint: () => LocalEndpoint): LinkFactory {
  return (handlers: LinkHandlers): ClientLink => {
    const endpoint = createEndpoint();
    let connected = false;
    let closed = false;
    let nextAck = 1;
    const pending = new Map<number, { resolve: (ack: Ack) => void; reject: (e: Error) => void }>();

    const failPending = (): void => {
      for (const { reject } of pending.values()) reject(new Error('連線已中斷'));
      pending.clear();
    };

    endpoint.listen((message) => {
      if (closed) return;
      switch (message.t) {
        case 'open':
          connected = true;
          handlers.onOpen();
          break;
        case 'emit':
          handlers.onEvent(message.event, message.payload);
          break;
        case 'ack': {
          const entry = pending.get(message.ackId);
          pending.delete(message.ackId);
          entry?.resolve(message.result);
          break;
        }
        case 'closed':
          connected = false;
          failPending();
          handlers.onClose();
          break;
        case 'error':
          connected = false;
          failPending();
          handlers.onError(message.code);
          break;
      }
    });

    return {
      get connected() {
        return connected && !closed;
      },
      emit(event, payload) {
        if (!connected || closed) return;
        endpoint.post({ t: 'event', event, payload });
      },
      request(event, payload, timeoutMs): Promise<Ack> {
        if (!connected || closed) return Promise.reject(new Error('尚未連線'));
        return new Promise<Ack>((resolve, reject) => {
          const ackId = nextAck;
          nextAck += 1;
          const timer = setTimeout(() => {
            pending.delete(ackId);
            reject(new Error('逾時'));
          }, timeoutMs);
          pending.set(ackId, {
            resolve: (ack) => {
              clearTimeout(timer);
              resolve(ack);
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            },
          });
          endpoint.post({ t: 'event', event, payload, ackId });
        });
      },
      close() {
        if (closed) return;
        closed = true;
        connected = false;
        failPending();
        endpoint.post({ t: 'close' });
        endpoint.terminate();
      },
    };
  };
}
