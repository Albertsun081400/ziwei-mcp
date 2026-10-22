/**
 * 紫微斗数 MCP Server — 把本仓库排盘引擎（lib/ziwei）暴露为 MCP tools。
 *
 * 运行 (stdio):    npx tsx mcp/server.ts
 * 运行 (HTTP):     npx tsx mcp/server.ts --http 8766
 * 端到端验证:      python mcp-kit 风格客户端，或任何 MCP client
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { generateChart } from "../lib/ziwei/algorithm";
import { detectPatterns, getMingGongSummary } from "../lib/ziwei/patterns";
import { calculateTrueSolarTime, shiftGregorianDate } from "../lib/ziwei/true-solar-time";

const LICENSES_FILE = process.env.ZIWEI_LICENSES_FILE
  ?? path.join(process.cwd(), "licenses.json");

interface LicenseEntry {
  key: string;
  note: string;
  expires: string;        // YYYY-MM-DD
  disabled?: boolean;
}

function loadLicenses(): LicenseEntry[] {
  try {
    return JSON.parse(fs.readFileSync(LICENSES_FILE, "utf8")).keys ?? [];
  } catch {
    return [];
  }
}

/** HTTP 层鉴权: Authorization: Bearer <key> 或 ?key=。ZIWEI_NO_AUTH=1 时放行（本地调试）。 */
function checkAuth(req: http.IncomingMessage): boolean {
  if (process.env.ZIWEI_NO_AUTH === "1") return true;
  let key = "";
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) key = h.slice(7).trim();
  if (!key) {
    try {
      key = new URL(req.url ?? "/", "http://localhost").searchParams.get("key") ?? "";
    } catch { /* ignore */ }
  }
  if (!key) return false;
  const today = new Date().toISOString().slice(0, 10);
  return loadLicenses().some(
    (l) => l.key === key && !l.disabled && (!l.expires || l.expires >= today),
  );
}

/** 每次构建全新 server 实例（无状态模式需要；stdio 也用同一工厂） */
function makeServer() {
  const s = new McpServer({ name: "ziwei-mcp", version: "0.1.0" });
  registerTools(s);
  return s;
}

/** "YYYY-MM-DD HH:MM" → 数字元组 */
function parseBirth(birth: string) {
  const m = birth.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`birth 格式应为 "YYYY-MM-DD HH:MM"（24小时制公历），收到: ${birth}`);
  return {
    year: +m[1], month: +m[2], day: +m[3],
    clockHour: +m[4], clockMinute: +m[5],
  };
}

/** 钟点时间 → 排盘入参（真太阳时校正 + 子时换日 + 时辰索引） */
function toBirthInfo(birth: string, gender: "male" | "female", longitude?: number) {
  const t = parseBirth(birth);
  const ts = calculateTrueSolarTime({ ...t, longitude });
  const d = shiftGregorianDate(t, ts.dayOffset);
  return {
    birthInfo: {
      year: d.year, month: d.month, day: d.day,
      hour: ts.branch,
      gender,
      longitude,
      origInput: t,
    },
    trueSolar: {
      校正后时间: `${ts.hour}:${String(ts.minute).padStart(2, "0")}`,
      时辰索引: ts.branch,
      子时换日偏移: ts.dayOffset,
      总修正分钟: ts.totalCorrectionMinutes,
    },
  };
}

const BirthSchema = {
  birth: z.string().describe('公历出生时间，格式 "YYYY-MM-DD HH:MM"'),
  gender: z.enum(["male", "female"]).describe("性别 male/female（影响大限顺逆）"),
  longitude: z.number().optional().describe("出生地经度，提供时做真太阳时校正（如上海 121.47）"),
};

