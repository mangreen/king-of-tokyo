/**
 * 買牌階段，商店還有買得起的牌、而且玩家還沒按「離開商店」時，
 * 「結束回合」要先換成「離開商店」，避免不小心直接結束回合。
 * `buyKey` 是這個買牌階段的識別（輪次＋座位），不在自己的買牌階段時為 null。
 */
export function shouldHoldEndTurn(
  buyKey: string | null,
  leftShopFor: string | null,
  buyable: number,
): boolean {
  return buyKey !== null && leftShopFor !== buyKey && buyable > 0;
}

/** 提示要用的最小形狀（Toast 也符合）。 */
interface ShopToastLike {
  action?: 'shop';
  text: string;
}

/**
 * 「商店有 N 張牌買得起」提示只在「現在真的還買得起、而且還沒離開商店」時顯示，
 * 數字跟著現在買得起的張數走。買到沒能量、離開商店、離開買牌階段後都要收掉——
 * 否則提示還掛在畫面上，但「離開商店」按鈕早就沒了（買不起），兩邊對不上。
 * 沒有需要改的提示就原樣回傳（維持物件identity，提示的倒數計時才不會被重設）。
 */
export function visibleShopToasts<T extends ShopToastLike>(
  toasts: readonly T[],
  buyKey: string | null,
  leftShopFor: string | null,
  buyable: number,
  textFor: (buyable: number) => string,
): readonly T[] {
  const show = shouldHoldEndTurn(buyKey, leftShopFor, buyable);
  if (toasts.every((t) => t.action !== 'shop')) return toasts;
  const text = show ? textFor(buyable) : '';
  const out: T[] = [];
  for (const t of toasts) {
    if (t.action !== 'shop') out.push(t);
    else if (show) out.push(t.text === text ? t : { ...t, text });
  }
  return out;
}
