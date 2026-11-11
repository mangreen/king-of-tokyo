/**
 * 離線主機的 Worker 進入點：房間邏輯、計時與電腦玩家的計算都在這裡跑，
 * 不佔用畫面（3D 渲染）所在的主執行緒。
 */
import { loadCardSetFromJson } from '@kot/cardsets/pure';
import originalCardSet from '../../../../card-sets/original/set.json';
import { createLocalHost } from './localHost.js';
import type { ToClient, ToHost } from './localProtocol.js';

/** 只宣告用到的 Worker 全域，避免和 DOM 型別衝突。 */
const scope = self as unknown as {
  postMessage(message: ToClient): void;
  onmessage: ((event: { data: ToHost }) => void) | null;
  close(): void;
};

const local = createLocalHost({ cardSet: loadCardSetFromJson(originalCardSet, 'original') });
const receive = local.connect((message) => {
  scope.postMessage(message);
});
scope.onmessage = (event) => {
  receive(event.data);
  if (event.data.t === 'close') scope.close();
};
