import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatPanel } from './ChatPanel.js';

const entry = (id: number, from: string, text: string, seat: number | null = 0) => ({
  id,
  from,
  nickname: from === 'me' ? '我' : '阿明',
  seat,
  text,
  at: id,
});

describe('ChatPanel', () => {
  it('沒有訊息時顯示招呼提示；輸入框有長度上限，空白時不能送出', () => {
    const html = renderToStaticMarkup(
      <ChatPanel entries={[]} selfId="me" onSend={() => undefined} />,
    );
    expect(html).toContain('還沒有人說話');
    expect(html).toContain('maxLength="80"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>送出/);
  });

  it('列出訊息、以玩家顏色顯示暱稱、標出自己的訊息；訊息內容是文字不是 HTML', () => {
    const html = renderToStaticMarkup(
      <ChatPanel
        entries={[entry(1, 'p2', '<b>hi</b>'), entry(2, 'me', '你好', null)]}
        selfId="me"
        onSend={() => undefined}
      />,
    );
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;');
    expect(html).not.toContain('<b>hi</b>');
    expect(html).toMatch(/class="mine"/);
    expect(html).toMatch(/<b class="chat-name" style="color:#[0-9a-f]{6}/);
  });

  it('彈幕沒顯示時附上說明', () => {
    const html = renderToStaticMarkup(
      <ChatPanel
        entries={[]}
        selfId="me"
        onSend={() => undefined}
        danmakuNote="彈幕目前沒有顯示"
      />,
    );
    expect(html).toContain('彈幕目前沒有顯示');
  });
});
