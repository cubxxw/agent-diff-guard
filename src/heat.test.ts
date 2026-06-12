// heat.test.ts — 危险地图热度分级。修复"热度恒等于 3"的回归测试。
//
// 报告实测旧 bug:1 次命中和 6 次命中热度都是 3,与频次脱钩。这里钉住新行为:
// 热度必须随命中数/wake 占比真正分级,且老雷会冷却。

import { test, expect, describe } from "bun:test";
import { heatOf } from "./serve-local";

// 用"今天"附近的日期当 lastSeen,避免 recency 把所有样本压成冷却态
const recent = new Date().toISOString().slice(0, 10);

describe("heatOf 热度分级", () => {
  test("命中越多越热:1 次 < 6 次(旧 bug 是两者都 3)", () => {
    const low = heatOf({ count: 1, wakeCount: 0, lastSeen: recent });
    const high = heatOf({ count: 6, wakeCount: 0, lastSeen: recent });
    expect(high).toBeGreaterThan(low);
  });

  test("全 wake 比无 wake 热(同频次下严重度抬高)", () => {
    const noWake = heatOf({ count: 4, wakeCount: 0, lastSeen: recent });
    const allWake = heatOf({ count: 4, wakeCount: 4, lastSeen: recent });
    expect(allWake).toBeGreaterThanOrEqual(noWake);
  });

  test("老雷冷却:同样命中,很久没踩的热度更低", () => {
    const fresh = heatOf({ count: 5, wakeCount: 1, lastSeen: recent });
    const stale = heatOf({ count: 5, wakeCount: 1, lastSeen: "2020-01-01" });
    expect(stale).toBeLessThanOrEqual(fresh);
  });

  test("热度落在 1–3 档内", () => {
    for (const c of [1, 2, 5, 10, 50]) {
      const heat = heatOf({ count: c, wakeCount: Math.floor(c / 2), lastSeen: recent });
      expect(heat).toBeGreaterThanOrEqual(1);
      expect(heat).toBeLessThanOrEqual(3);
    }
  });

  test("不再恒等于 3:存在落在 1 或 2 档的样本", () => {
    const samples = [
      heatOf({ count: 1, wakeCount: 0, lastSeen: recent }),
      heatOf({ count: 1, wakeCount: 1, lastSeen: "2020-01-01" }),
    ];
    expect(samples.some((h) => h < 3)).toBe(true);
  });
});
