/**
 * license key 管理 CLI。
 *
 * 用法:
 *   node node_modules/tsx/dist/cli.mjs mcp/license.ts add "客户备注" [过期日YYYY-MM-DD]
 *   node node_modules/tsx/dist/cli.mjs mcp/license.ts list
 *   node node_modules/tsx/dist/cli.mjs mcp/license.ts disable <key>
 *   node node_modules/tsx/dist/cli.mjs mcp/license.ts enable <key>
 *
 * licenses.json 路径: 环境变量 ZIWEI_LICENSES_FILE 或当前目录 licenses.json
 */
import fs from "node:fs";
import { randomBytes } from "node:crypto";

const FILE = process.env.ZIWEI_LICENSES_FILE ?? "licenses.json";
const DEFAULT_EXPIRES = "2027-12-31";

interface LicenseEntry {
  key: string;
  note: string;
  expires: string;
  disabled?: boolean;
  createdAt: string;
}

function load(): LicenseEntry[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")).keys ?? [];
  } catch {
    return [];
  }
}

function save(keys: LicenseEntry[]) {
  fs.writeFileSync(FILE, JSON.stringify({ keys }, null, 2) + "\n");
}

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "add": {
    const keys = load();
    const entry: LicenseEntry = {
      key: "zw_" + randomBytes(16).toString("hex"),
      note: args[0] ?? "",
      expires: args[1] ?? DEFAULT_EXPIRES,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    keys.push(entry);
    save(keys);
    console.log(`added: ${entry.key}\n  note: ${entry.note}  expires: ${entry.expires}`);
    break;
  }
  case "list": {
    const keys = load();
    if (!keys.length) {
      console.log("(no licenses)");
      break;
    }
    for (const k of keys) {
      console.log(
        `${k.disabled ? "✗" : "✓"} ${k.key}  expires=${k.expires}  note=${k.note}  created=${k.createdAt}`,
      );
    }
    break;
  }
  case "disable":
  case "enable": {
    const keys = load();
    const k = keys.find((x) => x.key === args[0]);
    if (!k) {
      console.error(`not found: ${args[0]}`);
      process.exit(1);
    }
    k.disabled = cmd === "disable" ? true : undefined;
    save(keys);
    console.log(`${cmd}d: ${k.key}`);
    break;
  }
  default:
    console.error("usage: license.ts add <note> [expires] | list | disable <key> | enable <key>");
    process.exit(1);
}
