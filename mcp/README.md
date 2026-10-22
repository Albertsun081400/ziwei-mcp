# ziwei-mcp — 紫微斗数 MCP Server

把本仓库排盘引擎（lib/ziwei：iztro + 全书亮度校订 + 真太阳时 + 子时换日 + 闰月流派）暴露为 MCP tools，供 Claude / WorkBuddy / 任何 MCP client 调用。

## Tools

| tool | 输入 | 输出 |
|------|------|------|
| `ziwei_chart` | birth(公历 YYYY-MM-DD HH:MM)、gender、longitude? | 十二宫星曜（亮度/四化）、五行局、命宫身宫、命主身主、四柱 |
| `ziwei_daxian` | 同上 | 每个十年大限：年龄区间、落宫、宫干四化 |
| `ziwei_patterns` | 同上 | 格局检测 + 命宫摘要 |

时间处理内置于 server：钟点 → 真太阳时（需 longitude）→ 时辰索引 → 子时换日，与 web 端完全同口径。

## 运行

```bash
# stdio（本机 client 接入）
node node_modules/tsx/dist/cli.mjs mcp/server.ts

# HTTP（远程，腾讯云部署用）
node node_modules/tsx/dist/cli.mjs mcp/server.ts --http 8766
# endpoint: http://0.0.0.0:8766/mcp (Streamable HTTP)，外层套 Caddy 上 HTTPS
```

## 客户端注册

```json
{
  "mcpServers": {
    "ziwei": {
      "command": "node",
      "args": ["node_modules/tsx/dist/cli.mjs", "mcp/server.ts"],
      "cwd": "/path/to/ziwei-doushu-repo"
    }
  }
}
```

远程模式：
```json
{ "mcpServers": { "ziwei": { "url": "https://your-domain/mcp" } } }
```

## 验证

```bash
# 引擎冒烟
node node_modules/tsx/dist/cli.mjs mcp/smoke.ts
# MCP 端到端（在 mcp-kit 工作区）
python mcp-kit/test_ziwei_mcp.py
# 期望: initialize OK / list_tools=[ziwei_chart, ziwei_daxian, ziwei_patterns] / ALL PASS
```

## 依赖备注

node_modules 为不完整树（沙箱限制 .bin 符号链接），运行用
`node node_modules/tsx/dist/cli.mjs` 而非 `npx tsx`；`server-only` 为手写 stub（Next 守卫包，node 环境空实现）。

## 收费钩子（预留）

HTTP 模式下在 `http.createServer` 回调处加 header 校验（license key → licenses 表），无效直接 401。stdio 模式不适合收费（跑在客户本机）。
