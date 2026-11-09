import type { Palette, Spec } from './monsterBuilder.js';

/**
 * 第二批六種原創怪獸造型：巨龜、螳螂、雪怪、石魔、蘑菇怪、獨眼怪。
 * 座標：y 向上、z 朝前；樞軸與動畫約定同 monsters.ts（頭、左右臂、尾各自可轉動）。
 */

export const EXTRA_PALETTES: Palette[] = [
  { main: '#2a9d8f', dark: '#1b5e56', light: '#cfe9a8', accent: '#e9c46a', eye: '#ffffff' },
  { main: '#9ccc3a', dark: '#4f7a1f', light: '#e6f5b0', accent: '#d94f70', eye: '#ff5a5a' },
  { main: '#eef3f8', dark: '#9db4c8', light: '#ffffff', accent: '#4aa8ff', eye: '#1b3a5c' },
  { main: '#8d8a85', dark: '#55524d', light: '#b9b4aa', accent: '#ff9f1c', eye: '#ffd23f' },
  { main: '#d94b4b', dark: '#8c2a2a', light: '#f5e6c8', accent: '#7bd389', eye: '#1b1b1b' },
  { main: '#f0a030', dark: '#a8641a', light: '#ffe2a8', accent: '#9b5de5', eye: '#ffffff' },
];

export function turtle(s: Spec, p: Palette, accent: string): void {
  const { body, head, armL, armR, tail } = s;
  s.pivots = {
    head: [0, 3.0, 1.35],
    armL: [1.3, 2.4, 0.5],
    armR: [-1.3, 2.4, 0.5],
    tail: [0, 1.5, -1.6],
  };
  // 龜殼：寬扁的圓頂，頂上一圈強調色的甲片
  body
    .ball(1.7, p.dark, [0, 2.55, -0.25], [1.15, 0.85, 1.2])
    .ball(1.45, p.main, [0, 2.75, -0.25], [1.1, 0.75, 1.15])
    .ball(1.2, p.light, [0, 1.85, 0.2], [1.0, 0.55, 1.0]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    body.ball(0.36, accent, [Math.cos(a) * 0.95, 3.45, -0.25 + Math.sin(a) * 1.0], [1, 0.55, 1]);
  }
  body.ball(0.45, accent, [0, 3.65, -0.25], [1, 0.6, 1]);
  for (const sx of [0.85, -0.85]) {
    body.limb([sx, 1.7, -0.7], [sx * 1.15, 0.4, -0.55], 0.6, 0.5, p.dark);
    body.box([0.9, 0.3, 1.2], p.dark, [sx * 1.15, 0.15, -0.3]);
  }
  head.limb([0, 2.6, 1.0], [0, 3.1, 1.7], 0.5, 0.42, p.main);
  head
    .ball(0.62, p.main, [0, 3.25, 2.0], [0.95, 0.9, 1.05])
    .box([0.55, 0.14, 0.5], p.dark, [0, 2.98, 2.5]);
  for (const sx of [0.32, -0.32])
    head.ball(0.13, p.eye, [sx, 3.45, 2.32]).ball(0.07, '#111111', [sx, 3.45, 2.43]);
  for (const [arm, sx] of [
    [armL, 1],
    [armR, -1],
  ] as const) {
    arm
      .limb([sx * 1.3, 2.4, 0.5], [sx * 1.95, 1.55, 1.15], 0.42, 0.34, p.main)
      .ball(0.36, p.main, [sx * 2.0, 1.45, 1.25]);
    arm.spike([sx * 2.0, 1.45, 1.3], [sx * 2.05, 1.25, 1.85], 0.12, '#fff7e0');
  }
  tail
    .limb([0, 1.5, -1.6], [0, 1.2, -2.6], 0.4, 0.2, p.main)
    .spike([0, 1.2, -2.6], [0, 1.15, -3.3], 0.14, accent);
}

