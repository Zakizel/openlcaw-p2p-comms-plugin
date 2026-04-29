import type { Command } from "commander";
import {
  runP2pStatus,
  runP2pList,
  runP2pStats,
  runP2pSend,
  runP2pQueue,
  runP2pTrace,
  runP2pClear,
  runP2pExport,
  runP2pTest,
} from "./cli-runtime.js";

export function registerP2pCli(program: Command) {
  const p2p = program
    .command("p2p")
    .description("P2P Agent Communications 管理命令")
    .addHelpText(
      "after",
      `
Examples:
  openclaw p2p status          查看消息总线状态
  openclaw p2p list            列出所有 Agent 和会话
  openclaw p2p stats           查看消息统计
  openclaw p2p send <agent> <msg>  发送测试消息
  openclaw p2p queue <agent>    查看队列内容
  openclaw p2p trace <chainId> 追踪消息链路
  openclaw p2p clear            清空所有队列
  openclaw p2p export          导出会话状态
  openclaw p2p test            运行测试场景
`,
    );

  p2p
    .command("status", { isDefault: true })
    .description("查看 P2P 消息总线状态")
    .option("-v, --verbose", "显示详细信息")
    .action(async (opts) => {
      await runP2pStatus({ verbose: opts.verbose });
    });

  p2p
    .command("list")
    .description("列出所有已注册的 Agent 和活跃会话")
    .option("-v, --verbose", "显示详细信息")
    .action(async (opts) => {
      await runP2pList({ verbose: opts.verbose });
    });

  p2p
    .command("stats")
    .description("查看消息统计（发送数、失败数等）")
    .option("--since <timestamp>", "显示指定时间之后的统计")
    .action(async (opts) => {
      await runP2pStats({ since: opts.since });
    });

  p2p
    .command("send <agent> <message>")
    .description("向指定 Agent 发送测试消息")
    .option("-t, --type <type>", "消息类型", "command")
    .option("-c, --chain-id <chainId>", "链路 ID")
    .option("-C, --conversation-id <conversationId>", "会话 ID")
    .action(async (agent, message, opts) => {
      await runP2pSend(
        agent,
        message,
        {
          type: opts.type,
          chainId: opts.chainId,
          conversationId: opts.conversationId,
        },
      );
    });

  p2p
    .command("queue [agent]")
    .description("查看 Agent 的消息队列内容")
    .option("-v, --verbose", "显示详细信息")
    .action(async (agent, opts) => {
      await runP2pQueue(agent, { verbose: opts.verbose });
    });

  p2p
    .command("trace <chainId>")
    .description("追踪消息链路的完整路径")
    .option("-v, --verbose", "显示详细信息")
    .action(async (chainId, opts) => {
      await runP2pTrace(chainId, { verbose: opts.verbose });
    });

  p2p
    .command("clear")
    .description("清空所有消息队列（慎用）")
    .option("-f, --force", "跳过确认提示")
    .action(async (opts) => {
      await runP2pClear({ force: opts.force });
    });

  p2p
    .command("export [path]")
    .description("导出会话状态到文件")
    .option("-o, --output <path>", "输出文件路径")
    .action(async (path, opts) => {
      await runP2pExport({ output: opts.output || path });
    });

  p2p
    .command("test")
    .description("运行内置测试场景")
    .option("-s, --scenario <name>", "指定测试场景")
    .action(async (opts) => {
      await runP2pTest({ scenario: opts.scenario });
    });
}
