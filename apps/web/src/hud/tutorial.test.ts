import { describe, expect, it } from 'vitest';
import {
  defaultTutorial,
  hintFor,
  HINT_IDS,
  introSlides,
  nextHint,
  parseTutorial,
  serializeTutorial,
  type HintContext,
  type TutorialState,
} from './tutorial.js';

const cfg = { victoryPoints: 20, startingHp: 10, maxRolls: 3, diceCount: 6, playerCount: 3 };
const ctx = (over: Partial<HintContext> = {}): HintContext => ({
  phase: 'roll',
  myTurn: true,
  actionTypes: new Set(),
  ...over,
});
const fresh = (over: Partial<TutorialState> = {}): TutorialState => ({
  ...defaultTutorial(),
  introSeen: true,
  ...over,
});

describe('偏好的儲存與解析', () => {
  it('預設：開啟、快速規則沒看過、沒有看過的提示', () => {
    expect(defaultTutorial()).toEqual({ enabled: true, introSeen: false, seen: [] });
    expect(parseTutorial(null)).toEqual(defaultTutorial());
  });
  it('存了再讀回來是一樣的（記得設定）', () => {
    const s: TutorialState = { enabled: false, introSeen: true, seen: ['roll', 'buy'] };
    expect(parseTutorial(serializeTutorial(s))).toEqual(s);
  });
  it('壞資料退回預設；不認得的提示 id 與重複會被丟掉', () => {
    for (const raw of ['', '{', '[]', '"x"', 'null', '42']) {
      expect(parseTutorial(raw)).toEqual(defaultTutorial());
    }
    expect(
      parseTutorial(
        JSON.stringify({ enabled: 'yes', introSeen: 1, seen: ['roll', 'roll', 'zzz'] }),
      ),
    ).toEqual({ enabled: true, introSeen: false, seen: ['roll'] });
  });
});

describe('快速規則與情境提示的內容', () => {
  it('投影片數值取自本局設定', () => {
    const text = introSlides({ ...cfg, victoryPoints: 15, maxRolls: 4 })
      .flatMap((s) => s.lines)
      .join('\n');
    expect(text).toContain('15 VP');
    expect(text).toContain('最多擲 4 次');
  });
  it('每張投影片都有圖示、標題與內容；每個情境提示都有文字', () => {
    for (const s of introSlides(cfg)) {
      expect(s.icon).not.toBe('');
      expect(s.title).not.toBe('');
      expect(s.lines.length).toBeGreaterThan(0);
    }
    for (const id of HINT_IDS) {
      expect(hintFor(id, cfg).text.length).toBeGreaterThan(10);
    }
    expect(hintFor('roll', { ...cfg, maxRolls: 5 }).text).toContain('5 次');
  });
});

describe('nextHint：什麼時候跳哪個提示', () => {
  it('輪到我擲骰 → roll；不是我的回合不跳', () => {
    expect(nextHint(fresh(), false, ctx())).toBe('roll');
    expect(nextHint(fresh(), false, ctx({ myTurn: false }))).toBeNull();
    // 擲骰動作不在「我的動作」清單裡，所以看的是階段
    expect(nextHint(fresh(), false, ctx({ phase: 'prompt' }))).toBeNull();
  });
  it('買牌階段輪到我 → buy', () => {
    expect(nextHint(fresh(), false, ctx({ phase: 'buy', actionTypes: new Set(['buy']) }))).toBe(
      'buy',
    );
  });
  it('被問要不要讓位（不論是不是我的回合）→ yield；分配治療 → hearts', () => {
    expect(
      nextHint(
        fresh(),
        false,
        ctx({ myTurn: false, phase: 'prompt', actionTypes: new Set(['yieldDecision']) }),
      ),
    ).toBe('yield');
    expect(
      nextHint(fresh(), false, ctx({ phase: 'prompt', actionTypes: new Set(['heartsDecision']) })),
    ).toBe('hearts');
  });
  it('需要做決定的優先：讓位 > 治療 > 買牌／擲骰', () => {
    const decide = new Set(['heartsDecision', 'yieldDecision']);
    const rolling = ctx({ phase: 'roll', actionTypes: decide });
    expect(nextHint(fresh(), false, rolling)).toBe('yield');
    expect(nextHint(fresh({ seen: ['yield'] }), false, rolling)).toBe('hearts');
    expect(nextHint(fresh({ seen: ['yield', 'hearts'] }), false, rolling)).toBe('roll');
    const buying = ctx({ phase: 'buy', actionTypes: decide });
    expect(nextHint(fresh({ seen: ['yield', 'hearts'] }), false, buying)).toBe('buy');
  });
  it('看過的不再跳、教學關閉不跳、快速規則還開著時不跳', () => {
    expect(nextHint(fresh({ seen: ['roll'] }), false, ctx())).toBeNull();
    expect(nextHint(fresh({ enabled: false }), false, ctx())).toBeNull();
    expect(nextHint(fresh(), true, ctx())).toBeNull();
  });
});
