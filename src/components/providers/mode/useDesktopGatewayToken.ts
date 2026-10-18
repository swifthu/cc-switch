import { useQuery } from "@tanstack/react-query";
import { providersApi } from "@/lib/api/providers";

/**
 * Claude Desktop 处于路由模式且 gateway token 已生成（后端 `get_claude_desktop_status` 的
 * `mode === "proxy" && gatewayTokenConfigured`）。满足时才给「显示 Token」按钮。
 */
export function useDesktopGatewayTokenAvailable(enabled: boolean): boolean {
  const { data: status } = useQuery({
    queryKey: ["claudeDesktopStatus"],
    queryFn: () => providersApi.getClaudeDesktopStatus(),
    refetchInterval: 5000,
    enabled,
  });

  return status?.mode === "proxy" && status.gatewayTokenConfigured;
}
