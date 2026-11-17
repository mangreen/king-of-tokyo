import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAP } from '@kot/rules';

const rulesSrc = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'rules', 'src');

describe('卡牌可觸發性稽核：能力開關（CAP）', () => {
  it('每個 CAP 在引擎（engine／legal）裡都有使用點，不會有買了卻永遠不會被檢查的卡', () => {
    const src = ['engine.ts', 'legal.ts']
      .map((f) => readFileSync(join(rulesSrc, f), 'utf8'))
      .join('\n');
    const unused = Object.keys(CAP).filter((key) => !new RegExp(`CAP\\.${key}\\b`).test(src));
    expect(unused).toEqual([]);
  });
});
