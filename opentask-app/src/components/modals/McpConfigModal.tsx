import React, { useState, useEffect } from 'react';
import { CloseButton } from '../../design-system/CloseButton';
import { Badge } from '../../design-system/Badge';
import { Copy, Check, Key, Layers, Sparkles, Cpu } from 'lucide-react';
import { projectService } from '../../services/projectService';
import { getBaseUrl } from '../../services/apiClient';
import { useToast } from '../../design-system/Toast';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-[#0E1012] border-2 border-black rounded-none shadow-[8px_8px_0px_0px_#000000] text-white my-8">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b-2 border-black bg-[#141619]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#FFE600] border-2 border-black flex items-center justify-center text-black font-black shadow-[2px_2px_0px_0px_#000000]">
              <Cpu size={20} strokeWidth={2.5} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[16px] font-black font-mono tracking-wider text-white uppercase">
                  AI Model Context Protocol (MCP)
                </h2>
                <Badge variant="warning" className="!py-0.5 !px-1.5 !text-[10px]">
                  ID: {String(projectId).slice(-6)}
                </Badge>
              </div>
              <p className="text-[11px] font-mono text-neutral-400 mt-0.5">
                Connect {projectName} tasks directly to your AI IDE (Antigravity, Cursor, VS Code, Zed, Claude)
              </p>
            </div>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        {/* API Key Status Banner */}
        <div className="px-5 py-3 border-b-2 border-black bg-[#16191D] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Key size={14} className={apiKey ? 'text-[#00FF66]' : 'text-[#FFE600]'} />
            <span className="font-mono text-[11px] uppercase text-neutral-300">
              PROJECT AI SECRET KEY:
            </span>
            {apiKey ? (
              <code className="font-mono text-[11px] text-[#FFE600] bg-black px-2 py-0.5 border border-neutral-700">
                {apiKey.slice(0, 10)}...{apiKey.slice(-6)}
              </code>
            ) : (
              <span className="font-mono text-[11px] text-[#FF3333] font-bold">
                [NOT GENERATED YET]
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {apiKey ? (
              <button
                type="button"
                onClick={() => copyToClipboard(apiKey, 'API Key')}
                className="px-3 py-1 bg-[#1E2227] hover:bg-neutral-800 text-neutral-300 border border-black font-mono text-[10px] font-bold uppercase flex items-center gap-1.5 cursor-pointer"
              >
                {copiedSection === 'API Key' ? <Check size={12} className="text-[#00FF66]" /> : <Copy size={12} />}
                <span>{copiedSection === 'API Key' ? 'COPIED' : 'COPY KEY'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleGenerateKey}
                disabled={loadingKey}
                className="px-3.5 py-1 bg-[#FFE600] text-black border-2 border-black font-mono text-[10px] font-black uppercase flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-[2px_2px_0px_0px_#000000]"
              >
                <Sparkles size={12} />
                <span>{loadingKey ? 'GENERATING...' : 'GENERATE API KEY'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Endpoints overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-[#0B0E14] border-2 border-black p-3 shadow-[2px_2px_0px_0px_#000000]">
              <div className="text-[10px] font-black text-neutral-400 uppercase font-mono mb-1">
                // HTTP JSON-RPC 2.0 ENDPOINT
              </div>
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono text-[11px] text-[#FFE600] truncate select-all">{mcpHttpUrl}</code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(mcpHttpUrl, 'HTTP URL')}
                  className="p-1 text-neutral-400 hover:text-white cursor-pointer shrink-0"
                  title="Copy HTTP Endpoint"
                >
                  <Copy size={13} />
                </button>
              </div>
            </div>

            <div className="bg-[#0B0E14] border-2 border-black p-3 shadow-[2px_2px_0px_0px_#000000]">
              <div className="text-[10px] font-black text-neutral-400 uppercase font-mono mb-1">
                // SERVER-SENT EVENTS (SSE) ENDPOINT
              </div>
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono text-[11px] text-cyan-700 dark:text-[#00E5FF] truncate select-all">{mcpSseUrl}</code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(mcpSseUrl, 'SSE URL')}
                  className="p-1 text-neutral-400 hover:text-white cursor-pointer shrink-0"
                  title="Copy SSE Endpoint"
                >
                  <Copy size={13} />
                </button>
              </div>
            </div>
          </div>

          {/* IDE Selection Tabs */}
          <div>
            <div className="flex items-center gap-1 border-b-2 border-black overflow-x-auto pb-3">
              {[
                { id: 'antigravity', label: 'ANTIGRAVITY' },
                { id: 'cursor', label: 'CURSOR' },
                { id: 'vscode', label: 'VS CODE / CLINE' },
                { id: 'claude', label: 'CLAUDE DESKTOP' },
                { id: 'zed', label: 'ZED EDITOR' },
                { id: 'curl', label: 'CURL / API' },
              ].map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as IdeTab)}
                  className={`px-3.5 py-1.5 font-mono text-[11px] font-black uppercase tracking-wider border-2 border-black transition-all cursor-pointer ${activeTab === tab.id
                    ? 'bg-[#FFE600] text-black shadow-[2px_2px_0px_0px_#000000] py-1'
                    : 'bg-[#141619] text-neutral-400 hover:text-white hover:bg-neutral-800'
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Panels */}
            <div className="mt-4 bg-[#0B0E14] border-2 border-black p-4 shadow-[4px_4px_0px_0px_#000000]">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] text-neutral-400 font-black uppercase">
                  {activeTab === 'antigravity' && '// GOOGLE ANTIGRAVITY MCP CONFIGURATION'}
                  {activeTab === 'cursor' && '// CURSOR .cursor/mcp.json CONFIGURATION'}
                  {activeTab === 'vscode' && '// VS CODE CLINE / ROO-CODE / COPILOT CONFIG'}
                  {activeTab === 'claude' && '// CLAUDE DESKTOP claude_desktop_config.json'}
                  {activeTab === 'zed' && '// ZED settings.json context_servers'}
                  {activeTab === 'curl' && '// RAW JSON-RPC 2.0 PROTOCOL USAGE'}
                </span>

                <button
                  type="button"
                  onClick={() => {
                    const text =
                      activeTab === 'antigravity' ? antigravityConfig :
                        activeTab === 'cursor' ? cursorConfig :
                          activeTab === 'vscode' ? vscodeClineConfig :
                            activeTab === 'claude' ? claudeDesktopConfig :
                              activeTab === 'zed' ? zedConfig : curlExample;
                    copyToClipboard(text, activeTab.toUpperCase());
                  }}
                  className="px-3 py-1 bg-[#FFE600] text-black font-mono text-[10px] font-black uppercase border-2 border-black flex items-center gap-1.5 shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer"
                >
                  {copiedSection === activeTab.toUpperCase() ? (
                    <>
                      <Check size={12} strokeWidth={3} />
                      <span>COPIED CONFIG</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      <span>COPY CONFIG</span>
                    </>
                  )}
                </button>
              </div>

              <pre className="font-mono text-[12px] text-neutral-200 overflow-x-auto p-3 bg-[#F0F0EB] dark:bg-black border border-neutral-800 leading-relaxed select-text">
                {activeTab === 'antigravity' && antigravityConfig}
                {activeTab === 'cursor' && cursorConfig}
                {activeTab === 'vscode' && vscodeClineConfig}
                {activeTab === 'claude' && claudeDesktopConfig}
                {activeTab === 'zed' && zedConfig}
                {activeTab === 'curl' && curlExample}
              </pre>

              <div className="mt-3 text-[11px] font-mono text-neutral-400 space-y-1">
                {activeTab === 'antigravity' && (
                  <p>
                    Add this to your workspace or user Antigravity configuration. Antigravity can immediately browse task backlogs, implement features according to descriptions, and mark tasks complete.
                  </p>
                )}
                {activeTab === 'cursor' && (
                  <p>
                    Place in <code className="text-[#FFE600]">~/.cursor/mcp.json</code> or project <code className="text-[#FFE600]">.cursor/mcp.json</code>. Restart Cursor or reload MCP servers in Settings.
                  </p>
                )}
                {activeTab === 'vscode' && (
                  <p>
                    Add to Cline/Roo Code settings under <code className="text-[#FFE600]">cline_mcp_settings.json</code>. Your assistant can read tasks, update branches, and track progress.
                  </p>
                )}
                {activeTab === 'claude' && (
                  <p>
                    Add to <code className="text-[#FFE600]">claude_desktop_config.json</code> under the <code className="text-[#FFE600]">mcpServers</code> dictionary and restart Claude Desktop.
                  </p>
                )}
                {activeTab === 'zed' && (
                  <p>
                    Insert under <code className="text-[#FFE600]">context_servers</code> in your Zed <code className="text-[#FFE600]">settings.json</code> to provide project awareness to the Zed assistant.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Supported MCP Tools Summary */}
          <div>
            <div className="font-mono text-[11px] font-black text-white uppercase mb-2 flex items-center gap-2">
              <Layers size={14} className="text-[#FFE600]" />
              <span>// AVAILABLE PROJECT MCP TOOLS (7)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 font-mono text-[11px]">
              {[
                { name: 'list_projects', desc: 'List all accessible projects in session with Snowflake IDs and stats' },
                { name: 'list_tasks', desc: 'List tasks in project board; supports target project_id filter' },
                { name: 'get_task', desc: 'Fetch full requirements and specs by task ID across all projects' },
                { name: 'create_task', desc: 'Create tasks, bug reports, and features in any accessible project' },
                { name: 'update_task', desc: 'Update title, description, or move task across any project' },
                { name: 'complete_task', desc: 'Mark a task completed and archive it to the Done column' },
                { name: 'get_project_summary', desc: 'Live markdown overview of pipeline stages, team, and projects' },
              ].map(tool => (
                <div key={tool.name} className="p-2.5 bg-[#141619] border border-neutral-800">
                  <div className="text-[#FFE600] font-bold">⚙ {tool.name}</div>
                  <div className="text-neutral-400 text-[10px] mt-1 leading-snug">{tool.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t-2 border-black bg-[#141619] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-[#1E2227] hover:bg-white hover:text-black text-neutral-300 font-mono text-[11px] font-black uppercase border-2 border-black shadow-[2px_2px_0px_0px_#000000] cursor-pointer transition-all active:translate-x-[1px] active:translate-y-[1px]"
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
};