export function mantis(s: Spec, p: Palette, accent: string): void {
  const { body, head, armL, armR, tail } = s;
  s.pivots = {
    head: [0, 4.2, 0.3],
    armL: [0.75, 3.5, 0.3],
    armR: [-0.75, 3.5, 0.3],
    tail: [0, 2.0, -0.7],
  };
  // 細長的胸腹，四隻細腿
  body
    .ball(0.7, p.main, [0, 3.2, 0], [0.85, 1.55, 0.8])
    .ball(0.55, p.light, [0, 3.0, 0.35], [0.7, 1.2, 0.4])
    .ball(0.6, p.main, [0, 2.1, -0.1], [0.85, 1.0, 0.85]);
  for (const sx of [0.55, -0.55]) {
    body.limb([sx, 1.9, -0.2], [sx * 1.7, 1.0, -0.5], 0.14, 0.1, p.dark);
    body.limb([sx * 1.7, 1.0, -0.5], [sx * 1.8, 0.0, -0.3], 0.1, 0.06, p.dark);
    body.limb([sx, 1.9, 0.2], [sx * 1.5, 1.0, 0.7], 0.14, 0.1, p.dark);
    body.limb([sx * 1.5, 1.0, 0.7], [sx * 1.6, 0.0, 0.9], 0.1, 0.06, p.dark);
  }
  // 倒三角的頭、大複眼、觸角
  head
    .ball(0.55, p.main, [0, 4.35, 0.4], [1.25, 0.8, 0.85])
    .ball(0.32, p.dark, [0, 4.1, 0.65], [1, 0.8, 0.8]);
  for (const sx of [0.52, -0.52])
    head.ball(0.26, p.eye, [sx, 4.5, 0.55]).ball(0.1, '#111111', [sx * 1.05, 4.5, 0.75]);
  for (const sx of [0.18, -0.18])
    head.limb([sx, 4.7, 0.5], [sx * 2.6, 5.5, 0.9], 0.04, 0.03, p.dark);
  // 兩把大鐮刀
  for (const [arm, sx] of [
    [armL, 1],
    [armR, -1],
  ] as const) {
    arm.limb([sx * 0.75, 3.5, 0.3], [sx * 1.15, 4.3, 1.1], 0.2, 0.16, p.main);
    arm.limb([sx * 1.15, 4.3, 1.1], [sx * 1.2, 3.1, 1.85], 0.16, 0.1, p.main);
    arm.spike([sx * 1.2, 3.15, 1.8], [sx * 1.2, 2.2, 1.95], 0.17, accent);
    for (let i = 0; i < 3; i++)
      arm.spike(
        [sx * 1.1, 3.9 - i * 0.35, 1.3 + i * 0.15],
        [sx * 0.8, 3.75 - i * 0.35, 1.55 + i * 0.15],
        0.07,
        p.light,
      );
  }
  // 長腹與翅膀
  tail
    .limb([0, 2.0, -0.7], [0, 1.9, -2.8], 0.55, 0.3, p.main)
    .ball(0.28, accent, [0, 1.85, -3.0], [1, 0.8, 1.2]);
  for (const sx of [0.5, -0.5])
    tail.box([0.9, 0.05, 2.3], p.light, [sx, 2.6, -1.8], [0, sx * 0.25, 0]);
}

export function yeti(s: Spec, p: Palette, accent: string): void {
  const { body, head, armL, armR, tail } = s;
  s.pivots = {
    head: [0, 3.95, 0.5],
    armL: [1.5, 3.1, 0],
    armR: [-1.5, 3.1, 0],
    tail: [0, 1.5, -0.8],
  };
  body
    .ball(1.25, p.main, [0, 2.65, 0], [1.4, 1.25, 1.1])
    .ball(0.85, p.dark, [0, 2.45, 0.65], [1.0, 1.0, 0.45]);
  body.ball(0.95, p.main, [0, 1.6, 0], [1.25, 0.9, 1.0]);
  // 毛茸茸的毛團
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    body.ball(0.38, p.light, [Math.cos(a) * 1.35, 2.2 + (i % 3) * 0.55, Math.sin(a) * 0.9 - 0.1]);
  }
  for (const sx of [0.75, -0.75]) {
    body.limb([sx, 1.7, 0], [sx * 1.1, 0.45, 0.15], 0.6, 0.55, p.main);
    body.ball(0.6, p.light, [sx * 1.1, 0.3, 0.35], [1, 0.55, 1.4]);
  }
  head.ball(0.8, p.main, [0, 4.1, 0.55], [1.1, 0.95, 1]);
  head.ball(0.5, accent, [0, 4.0, 1.1], [1.1, 0.9, 0.5]);
  head.box([0.7, 0.16, 0.2], '#2a2f3a', [0, 3.75, 1.3]);
  for (const sx of [0.22, 0.07, -0.07, -0.22])
    head.spike([sx, 3.75, 1.38], [sx, 3.52, 1.38], 0.05, '#ffffff');
  for (const sx of [0.3, -0.3])
    head.ball(0.12, p.eye, [sx, 4.25, 1.28]).ball(0.06, '#ffffff', [sx + 0.03, 4.28, 1.38]);
  for (const sx of [0.5, -0.5]) head.spike([sx, 4.7, 0.5], [sx * 1.6, 5.5, 0.2], 0.18, '#cfeeff');
  for (const [arm, sx] of [
    [armL, 1],
    [armR, -1],
  ] as const) {
    arm.limb([sx * 1.5, 3.1, 0], [sx * 2.1, 1.9, 0.3], 0.55, 0.5, p.main);
    arm.limb([sx * 2.1, 1.9, 0.3], [sx * 2.15, 0.9, 0.65], 0.5, 0.45, p.main);
    arm.ball(0.6, p.light, [sx * 2.15, 0.75, 0.75]);
  }
  tail.ball(0.45, p.light, [0, 1.5, -1.1]);
}

