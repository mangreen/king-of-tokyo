import type { DirectConnector, RtcSignal } from '@kot/room';

/** 暫時性的 ICE「disconnected」多久沒恢復就當作中斷（毫秒）。 */
const DISCONNECT_GRACE_MS = 8_000;

/**
 * 真正的 WebRTC 直連：一條可靠、有序的 RTCDataChannel，只傳字串訊框。
 * 房主端建立通道與 offer；客人端等通道出現。必須在主執行緒呼叫（Worker 沒有 RTCPeerConnection）。
 */
export function createRtcConnector(iceServers: RTCIceServer[]): DirectConnector {
  return (role, events) => {
    const pc = new RTCPeerConnection({ iceServers });
    let closed = false;
    let remoteSet = false;
    const pendingIce: RTCIceCandidateInit[] = [];
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let channelRef: RTCDataChannel | null = null;

    const finish = (): void => {
      if (closed) return;
      closed = true;
      if (disconnectTimer !== null) clearTimeout(disconnectTimer);
      try {
        pc.close();
      } catch {
        // 已關閉
      }
      events.close();
    };

    const bind = (channel: RTCDataChannel): void => {
      channel.onopen = () => {
        if (!closed) events.open();
      };
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (!closed && typeof event.data === 'string') events.message(event.data);
      };
      channel.onclose = finish;
      channel.onerror = finish;
      channelRef = channel;
    };

    pc.onicecandidate = (event) => {
      const c = event.candidate;
      if (closed || c === null) return;
      events.signal({
        k: 'ice',
        candidate: c.candidate,
        mid: c.sdpMid,
        index: c.sdpMLineIndex,
      });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') finish();
      else if (pc.connectionState === 'disconnected') {
        disconnectTimer ??= setTimeout(() => {
          if (pc.connectionState !== 'connected') finish();
        }, DISCONNECT_GRACE_MS);
      } else if (pc.connectionState === 'connected' && disconnectTimer !== null) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
      }
    };

    const fail = (): void => {
      finish();
    };

    if (role === 'host') {
      bind(pc.createDataChannel('kot', { ordered: true }));
      void pc
        .createOffer()
        .then(async (offer) => {
          await pc.setLocalDescription(offer);
          events.signal({ k: 'desc', type: 'offer', sdp: offer.sdp ?? '' });
        })
        .catch(fail);
    } else {
      pc.ondatachannel = (event) => {
        bind(event.channel);
      };
    }

    const applyIce = (init: RTCIceCandidateInit): void => {
      pc.addIceCandidate(init).catch(() => {
        // 個別候選無法加入很常見（例如不支援的類型），不影響其他候選
      });
    };

    return {
      signal(data: RtcSignal) {
        if (closed) return;
        if (data.k === 'ice') {
          const init: RTCIceCandidateInit = {
            candidate: data.candidate,
            sdpMid: data.mid,
            sdpMLineIndex: data.index,
          };
          if (remoteSet) applyIce(init);
          else pendingIce.push(init);
          return;
        }
        void (async () => {
          await pc.setRemoteDescription({ type: data.type, sdp: data.sdp });
          remoteSet = true;
          for (const init of pendingIce.splice(0)) applyIce(init);
          if (data.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            events.signal({ k: 'desc', type: 'answer', sdp: answer.sdp ?? '' });
          }
        })().catch(fail);
      },
      send(frame) {
        if (closed || channelRef?.readyState !== 'open') return;
        try {
          channelRef.send(frame);
        } catch {
          finish();
        }
      },
      close() {
        if (closed) return;
        closed = true;
        if (disconnectTimer !== null) clearTimeout(disconnectTimer);
        try {
          channelRef?.close();
          pc.close();
        } catch {
          // 已關閉
        }
      },
    };
  };
}
