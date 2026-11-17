import { useCallback, useEffect, useState } from 'react';
import {
  defaultTutorial,
  parseTutorial,
  serializeTutorial,
  TUTORIAL_KEY,
  type HintId,
  type TutorialState,
} from './tutorial.js';

function load(): TutorialState {
  try {
    return parseTutorial(window.localStorage.getItem(TUTORIAL_KEY));
  } catch {
    return defaultTutorial(); // 無痕模式或被封鎖時：照常運作，只是不會記得
  }
}

export interface TutorialControls {
  state: TutorialState;
  /** 快速規則投影片是否開著。 */
  introOpen: boolean;
  /** 關掉快速規則（看完或跳過）；disable＝連之後的教學提示一起關掉。 */
  finishIntro: (disable: boolean) => void;
  replayIntro: () => void;
  dismissHint: (id: HintId) => void;
  setEnabled: (on: boolean) => void;
  /** 重置：之後又會重新跳出提示（不會自動重開快速規則，要的話按「重看快速規則」）。 */
  reset: () => void;
}

/** 新手教學的狀態：記在 localStorage，下次進遊戲記得（讀寫失敗不影響遊戲）。 */
export function useTutorial(): TutorialControls {
  const [state, setState] = useState<TutorialState>(load);
  const [introOpen, setIntroOpen] = useState(() => state.enabled && !state.introSeen);

  useEffect(() => {
    try {
      window.localStorage.setItem(TUTORIAL_KEY, serializeTutorial(state));
    } catch {
      /* 儲存失敗就算了 */
    }
  }, [state]);

  const finishIntro = useCallback((disable: boolean) => {
    setIntroOpen(false);
    setState((s) => ({ ...s, introSeen: true, enabled: disable ? false : s.enabled }));
  }, []);
  const replayIntro = useCallback(() => {
    setIntroOpen(true);
  }, []);
  const dismissHint = useCallback((id: HintId) => {
    setState((s) => (s.seen.includes(id) ? s : { ...s, seen: [...s.seen, id] }));
  }, []);
  const setEnabled = useCallback((on: boolean) => {
    setState((s) => ({ ...s, enabled: on }));
    if (!on) setIntroOpen(false);
  }, []);
  const reset = useCallback(() => {
    setState((s) => ({ ...s, enabled: true, seen: [] }));
  }, []);

  return { state, introOpen, finishIntro, replayIntro, dismissHint, setEnabled, reset };
}
