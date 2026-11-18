import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomSnapshot } from '@kot/protocol';
import { RoomView } from './RoomView.js';

const room: RoomSnapshot = {
  code: 'ABCDE',
  cardSet: { id: 'original', name: '原創卡組', cardCount: 72 } as RoomSnapshot['cardSet'],
  phase: 'lobby',
  hostId: 'p1',
  players: [{ id: 'p1', nickname: 'A', ready: true, connected: true, bot: false }],
} as RoomSnapshot;

const render = (shareable?: boolean): string =>
  renderToStaticMarkup(
    <RoomView
      room={room}
      selfId="p1"
      onReady={() => undefined}
      onStart={() => undefined}
      onAddBot={() => undefined}
      onRemoveBot={() => undefined}
      onLeave={() => undefined}
      {...(shareable === undefined ? {} : { shareable })}
    />,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RoomView 的邀請連結', () => {
  it('一般模式（房主／伺服器）：顯示邀請連結與複製按鈕', () => {
    vi.stubGlobal('window', { location: { href: 'https://x.test/' } });
    const html = render();
    expect(html).toContain('邀請連結');
    expect(html).toContain('複製連結');
  });

  it('離線單機（shareable=false）：房間只存在這個分頁，不顯示邀請連結', () => {
    const html = render(false);
    expect(html).not.toContain('邀請連結');
    expect(html).not.toContain('複製連結');
    expect(html).not.toContain('也可以在大廳輸入房號加入');
    expect(html).toContain('開始遊戲');
  });
});
