import { describe, expect, it } from 'vitest';
import { createActivityPing } from './activity.js';

describe('createActivityPing', () => {
  it('第一次操作立刻送出；間隔內的連續操作只送一次；過了間隔再送', () => {
    let t = 1_000;
    let sent = 0;
    const ping = createActivityPing(
      () => {
        sent += 1;
      },
      () => t,
      20_000,
    );
    ping.touch();
    expect(sent).toBe(1);
    for (let i = 0; i < 50; i += 1) {
      t += 100;
      ping.touch();
    }
    expect(sent).toBe(1);
    t += 20_000;
    ping.touch();
    expect(sent).toBe(2);
  });

  it('沒有真的送出（例如還沒連線）就不算數：下一次操作馬上再試', () => {
    let connected = false;
    let sent = 0;
    const ping = createActivityPing(
      () => {
        if (!connected) return false;
        sent += 1;
        return true;
      },
      () => 0,
      20_000,
    );
    ping.touch();
    ping.touch();
    expect(sent).toBe(0);
    connected = true;
    ping.touch();
    expect(sent).toBe(1);
  });
});