export function golem(s: Spec, p: Palette, accent: string): void {
  const { body, head, armL, armR, tail } = s;
  s.pivots = {
    head: [0, 4.2, 0.3],
    armL: [1.75, 3.4, 0],
    armR: [-1.75, 3.4, 0],
    tail: [0, 1.6, -0.9],
  };
  body
    .box([2.3, 1.9, 1.5], p.main, [0, 2.85, 0], [0, 0, 0.04])
    .box([1.6, 0.9, 0.3], p.dark, [0, 2.9, 0.78])
    .box([0.9, 0.2, 0.12], accent, [0, 3.05, 0.95])
    .box([0.25, 0.7, 0.12], accent, [0, 2.75, 0.95]);
  body.box([1.7, 0.9, 1.1], p.dark, [0, 1.6, 0], [0, 0.08, 0]);
  for (const sx of [0.7, -0.7]) {
    body.box([0.9, 1.3, 0.95], p.main, [sx, 0.75, 0.05], [0, sx * 0.1, 0]);
    body.box([1.1, 0.35, 1.4], p.dark, [sx, 0.17, 0.3]);
    body.box([0.9, 0.5, 0.7], p.light, [sx * 1.9, 3.75, -0.1], [0.2, 0, sx * 0.3]);
  }
  // 背上的碎石與苔蘚
  for (let i = 0; i < 4; i++)
    body.box([0.45, 0.6, 0.45], p.light, [(i - 1.5) * 0.6, 3.9, -0.85], [0.3, i, 0.2]);
  body.ball(0.35, '#5d8a3a', [0.9, 3.8, -0.6], [1.2, 0.5, 1]);
  head
    .box([1.15, 0.9, 1.0], p.main, [0, 4.35, 0.3], [0, 0.1, 0])
    .box([1.3, 0.25, 1.1], p.light, [0, 4.9, 0.3]);
  head
    .box([0.8, 0.16, 0.12], p.eye, [0, 4.4, 0.82])
    .box([0.9, 0.2, 0.14], '#111111', [0, 4.13, 0.84]);
  for (const [arm, sx] of [
    [armL, 1],
    [armR, -1],
  ] as const) {
    arm.box([0.95, 0.9, 0.95], p.light, [sx * 1.75, 3.45, 0], [0.2, 0, sx * 0.2]);
    arm.box([0.85, 1.5, 0.85], p.main, [sx * 2.05, 2.3, 0.25], [0.15, 0, sx * 0.1]);
    arm.box([1.25, 1.1, 1.2], p.dark, [sx * 2.1, 1.2, 0.5], [0.1, sx * 0.2, 0]);
    arm.box([0.35, 0.35, 0.12], accent, [sx * 2.1, 1.3, 1.12]);
  }
  tail.box([0.8, 0.5, 0.8], p.dark, [0, 1.6, -1.0]);
}

