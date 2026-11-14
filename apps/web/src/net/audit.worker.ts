/**
 * 局後稽核 Worker（M10）：在背景重放整場對局，不佔用畫面所在的主執行緒。
 * 輸入是房主揭露的複本與我在對局中看過的畫面摘要；輸出是稽核報告。
 * 只在一局打完時才會被建立，用完即丟。
 */
import { loadCardSetFromJson } from '@kot/cardsets/pure';
import { auditGame, type AuditInput, type AuditReport } from '@kot/room';
import originalCardSet from '../../../../card-sets/original/set.json';

export interface AuditRequest {
  id: number;
  input: AuditInput;
}
export type AuditResponse = { id: number; report: AuditReport } | { id: number; error: string };

const scope = self as unknown as {
  postMessage(message: AuditResponse): void;
  onmessage: ((event: { data: AuditRequest }) => void) | null;
};

const loaded = loadCardSetFromJson(originalCardSet, 'original');
const env = { cards: Object.fromEntries(loaded.set.cards.map((card) => [card.id, card])) };

scope.onmessage = (event) => {
  const { id, input } = event.data;
  try {
    const report = auditGame(input, (cardSetId) =>
      cardSetId === loaded.set.id ? { hash: loaded.hash, env } : null,
    );
    scope.postMessage({ id, report });
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : '稽核失敗' });
  }
};
