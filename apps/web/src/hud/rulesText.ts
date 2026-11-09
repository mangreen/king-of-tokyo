import type { Face } from '@kot/rules';

/**
 * 遊戲內的規則說明文字。內容出自 docs/rules-spec.md（括號裡的編號可對照），
 * 數值（20 VP、10 HP、3 次重擲…）取自本局設定，不寫死。
 */
export interface RuleConfig {
  victoryPoints: number;
  startingHp: number;
  maxRolls: number;
  diceCount: number;
  playerCount: number;
}

export interface RuleSection {
  title: string;
  lines: string[];
}

export function diceRules(c: RuleConfig): RuleSection[] {
  return [
    {
      title: '擲骰',
      lines: [
        `每回合有 ${String(c.diceCount)} 顆骰子，最多擲 ${String(c.maxRolls)} 次（首擲＋重擲），可隨時停止。（R-DICE-01）`,
        '重擲前點骰子選擇要「保留」的，其餘重擲；已保留的可以收回再擲。（R-DICE-02）',
        '骰子結果由伺服器決定，不能作弊。（R-DICE-07）',
      ],
    },
    {
      title: '結算（骰子必須全部結算）',
      lines: [
        '1／2／3：同點數湊滿 3 顆，得 1／2／3 VP；每多一顆相同點數再 +1 VP。（R-DICE-04）',
        '⚡ 能量：每個得 1 能量，不必成組，可跨回合保留。（R-DICE-05）',
        `❤️ 治療：在東京外每個回復 1 HP，上限 ${String(c.startingHp)}；在東京內無效。（R-HEAL-01／02）`,
        '💥 攻擊：在東京內，對所有不在東京的怪獸各造成「攻擊面數」點傷害；在東京外，則對所有在東京的怪獸。（R-SMASH-01／02）',
        '結算順序：VP → 能量 → 治療 → 攻擊；卡牌可能改變數值。（R-DICE-06）',
      ],
    },
    {
      title: '攻擊之後',
      lines: [
        '被攻擊的東京怪獸可以選擇「讓位」：仍承受傷害，但攻擊者會移入東京。（R-TOKYO-04）',
        '東京沒人時，結算後你若在東京外就必須進入東京，並得 1 VP。（R-TOKYO-01／03）',
        '回合開始時若在東京內，得 2 VP。（R-TURN-02）',
      ],
    },
  ];
}

export function endRules(c: RuleConfig): RuleSection[] {
  const vp = String(c.victoryPoints);
  return [
    {
      title: '怎樣算贏',
      lines: [
        `最後一位存活的怪獸立即獲勝。（R-END-01）`,
        `輪到你的回合「結束時」，你仍存活且 VP ≥ ${vp}，立即獲勝。必須存活到回合結束；同回合被淘汰就不算。（R-END-02／05）`,
        `每一輪的最後一位玩家回合結束時，只要有存活的怪獸 VP ≥ ${vp}，遊戲結束。（R-END-03）`,
        `在別人的回合先到 ${vp} VP（例如買到加分卡）不會立即獲勝，要等整輪結束或輪到自己結束回合。（R-END-04）`,
      ],
    },
    {
      title: '多人同時達標',
      lines: [
        '依序比較：VP → 剩餘 HP → 能量 → Keep 卡張數，較多者獲勝；全部相同才並列獲勝。（R-END-07）',
        '所有怪獸同時被淘汰，則沒有勝者。（R-END-06）',
      ],
    },
  ];
}

export function tokyoRules(c: RuleConfig): RuleSection[] {
  return [
    {
      title: '東京',
      lines: [
        c.playerCount >= 5
          ? '5–6 人有「東京市」與「東京灣」兩個位置；東京市優先填，已有人時進入東京灣。（R-SETUP-02、R-TOKYO-02）'
          : '2–4 人只有「東京市」一個位置。（R-SETUP-02）',
        '東京內的怪獸之間不會互相攻擊。（R-SMASH-03）',
        c.playerCount >= 5
          ? '存活怪獸降到 4 位以下時東京灣停用，灣內怪獸必須離開。（R-TOKYO-09）'
          : '',
      ].filter((l) => l !== ''),
    },
    {
      title: '買牌',
      lines: [
        '商店有 3 張面朝上的牌；每張支付卡面費用的能量，買了立即補牌。（R-CARD-01）',
        '可花 2 能量清掉全部 3 張並重新翻牌。（R-CARD-02）',
        '持續（Keep）卡留在面前到遊戲結束；一次性（Discard）卡立即結算後丟棄。（R-CARD-03）',
      ],
    },
  ];
}

/** 目前這組骰子「若現在結算」會得到什麼（只算骰面本身，卡牌效果不計）。 */
export function diceSummary(dice: readonly Face[], inTokyo: boolean | null): string[] {
  if (dice.length === 0) return [];
  const count = (f: Face): number => dice.filter((d) => d === f).length;
  const lines: string[] = [];

  for (const n of [1, 2, 3] as const) {
    const c = count(n);
    if (c >= 3) {
      const gain = n + (c - 3);

      lines.push(`${String(c)} 顆 ${String(n)} → +${String(gain)} VP`);
    }
  }
  const energy = count('energy');
  if (energy > 0) lines.push(`${String(energy)} 個 ⚡ → +${String(energy)} 能量`);
  const heal = count('heal');
  if (heal > 0) {
    lines.push(
      inTokyo === true
        ? `${String(heal)} 個 ❤️ → 在東京內，治療無效`
        : `${String(heal)} 個 ❤️ → 回復 ${String(heal)} HP（上限內）`,
    );
  }
  const attack = count('attack');
  if (attack > 0) {
    lines.push(
      inTokyo === true
        ? `${String(attack)} 個 💥 → 對東京外的每位怪獸造成 ${String(attack)} 傷害`
        : `${String(attack)} 個 💥 → 對東京內的怪獸造成 ${String(attack)} 傷害`,
    );
  }
  if (lines.length === 0) lines.push('這組骰子沒有可結算的收益');
  return lines;
}