export function mushroom(s: Spec, p: Palette, accent: string): void {
  const { body, head, armL, armR, tail } = s;
  s.pivots = {
    head: [0, 3.7, 0],
    armL: [0.95, 2.4, 0.2],
    armR: [-0.95, 2.4, 0.2],
    tail: [0, 1.0, -0.9],
  };
  // 粗短的菌柄身體＋小小的臉
  body.limb([0, 0.9, 0], [0, 3.6, 0], 0.95, 0.75, p.light);
  body.ball(0.9, p.light, [0, 1.0, 0], [1.05, 0.6, 1.05]);
  body.box([1.7, 0.16, 1.7], p.dark, [0, 3.45, 0]);
  for (const sx of [0.3, -0.3])
    body.ball(0.16, '#1b1b1b', [sx, 2.8, 0.72]).ball(0.06, '#ffffff', [sx + 0.04, 2.84, 0.84]);
  body.box([0.38, 0.1, 0.1], '#8c2a2a', [0, 2.45, 0.78]);
  for (const sx of [0.55, -0.55]) {
    body.ball(0.35, accent, [sx * 1.25, 2.5, 0.55], [1, 0.45, 0.8]);
    body.limb([sx, 1.0, 0], [sx * 1.2, 0.25, 0.2], 0.4, 0.38, p.dark);
    body.ball(0.45, p.dark, [sx * 1.2, 0.18, 0.3], [1.1, 0.5, 1.4]);
  }
  // 大蘑菇傘（頭）與斑點
  head.ball(1.75, p.main, [0, 4.0, 0], [1, 0.6, 1]);
  head.ball(1.3, p.dark, [0, 3.65, 0], [1.1, 0.2, 1.1]);
  const spots: [number, number, number, number][] = [
    [0, 4.65, 0.2, 0.42],
    [0.95, 4.35, 0.5, 0.33],
    [-0.9, 4.4, 0.6, 0.3],
    [0.5, 4.3, -0.95, 0.35],
    [-0.7, 4.2, -0.8, 0.3],
    [1.4, 4.0, -0.3, 0.26],
    [-1.45, 3.95, -0.1, 0.27],
  ];
  for (const [x, y, z, r] of spots) head.ball(r, p.light, [x, y, z], [1, 0.45, 1]);
  for (const [arm, sx] of [
    [armL, 1],
    [armR, -1],
  ] as const) {
    arm
      .limb([sx * 0.95, 2.4, 0.2], [sx * 1.6, 1.6, 0.8], 0.3, 0.26, p.light)
      .ball(0.3, p.light, [sx * 1.65, 1.5, 0.85]);
  }
  tail
    .ball(0.38, accent, [0, 1.0, -1.0], [1, 0.8, 1])
    .ball(0.26, p.light, [0.3, 0.9, -1.35])
    .ball(0.2, p.light, [-0.3, 0.85, -1.4]);
}

export function cyclops(s: Spec, p: Palette, accent: string): void {
  const { body, head, armL, armR, tail } = s;
  s.pivots = {
    head: [0, 3.7, 0.4],
    armL: [1.3, 3.0, 0.1],
    armR: [-1.3, 3.0, 0.1],
    tail: [0, 1.6, -0.8],
  };
  body
    .ball(1.35, p.main, [0, 2.3, 0], [1.25, 1.05, 1.1])
    .ball(0.95, p.light, [0, 2.1, 0.7], [1.0, 1.0, 0.4]);
  body.ball(0.9, p.dark, [0, 1.35, 0], [1.2, 0.7, 1.0]);
  for (const sx of [0.7, -0.7]) {
    body.limb([sx, 1.5, 0], [sx * 1.1, 0.4, 0.1], 0.62, 0.55, p.dark);
    body.ball(0.6, p.dark, [sx * 1.1, 0.28, 0.35], [1, 0.55, 1.35]);
  }
  for (let i = 0; i < 3; i++)
    body.spike(
      [0, 3.3 - i * 0.35, -0.95 - i * 0.2],
      [0, 3.9 - i * 0.35, -1.2 - i * 0.2],
      0.22,
      accent,
    );
  // 一顆大眼睛、一支角、大嘴巴
  head.ball(1.05, p.main, [0, 4.0, 0.5], [1.1, 1.0, 1.0]);
  head
    .ball(0.58, '#ffffff', [0, 4.1, 1.28], [1, 1, 0.6])
    .ball(0.3, accent, [0, 4.1, 1.55])
    .ball(0.14, '#111111', [0, 4.1, 1.78]);
  head.spike([0, 4.9, 0.5], [0, 5.7, 0.7], 0.22, p.light);
  head.box([1.1, 0.14, 0.12], p.dark, [0, 3.55, 1.38]);
  for (const sx of [0.4, 0.14, -0.14, -0.4])
    head.spike([sx, 3.6, 1.43], [sx, 3.4, 1.43], 0.06, '#ffffff');
  for (const [arm, sx] of [
    [armL, 1],
    [armR, -1],
  ] as const) {
    arm.limb([sx * 1.3, 3.0, 0.1], [sx * 1.9, 2.0, 0.7], 0.42, 0.36, p.main);
    arm.limb([sx * 1.9, 2.0, 0.7], [sx * 1.95, 1.2, 1.3], 0.36, 0.32, p.main);
    arm.ball(0.46, p.dark, [sx * 1.95, 1.1, 1.4]);
  }
  tail.limb([0, 1.6, -0.8], [0, 1.2, -2.2], 0.45, 0.24, p.main).ball(0.3, accent, [0, 1.2, -2.4]);
}
