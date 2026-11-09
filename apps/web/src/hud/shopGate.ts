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
