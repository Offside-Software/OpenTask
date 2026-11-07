import React, { useState, useEffect } from 'react';
import { CloseButton } from '../../design-system/CloseButton';
import { Button } from '../../design-system/Button';
import { Badge } from '../../design-system/Badge';
import { Copy, Check, Key, Layers, Sparkles, Cpu } from 'lucide-react';
import { projectService } from '../../services/projectService';
import { getBaseUrl } from '../../services/apiClient';
import { useToast } from '../../design-system/Toast';
import { cn } from '@/lib/utils';

interface McpConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string | number;
  projectName?: string;
  initialApiKey?: string | null;
}

type IdeTab = 'antigravity' | 'vscode' | 'claude' | 'cursor' | 'zed' | 'curl';

export const McpConfigModal: React.FC<McpConfigModalProps> = ({
  isOpen,
  onClose,
  projectId,
  projectName = 'OpenTask Project',
  initialApiKey,
}) => {
  const [activeTab, setActiveTab] = useState<IdeTab>('antigravity');
  const [apiKey, setApiKey] = useState<string | null>(initialApiKey || null);
  const [loadingKey, setLoadingKey] = useState<boolean>(false);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    if (!isOpen) return;
    if (initialApiKey) {
      setApiKey(initialApiKey);
      return;
    }

    setLoadingKey(true);
    projectService.getProjectApiKey(projectId)
      .then(res => setApiKey(res.api_key || null))
      .catch(() => setApiKey(null))
      .finally(() => setLoadingKey(false));
  }, [isOpen, projectId, initialApiKey]);

  if (!isOpen) return null;

  const origin = getBaseUrl() || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000');
  const mcpHttpUrl = `${origin}/api/projects/${projectId}/mcp`;
  const mcpSseUrl = `${origin}/api/projects/${projectId}/mcp/sse`;
  const safeApiKey = apiKey || 'YOUR_PROJECT_API_KEY';

  const copyToClipboard = async (text: string, sectionName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSection(sectionName);
      showToast(`Copied ${sectionName} config to clipboard`, 'success');
      setTimeout(() => setCopiedSection(null), 2000);
    } catch {
      showToast('Failed to copy to clipboard', 'warning');
    }
  };

  const handleGenerateKey = async () => {
    setLoadingKey(true);
    try {
      const res = await projectService.generateProjectApiKey(projectId);
      setApiKey(res.api_key);
      showToast('Project API Key generated successfully', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Failed to generate API Key', 'error');
    } finally {
      setLoadingKey(false);
    }
  };

  const antigravityConfig = JSON.stringify(
    {
      mcpServers: {
        opentask: {
          serverUrl: mcpSseUrl,
          headers: {
            Authorization: `Bearer ${safeApiKey}`,
          },
        },
      },
    },
    null,
    2
  );

  const vscodeClineConfig = JSON.stringify(
    {
      mcpServers: {
        opentask: {
          url: mcpSseUrl,
          headers: {
            Authorization: `Bearer ${safeApiKey}`,
          },
        },
      },
    },
    null,
    2
  );

  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        opentask: {
          url: mcpSseUrl,
          headers: {
            Authorization: `Bearer ${safeApiKey}`,
          },
        },
      },
    },
    null,
    2
  );

  const cursorConfig = JSON.stringify(
    {
      mcpServers: {
        opentask: {
          url: mcpSseUrl,
          headers: {
            Authorization: `Bearer ${safeApiKey}`,
          },
        },
      },
    },
    null,
    2
  );

  const zedConfig = JSON.stringify(
    {
      context_servers: {
        opentask: {
          endpoint: mcpSseUrl,
          headers: {
            Authorization: `Bearer ${safeApiKey}`,
          },
        },
      },
    },
    null,
    2
  );

  const curlExample = `curl -X POST "${mcpHttpUrl}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${safeApiKey}" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_tasks","arguments":{}}}'`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150">
      <div className="relative w-full max-w-4xl bg-card text-card-foreground border border-border rounded-xl shadow-2xl my-8 overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Cpu size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">
                  AI Model Context Protocol (MCP)
                </h2>
                <Badge variant="primary" className="text-[10px]">
                  #{String(projectId).slice(-6)}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Connect {projectName} tasks directly to your AI IDE (Antigravity, Cursor, VS Code, Claude, Zed)
              </p>
            </div>
          </div>
          <CloseButton onClick={onClose} size="md" />
        </div>

        {/* API Key Status Banner */}
        <div className="px-5 py-3 border-b border-border bg-muted/20 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Key size={14} className={apiKey ? 'text-emerald-500' : 'text-amber-500'} />
            <span className="text-xs font-medium text-muted-foreground">
              Project AI Secret Key:
            </span>
            {apiKey ? (
              <code className="font-mono text-xs text-foreground bg-muted px-2 py-0.5 rounded-md border border-border">
                {apiKey.slice(0, 10)}...{apiKey.slice(-6)}
              </code>
            ) : (
              <span className="text-xs text-destructive font-medium">
                Not generated yet
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {apiKey ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(apiKey, 'API Key')}
              >
                {copiedSection === 'API Key' ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                <span>{copiedSection === 'API Key' ? 'Copied' : 'Copy Key'}</span>
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleGenerateKey}
                disabled={loadingKey}
              >
                <Sparkles size={12} />
                <span>{loadingKey ? 'Generating…' : 'Generate Key'}</span>
              </Button>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Endpoints overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-muted/20 border border-border rounded-lg p-3 shadow-xs">
              <div className="text-[11px] font-medium text-muted-foreground mb-1">
                HTTP JSON-RPC 2.0 Endpoint
              </div>
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono text-xs text-foreground truncate select-all">{mcpHttpUrl}</code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(mcpHttpUrl, 'HTTP URL')}
                  className="p-1 text-muted-foreground hover:text-foreground cursor-pointer shrink-0 rounded-md"
                  title="Copy HTTP Endpoint"
                >
                  <Copy size={13} />
                </button>
              </div>
            </div>

            <div className="bg-muted/20 border border-border rounded-lg p-3 shadow-xs">
              <div className="text-[11px] font-medium text-muted-foreground mb-1">
                Server-Sent Events (SSE) Endpoint
              </div>
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono text-xs text-primary truncate select-all">{mcpSseUrl}</code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(mcpSseUrl, 'SSE URL')}
                  className="p-1 text-muted-foreground hover:text-foreground cursor-pointer shrink-0 rounded-md"
                  title="Copy SSE Endpoint"
                >
                  <Copy size={13} />
                </button>
              </div>
            </div>
          </div>

          {/* IDE Selection Tabs */}
          <div>
            <div className="flex items-center gap-1.5 border-b border-border overflow-x-auto pb-2.5">
              {[
                { id: 'antigravity', label: 'Antigravity' },
                { id: 'cursor', label: 'Cursor' },
                { id: 'vscode', label: 'VS Code / Cline' },
                { id: 'claude', label: 'Claude Desktop' },
                { id: 'zed', label: 'Zed Editor' },
                { id: 'curl', label: 'cURL / API' },
              ].map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as IdeTab)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer",
                    activeTab === tab.id
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Panels */}
            <div className="mt-3 bg-muted/20 border border-border rounded-xl p-4 shadow-xs">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground font-medium">
                  {activeTab === 'antigravity' && 'Google Antigravity MCP Configuration'}
                  {activeTab === 'cursor' && 'Cursor .cursor/mcp.json Configuration'}
                  {activeTab === 'vscode' && 'VS Code Cline / Roo-Code Configuration'}
                  {activeTab === 'claude' && 'Claude Desktop claude_desktop_config.json'}
                  {activeTab === 'zed' && 'Zed settings.json context_servers'}
                  {activeTab === 'curl' && 'Raw JSON-RPC 2.0 Protocol Usage'}
                </span>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const text =
                      activeTab === 'antigravity' ? antigravityConfig :
                        activeTab === 'cursor' ? cursorConfig :
                          activeTab === 'vscode' ? vscodeClineConfig :
                            activeTab === 'claude' ? claudeDesktopConfig :
                              activeTab === 'zed' ? zedConfig : curlExample;
                    copyToClipboard(text, activeTab.toUpperCase());
                  }}
                >
                  {copiedSection === activeTab.toUpperCase() ? (
                    <>
                      <Check size={12} className="text-emerald-500" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      <span>Copy Config</span>
                    </>
                  )}
                </Button>
              </div>

              <pre className="font-mono text-xs text-foreground overflow-x-auto p-3.5 bg-background border border-border rounded-lg leading-relaxed select-text">
                {activeTab === 'antigravity' && antigravityConfig}
                {activeTab === 'cursor' && cursorConfig}
                {activeTab === 'vscode' && vscodeClineConfig}
                {activeTab === 'claude' && claudeDesktopConfig}
                {activeTab === 'zed' && zedConfig}
                {activeTab === 'curl' && curlExample}
              </pre>

              <div className="mt-2.5 text-xs text-muted-foreground space-y-1">
                {activeTab === 'antigravity' && (
                  <p>
                    Add this to your workspace or user Antigravity configuration. Antigravity can immediately browse task backlogs, implement features according to descriptions, and mark tasks complete.
                  </p>
                )}
                {activeTab === 'cursor' && (
                  <p>
                    Place in <code className="text-primary font-mono">~/.cursor/mcp.json</code> or project <code className="text-primary font-mono">.cursor/mcp.json</code>. Restart Cursor or reload MCP servers in Settings.
                  </p>
                )}
                {activeTab === 'vscode' && (
                  <p>
                    Add to Cline/Roo Code settings under <code className="text-primary font-mono">cline_mcp_settings.json</code>. Your assistant can read tasks, update branches, and track progress.
                  </p>
                )}
                {activeTab === 'claude' && (
                  <p>
                    Add to <code className="text-primary font-mono">claude_desktop_config.json</code> under the <code className="text-primary font-mono">mcpServers</code> dictionary and restart Claude Desktop.
                  </p>
                )}
                {activeTab === 'zed' && (
                  <p>
                    Insert under <code className="text-primary font-mono">context_servers</code> in your Zed <code className="text-primary font-mono">settings.json</code> to provide project awareness to the Zed assistant.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Supported MCP Tools Summary */}
          <div>
            <div className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2">
              <Layers size={14} className="text-primary" />
              <span>Available Project MCP Tools (7)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs">
              {[
                { name: 'list_projects', desc: 'List all accessible projects in session with Snowflake IDs and stats' },
                { name: 'list_tasks', desc: 'List tasks in project board; supports target project_id filter' },
                { name: 'get_task', desc: 'Fetch full requirements and specs by task ID across all projects' },
                { name: 'create_task', desc: 'Create tasks, bug reports, and features in any accessible project' },
                { name: 'update_task', desc: 'Update title, description, or move task across any project' },
                { name: 'complete_task', desc: 'Mark a task completed and archive it to the Done column' },
                { name: 'get_project_summary', desc: 'Live markdown overview of pipeline stages, team, and projects' },
              ].map(tool => (
                <div key={tool.name} className="p-3 bg-muted/20 border border-border rounded-lg shadow-xs">
                  <div className="text-primary font-mono font-semibold text-xs">{tool.name}</div>
                  <div className="text-muted-foreground text-[11px] mt-1 leading-snug">{tool.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-muted/30 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
