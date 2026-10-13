import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Copy,
  ExternalLink,
  FileText,
  Play,
  RefreshCw,
  Save,
  Square,
  Trash2,
  Zap,
} from "lucide-react";
import {
  officeGatewayApi,
  type OfficeGatewayConfig,
  type OfficeGatewayLogEntry,
  type OfficeGatewayProviderKind,
  type OfficeGatewayStatus,
  type OfficeGatewayUpstreamTestResult,
} from "@/lib/api/officeGateway";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";
import { extractErrorMessage } from "@/utils/errorUtils";

const PROVIDER_VALUES: OfficeGatewayProviderKind[] = [
  "auto",
  "deep_seek",
  "kimi",
  "mimo",
  "mini_max",
];

export function OfficeGatewayPage() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<OfficeGatewayConfig | null>(null);
  const [status, setStatus] = useState<OfficeGatewayStatus | null>(null);
  const [logs, setLogs] = useState<OfficeGatewayLogEntry[]>([]);
  const [logFile, setLogFile] = useState("");
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] =
    useState<OfficeGatewayUpstreamTestResult | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const baseUrl = status?.baseUrl ?? "http://127.0.0.1:8790";
  const activeProvider =
    status?.activeProvider ?? config?.activeProvider ?? "auto";
  const isRunning = Boolean(status?.running);

  const providerLabel = (kind: OfficeGatewayProviderKind) => {
    const map: Record<OfficeGatewayProviderKind, string> = {
      auto: t("office.provider.auto", { defaultValue: "Auto" }),
      deep_seek: t("office.provider.deepseek", { defaultValue: "DeepSeek" }),
      kimi: t("office.provider.kimi", { defaultValue: "Kimi" }),
      mimo: t("office.provider.mimo", { defaultValue: "MiMo" }),
      mini_max: t("office.provider.minimax", { defaultValue: "MiniMax" }),
    };
    return map[kind];
  };
  const activeProviderLabel = providerLabel(activeProvider);

  const load = async () => {
    const [nextConfig, nextStatus, nextLogs] = await Promise.all([
      officeGatewayApi.getConfig(),
      officeGatewayApi.getStatus(),
      officeGatewayApi.getLogs(),
    ]);
    setConfig(nextConfig);
    setStatus(nextStatus);
    setLogs(nextLogs.entries);
    setLogFile(nextLogs.logFile);
  };

  useEffect(() => {
    void load().catch((error) => {
      toast.error(
        t("office.toast.loadFailed", {
          error: extractErrorMessage(error),
          defaultValue: `加载 Office Gateway 失败：${extractErrorMessage(error)}`,
        }),
      );
    });
    const timer = window.setInterval(() => {
      Promise.all([officeGatewayApi.getStatus(), officeGatewayApi.getLogs()])
        .then(([nextStatus, nextLogs]) => {
          setStatus(nextStatus);
          setLogs(nextLogs.entries);
          setLogFile(nextLogs.logFile);
        })
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [t]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [logs.length]);

  const updateConfig = <K extends keyof OfficeGatewayConfig>(
    key: K,
    value: OfficeGatewayConfig[K],
  ) => {
    setConfig((current) => (current ? { ...current, [key]: value } : current));
  };

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    try {
      setBusy(true);
      await action();
      await load();
      toast.success(success);
    } catch (error) {
      toast.error(extractErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = async () => {
    if (!config) return;
    await runAction(
      () => officeGatewayApi.saveConfig(config),
      t("office.toast.saved", { defaultValue: "Office Gateway 配置已保存" }),
    );
  };

  const testUpstream = async () => {
    if (!config) return;
    try {
      setBusy(true);
      setTestResult(null);
      await officeGatewayApi.saveConfig(config);
      const result = await officeGatewayApi.testUpstream();
      setTestResult(result);
      await load();
      if (result.ok) {
        toast.success(
          t("office.toast.testOk", {
            status: result.status,
            defaultValue: `上游测试通过：HTTP ${result.status}`,
          }),
        );
      } else {
        toast.error(
          t("office.toast.testFailed", {
            status: result.status,
            defaultValue: `上游测试失败：HTTP ${result.status}`,
          }),
        );
      }
    } catch (error) {
      toast.error(extractErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (config) {
      await officeGatewayApi.saveConfig(config);
    }
    await runAction(
      () => officeGatewayApi.start(),
      t("office.toast.started", { defaultValue: "Office Gateway 已启动" }),
    );
  };

  const copyBaseUrl = async () => {
    try {
      await copyText(baseUrl);
      toast.success(
        t("office.toast.copiedBaseUrl", { defaultValue: "已复制 Office Base URL" }),
      );
    } catch (error) {
      toast.error(extractErrorMessage(error));
    }
  };

  const copyLogs = async () => {
    try {
      await copyText(
        logs
          .map(
            (entry) =>
              `${entry.ts} [${entry.level}] ${entry.category} ${entry.message}`,
          )
          .join("\n"),
      );
      toast.success(t("office.toast.copiedLogs", { defaultValue: "已复制日志" }));
    } catch (error) {
      toast.error(extractErrorMessage(error));
    }
  };

  const providerHelp = useMemo(() => {
    if (activeProvider === "auto") {
      return t("office.providerHelp.auto", {
        defaultValue:
          "Auto 会按请求里的 key 前缀分流：dk-* → DeepSeek，sk-kimi-* → Kimi，sk-api-* / sk-cp-* → MiniMax，tp-* / sk-mimo-* / 普通 sk-* → MiMo。",
      });
    }
    return t("office.providerHelp.fixed", {
      defaultValue:
        "固定 Provider 模式会优先使用本页保存的 API Key；留空时从 Office 请求头读取。",
    });
  }, [activeProvider, t]);

  if (!config) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {t("office.loading", { defaultValue: "正在加载 Office Gateway…" })}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-muted/20 px-6 py-5">
      <div className="mx-auto max-w-[1860px] space-y-5 pb-12">
        <Card className="rounded-2xl border-border/70 bg-background shadow-sm">
          <CardHeader className="pb-2 text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl border bg-muted/40 shadow-sm">
              <Zap className="h-8 w-8 text-blue-500" />
            </div>
            <CardTitle className="text-2xl">
              {t("office.title", { defaultValue: "Office Claude Gateway" })}
            </CardTitle>
            <CardDescription>
              {t("office.subtitle", {
                defaultValue:
                  "给 Office / Excel Claude 加载项使用的 Anthropic Messages API 兼容网关。",
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 p-7 pt-4">
            <section className="grid gap-4 xl:grid-cols-2">
              <Field
                label={t("office.fields.activeProvider", {
                  defaultValue: "Active Provider",
                })}
              >
                <select
                  className="h-11 w-full rounded-lg border border-border-default bg-background px-3 text-sm shadow-sm outline-none transition-colors focus:border-primary"
                  value={config.activeProvider}
                  onChange={(event) =>
                    updateConfig(
                      "activeProvider",
                      event.target.value as OfficeGatewayProviderKind,
                    )
                  }
                >
                  {PROVIDER_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {providerLabel(value)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={t("office.fields.baseUrl", {
                  defaultValue: "Office Base URL",
                })}
              >
                <div className="flex gap-2">
                  <Input readOnly value={baseUrl} className="h-11 font-mono" />
                  <Button
                    variant="outline"
                    className="h-11"
                    onClick={copyBaseUrl}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    {t("office.button.copy", { defaultValue: "复制" })}
                  </Button>
                </div>
              </Field>
              <Field
                label={t("office.fields.defaultMaxTokens", {
                  defaultValue: "默认 max_tokens",
                })}
              >
                <Input
                  className="h-11"
                  type="number"
                  value={config.defaultMaxTokens}
                  onChange={(event) =>
                    updateConfig(
                      "defaultMaxTokens",
                      Number(event.target.value) || 4096,
                    )
                  }
                />
              </Field>
              <Field
                label={t("office.fields.probeMinTokens", {
                  defaultValue: "探测最小 tokens",
                })}
              >
                <Input
                  className="h-11"
                  type="number"
                  value={config.minCompatMaxTokens}
                  onChange={(event) =>
                    updateConfig(
                      "minCompatMaxTokens",
                      Number(event.target.value) || 16,
                    )
                  }
                />
              </Field>
              <Field
                label={t("office.fields.listenPort", {
                  defaultValue: "监听端口",
                })}
              >
                <Input
                  className="h-11"
                  type="number"
                  min={1}
                  max={65535}
                  value={config.listenPort}
                  onChange={(event) =>
                    updateConfig(
                      "listenPort",
                      Number(event.target.value) || 8790,
                    )
                  }
                />
              </Field>
              <div className="flex flex-col justify-end gap-2">
                <Label>
                  {t("office.fields.currentStatus", {
                    defaultValue: "当前状态",
                  })}
                </Label>
                <div className="flex h-11 flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3">
                  <Badge
                    variant={isRunning ? "default" : "secondary"}
                    className={cn(
                      isRunning && "bg-emerald-500 hover:bg-emerald-500",
                    )}
                  >
                    {isRunning
                      ? t("office.status.running", { defaultValue: "运行中" })
                      : t("office.status.stopped", { defaultValue: "已停止" })}
                  </Badge>
                  <Badge variant="outline">{activeProviderLabel}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {isRunning
                      ? t("office.status.connectable", {
                          defaultValue: "Office 可连接",
                        })
                      : t("office.status.waiting", {
                          defaultValue: "启动后 Office 才能连接",
                        })}
                  </span>
                </div>
              </div>
            </section>

            <div className="flex flex-wrap gap-2 border-t pt-5">
              <Button onClick={start} disabled={busy || isRunning}>
                <Play className="mr-2 h-4 w-4" />
                {t("office.button.start", { defaultValue: "启动" })}
              </Button>
              <Button
                variant="outline"
                disabled={busy || !isRunning}
                onClick={() =>
                  runAction(
                    () => officeGatewayApi.stop(),
                    t("office.toast.stopped", {
                      defaultValue: "Office Gateway 已停止",
                    }),
                  )
                }
              >
                <Square className="mr-2 h-4 w-4" />
                {t("office.button.stop", { defaultValue: "停止" })}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  runAction(
                    () =>
                      config
                        ? officeGatewayApi
                            .saveConfig(config)
                            .then(() => officeGatewayApi.restart())
                        : officeGatewayApi.restart(),
                    t("office.toast.restarted", {
                      defaultValue: "Office Gateway 已重启",
                    }),
                  )
                }
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("office.button.restart", { defaultValue: "重启" })}
              </Button>
              <Button variant="outline" disabled={busy} onClick={saveConfig}>
                <Save className="mr-2 h-4 w-4" />
                {t("office.button.save", { defaultValue: "保存配置" })}
              </Button>
              <Button variant="outline" disabled={busy} onClick={testUpstream}>
                <Zap className="mr-2 h-4 w-4" />
                {t("office.button.test", { defaultValue: "测试上游" })}
              </Button>
            </div>

            {testResult && (
              <div
                className={cn(
                  "rounded-xl border p-3 text-sm",
                  testResult.ok
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                    : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
                )}
              >
                <div className="font-medium">
                  {testResult.message} · {providerLabel(testResult.provider)} ·{" "}
                  {testResult.routeKind} · model={testResult.model}
                </div>
                <div className="mt-1 break-all font-mono text-xs opacity-80">
                  {testResult.upstreamUrl}
                </div>
                {testResult.bodyPreview && (
                  <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-black/80 p-2 font-mono text-xs text-white">
                    {testResult.bodyPreview}
                  </pre>
                )}
              </div>
            )}

            <section className="space-y-3 border-t pt-5">
              <div>
                <h2 className="text-lg font-semibold">
                  {t("office.section.providerConfig", {
                    defaultValue: "Provider 配置",
                  })}
                </h2>
                <p className="text-sm text-muted-foreground">{providerHelp}</p>
              </div>
              <div
                className={cn(
                  "grid gap-4",
                  config.activeProvider === "auto" && "2xl:grid-cols-2",
                )}
              >
                {(config.activeProvider === "auto" ||
                  config.activeProvider === "deep_seek") && (
                  <ProviderSection
                    title={t("office.provider.deepseek", {
                      defaultValue: "DeepSeek",
                    })}
                    apiKey={config.deepseekApiKey}
                    onApiKey={(value) => updateConfig("deepseekApiKey", value)}
                    baseUrl={config.deepseekBaseUrl}
                    onBaseUrl={(value) =>
                      updateConfig("deepseekBaseUrl", value)
                    }
                    models={[
                      [
                        t("office.provider.modelPrimary", {
                          defaultValue: "Primary",
                        }),
                        config.deepseekModelPrimary,
                        "deepseekModelPrimary",
                      ],
                      [
                        t("office.provider.modelMid", { defaultValue: "Mid" }),
                        config.deepseekModelMid,
                        "deepseekModelMid",
                      ],
                      [
                        t("office.provider.modelFast", { defaultValue: "Fast" }),
                        config.deepseekModelFast,
                        "deepseekModelFast",
                      ],
                    ]}
                    updateConfig={updateConfig}
                  />
                )}
                {(config.activeProvider === "auto" ||
                  config.activeProvider === "kimi") && (
                  <ProviderSection
                    title={t("office.provider.kimi", { defaultValue: "Kimi" })}
                    apiKey={config.kimiApiKey}
                    onApiKey={(value) => updateConfig("kimiApiKey", value)}
                    baseUrl={config.kimiPaygBaseUrl}
                    onBaseUrl={(value) =>
                      updateConfig("kimiPaygBaseUrl", value)
                    }
                    secondaryBaseLabel={t("office.kimi.codingBaseUrl", {
                      defaultValue: "Coding Base URL",
                    })}
                    secondaryBaseUrl={config.kimiCodingBaseUrl}
                    onSecondaryBaseUrl={(value) =>
                      updateConfig("kimiCodingBaseUrl", value)
                    }
                    models={[
                      [
                        t("office.provider.modelPrimary", {
                          defaultValue: "Primary",
                        }),
                        config.kimiModelPrimary,
                        "kimiModelPrimary",
                      ],
                      [
                        t("office.provider.modelMid", { defaultValue: "Mid" }),
                        config.kimiModelMid,
                        "kimiModelMid",
                      ],
                      [
                        t("office.provider.modelCoding", {
                          defaultValue: "Coding",
                        }),
                        config.kimiCodingModel,
                        "kimiCodingModel",
                      ],
                    ]}
                    updateConfig={updateConfig}
                  />
                )}
                {(config.activeProvider === "auto" ||
                  config.activeProvider === "mimo") && (
                  <div className="space-y-4">
                    <ProviderSection
                      title={t("office.provider.mimo", { defaultValue: "MiMo" })}
                      apiKey={config.mimoApiKey}
                      onApiKey={(value) => updateConfig("mimoApiKey", value)}
                      baseUrl={config.mimoPaygBaseUrl}
                      onBaseUrl={(value) =>
                        updateConfig("mimoPaygBaseUrl", value)
                      }
                      models={[
                        [
                          t("office.provider.modelPrimary", {
                            defaultValue: "Primary",
                          }),
                          config.mimoModelPrimary,
                          "mimoModelPrimary",
                        ],
                        [
                          t("office.provider.modelMid", { defaultValue: "Mid" }),
                          config.mimoModelMid,
                          "mimoModelMid",
                        ],
                      ]}
                      updateConfig={updateConfig}
                    />
                    <div className="space-y-3 rounded-xl border bg-background p-4 shadow-sm">
                      <div>
                        <div className="font-medium">
                          {t("office.mimo.tpTitle", {
                            defaultValue: "MiMo Token Plan 区域",
                          })}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t("office.mimo.tpDescription", {
                            defaultValue:
                              "请求头 x-mimo-tp-region 可选 cn / sgp / ams。",
                          })}
                        </div>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field
                          label={t("office.mimo.cnBaseUrl", {
                            defaultValue: "CN Base URL",
                          })}
                        >
                          <Input
                            value={config.mimoTpBaseUrlCn}
                            onChange={(event) =>
                              updateConfig(
                                "mimoTpBaseUrlCn",
                                event.target.value,
                              )
                            }
                          />
                        </Field>
                        <Field
                          label={t("office.mimo.sgpBaseUrl", {
                            defaultValue: "SGP Base URL",
                          })}
                        >
                          <Input
                            value={config.mimoTpBaseUrlSgp}
                            onChange={(event) =>
                              updateConfig(
                                "mimoTpBaseUrlSgp",
                                event.target.value,
                              )
                            }
                          />
                        </Field>
                        <Field
                          label={t("office.mimo.amsBaseUrl", {
                            defaultValue: "AMS Base URL",
                          })}
                        >
                          <Input
                            value={config.mimoTpBaseUrlAms}
                            onChange={(event) =>
                              updateConfig(
                                "mimoTpBaseUrlAms",
                                event.target.value,
                              )
                            }
                          />
                        </Field>
                      </div>
                    </div>
                  </div>
                )}
                {(config.activeProvider === "auto" ||
                  config.activeProvider === "mini_max") && (
                  <ProviderSection
                    title={t("office.provider.minimax", {
                      defaultValue: "MiniMax",
                    })}
                    apiKey={config.minimaxApiKey}
                    onApiKey={(value) => updateConfig("minimaxApiKey", value)}
                    baseUrl={config.minimaxBaseUrlCn}
                    onBaseUrl={(value) =>
                      updateConfig("minimaxBaseUrlCn", value)
                    }
                    secondaryBaseLabel={t("office.minimax.globalBaseUrl", {
                      defaultValue: "Global Base URL",
                    })}
                    secondaryBaseUrl={config.minimaxBaseUrlGlobal}
                    onSecondaryBaseUrl={(value) =>
                      updateConfig("minimaxBaseUrlGlobal", value)
                    }
                    models={[
                      [
                        t("office.provider.modelPrimary", {
                          defaultValue: "Primary",
                        }),
                        config.minimaxModelPrimary,
                        "minimaxModelPrimary",
                      ],
                      [
                        t("office.provider.modelMid", { defaultValue: "Mid" }),
                        config.minimaxModelMid,
                        "minimaxModelMid",
                      ],
                      [
                        t("office.provider.modelFast", { defaultValue: "Fast" }),
                        config.minimaxModelFast,
                        "minimaxModelFast",
                      ],
                    ]}
                    updateConfig={updateConfig}
                  />
                )}
              </div>
            </section>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70 bg-background shadow-sm">
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="text-xl">
                  {t("office.logs.title", { defaultValue: "实时日志" })}
                </CardTitle>
                <CardDescription className="break-all font-mono text-xs">
                  {logFile ||
                    t("office.logs.notCreated", {
                      defaultValue: "日志文件尚未创建",
                    })}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={copyLogs}>
                  <FileText className="mr-2 h-4 w-4" />
                  {t("office.button.copy", { defaultValue: "复制" })}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    runAction(
                      () => officeGatewayApi.clearLogs(),
                      t("office.toast.logsCleared", {
                        defaultValue: "日志已清空",
                      }),
                    )
                  }
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("office.logs.clear", { defaultValue: "清空" })}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    runAction(
                      () => officeGatewayApi.openLogFile(),
                      t("office.toast.logFileOpened", {
                        defaultValue: "已打开日志文件",
                      }),
                    )
                  }
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {t("office.logs.open", { defaultValue: "打开" })}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[520px] overflow-auto rounded-xl border bg-black p-4 font-mono text-xs leading-relaxed text-green-100 shadow-inner">
              {logs.length === 0 ? (
                <div className="text-green-100/60">
                  {t("office.logs.empty", {
                    defaultValue:
                      "暂无日志。启动网关或发送 Office 请求后会自动刷新。",
                  })}
                </div>
              ) : (
                logs.map((entry, index) => (
                  <div
                    key={`${entry.ts}-${index}`}
                    className="whitespace-pre-wrap"
                  >
                    <span className="text-green-400">{entry.ts}</span>{" "}
                    <span
                      className={cn(
                        "uppercase",
                        entry.level === "error" && "text-red-300",
                        entry.level === "warn" && "text-yellow-300",
                      )}
                    >
                      [{entry.level}]
                    </span>{" "}
                    <span className="text-blue-200">{entry.category}</span>{" "}
                    <span>{entry.message}</span>
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ProviderSection({
  title,
  apiKey,
  onApiKey,
  baseUrl,
  onBaseUrl,
  secondaryBaseLabel,
  secondaryBaseUrl,
  onSecondaryBaseUrl,
  models,
  updateConfig,
}: {
  title: string;
  apiKey: string;
  onApiKey: (value: string) => void;
  baseUrl: string;
  onBaseUrl: (value: string) => void;
  secondaryBaseLabel?: string;
  secondaryBaseUrl?: string;
  onSecondaryBaseUrl?: (value: string) => void;
  models: Array<[string, string, keyof OfficeGatewayConfig]>;
  updateConfig: <K extends keyof OfficeGatewayConfig>(
    key: K,
    value: OfficeGatewayConfig[K],
  ) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 rounded-xl border bg-background p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">
            {t("office.provider.baseUrlHelp", {
              defaultValue:
                "Base URL 填兼容 Claude API 的服务端点，不要以斜杠结尾。",
            })}
          </div>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label={t("office.provider.apiKey", {
            defaultValue: "API Key（留空则读取请求头）",
          })}
        >
          <Input
            type="password"
            value={apiKey}
            onChange={(event) => onApiKey(event.target.value)}
            placeholder={t("office.provider.apiKeyPlaceholder", {
              defaultValue: "sk- / tp- / dk-*",
            })}
          />
        </Field>
        <Field
          label={t("office.provider.baseUrl", { defaultValue: "Base URL" })}
        >
          <Input
            value={baseUrl}
            onChange={(event) => onBaseUrl(event.target.value)}
          />
        </Field>
        {secondaryBaseLabel && onSecondaryBaseUrl && (
          <Field label={secondaryBaseLabel}>
            <Input
              value={secondaryBaseUrl ?? ""}
              onChange={(event) => onSecondaryBaseUrl(event.target.value)}
            />
          </Field>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {models.map(([label, value, key]) => (
          <Field
            key={String(key)}
            label={t("office.provider.modelMapping", {
              label,
              defaultValue: `模型映射 · ${label}`,
            })}
          >
            <Input
              value={value}
              onChange={(event) =>
                updateConfig(
                  key,
                  event.target.value as OfficeGatewayConfig[typeof key],
                )
              }
              placeholder={label}
              title={label}
              className="font-mono"
            />
          </Field>
        ))}
      </div>
    </div>
  );
}
