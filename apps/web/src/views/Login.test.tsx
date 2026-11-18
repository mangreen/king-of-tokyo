import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Login } from './Login.js';

const render = (props: Partial<Parameters<typeof Login>[0]> = {}): string =>
  renderToStaticMarkup(
    <Login
      onLogin={() => undefined}
      hostMode
      mode="p2p"
      onModeChange={() => undefined}
      {...props}
    />,
  );

describe('登入頁的玩法選擇', () => {
  it('列出三種玩法，包含離線單機，目前的模式被勾選', () => {
    const html = render();
    expect(html).toContain('data-testid="mode-picker"');
    expect(html).toContain('線上對戰（房主模式）');
    expect(html).toContain('離線單機');
    expect(html).toContain('線上對戰（伺服器模式）');
    expect(html).toMatch(/checked=""\s+value="p2p"/);
  });

  it('試玩版（沒有伺服器模式）：玩法選擇只列房主模式與離線單機', () => {
    const html = render({ modes: ['p2p', 'offline'] });
    expect(html).toContain('線上對戰（房主模式）');
    expect(html).toContain('離線單機');
    expect(html).not.toContain('伺服器模式');
    expect(html).not.toContain('value="server"');
  });

  it('離線模式：說明第一次要連網、之後可離線開啟', () => {
    const html = render({ mode: 'offline', hostMode: false });
    expect(html).toContain('data-testid="offline-cache-hint"');
    expect(html).toContain('第一次需要連網');
    expect(html).toMatch(/checked=""\s+value="offline"/);
  });

  it('從邀請連結進來時不顯示玩法選擇（直接加入朋友的房間）', () => {
    expect(render({ inviteCode: 'ABCDE' })).not.toContain('mode-picker');
  });
});
