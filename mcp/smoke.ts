/** 冒烟测试: 直接调 generateChart, 验证依赖链可用 */
import { generateChart } from "../lib/ziwei/algorithm";
import { calculateTrueSolarTime, shiftGregorianDate } from "../lib/ziwei/true-solar-time";
import { detectPatterns } from "../lib/ziwei/patterns";

const t = { year: 2000, month: 8, day: 14, clockHour: 12, clockMinute: 0 };
const ts = calculateTrueSolarTime(t);
const d = shiftGregorianDate(t, ts.dayOffset);
const chart = generateChart({
  year: d.year, month: d.month, day: d.day, hour: ts.branch,
  gender: "male",
});
console.log("五行局:", chart.wuxingJuName, "| 命宫:", chart.mingGongBranch, "| 身宫:", chart.shenGongBranch);
console.log("命主/身主:", chart.mingZhu, chart.shenZhu);
console.log("四柱(节气):", chart.lunarInfo.fourPillars);
console.log("命宫主星:", chart.palaces.find((p) => p.isMingGong)?.stars.map((s) => s.name + (s.brightnessRaw ?? "")));
console.log("格局数:", detectPatterns(chart).length);
console.log("大限首3:", chart.daXians.slice(0, 3).map((d) => `${d.startAge}-${d.endAge} ${d.palaceName}`));