/** 压缩 chart 输出：只保留排盘结论字段 */
function compactChart(chart: ReturnType<typeof generateChart>) {
  return {
    birthInfo: chart.birthInfo,
    lunarInfo: chart.lunarInfo,
    五行局: chart.wuxingJuName,
    命宫地支: chart.mingGongBranch,
    身宫地支: chart.shenGongBranch,
    命主: chart.mingZhu,
    身主: chart.shenZhu,
    阴阳性别: chart.yinYangGender,
    十二宫: chart.palaces.map((p) => ({
      宫: p.name,
      干支: p.stem >= 0 && p.branch >= 0 ? p.branch : undefined,
      主星: p.stars.filter((s) => s.type === "major").map((s) => ({
        星: s.name, 亮度: s.brightnessRaw, 四化: s.siHua,
      })),
      辅煞星: p.stars.filter((s) => s.type !== "major").map((s) => ({
        星: s.name, 四化: s.siHua,
      })),
      宫干自化: p.selfSihua,
      空宫: p.isEmpty || undefined,
      借星: p.borrowedStars,
      大限: p.daXianAge,
    })),
  };
}

// ── Tool 注册 ────────────────────────────────────────────────
function registerTools(s: McpServer) {
s.tool(
  "ziwei_chart",
  "紫微斗数排盘：输入公历出生时间和性别，返回十二宫星曜（含亮度/四化）、五行局、命宫身宫、命主身主、农历信息与四柱。用户提到紫微斗数、排盘、命盘、星曜时使用。",
  BirthSchema,
  async ({ birth, gender, longitude }) => {
    const { birthInfo, trueSolar } = toBirthInfo(birth, gender as "male" | "female", longitude);
    const chart = generateChart(birthInfo as never);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ 真太阳时: trueSolar, ...compactChart(chart) }, null, 1),
      }],
    };
  },
);

// ── Tool 2: 大限（十年运）───────────────────────────────────
s.tool(
  "ziwei_daxian",
  "紫微斗数大限排布：返回每个十年大限的起止年龄、落宫、宫干四化。分析运势、十年运、大限时使用。",
  BirthSchema,
  async ({ birth, gender, longitude }) => {
    const { birthInfo } = toBirthInfo(birth, gender as "male" | "female", longitude);
    const chart = generateChart(birthInfo as never);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(
          chart.daXians.map((d) => ({
            年龄: `${d.startAge}-${d.endAge}`,
            宫: d.palaceName,
            宫干: d.stemName,
            四化: d.siHua ? `禄${d.siHua.lu} 权${d.siHua.quan} 科${d.siHua.ke} 忌${d.siHua.ji}` : undefined,
          })),
          null, 1,
        ),
      }],
    };
  },
);

// ── Tool 3: 格局 + 命宫摘要 ─────────────────────────────────
s.tool(
  "ziwei_patterns",
  "紫微斗数格局检测与命宫摘要：检测命盘成立的格局（如君臣庆会、火贪格等）并给出命宫简评。解读命盘、论格局时使用。",
  BirthSchema,
  async ({ birth, gender, longitude }) => {
    const { birthInfo } = toBirthInfo(birth, gender as "male" | "female", longitude);
    const chart = generateChart(birthInfo as never);
    const patterns = detectPatterns(chart);
    const summary = getMingGongSummary(chart);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          命宫摘要: summary,
          格局: patterns.map((p) => ({ 名称: p.name, 成立: p.conditionsMet ?? undefined, 说明: p.description ?? undefined })),
        }, null, 1),
      }],
    };
  },
);

}

// ── 启动 ─────────────────────────────────────────────────────
async function main() {
  if (process.argv.includes("--http")) {
    const port = +process.argv[process.argv.indexOf("--http") + 1] || 8766;
    // 无状态模式: 每请求独立 server + transport, 支持多客户端并发
    http
      .createServer(async (req, res) => {
        if (!req.url?.startsWith("/mcp")) {
          res.writeHead(404).end();
          return;
        }
        if (!checkAuth(req)) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "unauthorized: missing/invalid license key" }));
          return;
        }
        try {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
          });
          res.on("close", () => {
            transport.close();
          });
          await makeServer().connect(transport);
          await transport.handleRequest(req, res);
        } catch (e) {
          console.error("request error:", e);
          if (!res.headersSent) {
            res.writeHead(500).end(JSON.stringify({ error: "internal error" }));
          }
        }
      })
      .listen(port, "0.0.0.0", () => console.log(`ziwei-mcp (stateless) listening on http://0.0.0.0:${port}/mcp`));
  } else {
    await makeServer().connect(new StdioServerTransport());
    console.error("ziwei-mcp running on stdio");
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
