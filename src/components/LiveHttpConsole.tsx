import React, { useState } from 'react';
import {
  X,
  Send,
  Terminal,
  Copy,
  Check,
  Server,
  Zap,
  Activity,
} from 'lucide-react';
import { ProxySimulation, LiveHttpResponse } from '../services/simulationEngine';
import { SimulationState } from '../types/proxy';

interface LiveHttpConsoleProps {
  simulation: ProxySimulation;
  simulationState: SimulationState;
  isOpen: boolean;
  onClose: () => void;
  onTriggerPacket?: () => void;
  onRefreshState: () => void;
}

export const LiveHttpConsole: React.FC<LiveHttpConsoleProps> = ({
  simulation,
  simulationState,
  isOpen,
  onClose,
  onTriggerPacket,
  onRefreshState,
}) => {
  const [method, setMethod] = useState<'GET' | 'POST' | 'HEAD'>('GET');
  const [path, setPath] = useState('/api/v1/data');
  const [clientIp, setClientIp] = useState('192.168.1.42');
  const [isSending, setIsSending] = useState(false);
  const [lastResponse, setLastResponse] = useState<LiveHttpResponse | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleSend = () => {
    setIsSending(true);
    setTimeout(() => {
      const resp = simulation.executeLiveRequest(method, path, clientIp);
      setLastResponse(resp);
      setIsSending(false);
      onRefreshState();
      if (onTriggerPacket) onTriggerPacket();
    }, 180);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-[#0f121a] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden text-slate-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#131622]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Interactive HTTP Client</span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/70 border border-emerald-800 px-2 py-0.5 rounded">
                  PORT 8080 ACTIVE
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Send real-time HTTP requests through 7 Layer Reverse Proxy and inspect live routing, latency, and response wire bytes.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5 text-xs">
          {/* Request Presets */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-slate-400">
              <span className="font-semibold text-slate-300">Quick Request Presets:</span>
              <span className="text-[11px] font-mono text-slate-500">Target: http://localhost:8080</span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <button
                onClick={() => { setMethod('GET'); setPath('/api/v1/data'); setClientIp('192.168.1.42'); }}
                className="px-2.5 py-1 bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 cursor-pointer transition-colors"
              >
                GET /api/v1/data (Load Balanced)
              </button>
              <button
                onClick={() => { setMethod('POST'); setPath('/api/v1/items'); setClientIp('10.0.0.15'); }}
                className="px-2.5 py-1 bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 cursor-pointer transition-colors"
              >
                POST /api/v1/items (splice eligible)
              </button>
              <button
                onClick={() => { setMethod('GET'); setPath('/metrics'); setClientIp('127.0.0.1'); }}
                className="px-2.5 py-1 bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 cursor-pointer transition-colors"
              >
                GET /metrics (Prometheus)
              </button>
              <button
                onClick={() => { setMethod('GET'); setPath('/api/v1/dos-attack'); setClientIp('192.168.1.999'); }}
                className="px-2.5 py-1 bg-red-950/60 hover:bg-red-900/60 text-red-300 rounded border border-red-800/80 cursor-pointer transition-colors"
              >
                Test 429 Rate Limit Drop (Depleted IP)
              </button>
            </div>
          </div>

          {/* Request Input Bar */}
          <div className="flex items-center gap-2">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as any)}
              className="bg-[#181c2b] border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono font-bold text-amber-400 focus:outline-none"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="HEAD">HEAD</option>
            </select>

            <div className="flex-1">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/api/v1/resource"
                className="w-full bg-[#181c2b] border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:border-emerald-400 focus:outline-none"
              />
            </div>

            <div className="w-44">
              <input
                type="text"
                value={clientIp}
                onChange={(e) => setClientIp(e.target.value)}
                placeholder="Client IP"
                title="Client IP for Token Bucket rate limiting"
                className="w-full bg-[#181c2b] border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-300 focus:border-emerald-400 focus:outline-none"
              />
            </div>

            <button
              onClick={handleSend}
              disabled={isSending}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg cursor-pointer flex items-center gap-1.5 transition-all shadow-md disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSending ? 'Sending...' : 'Send'}</span>
            </button>
          </div>

          {/* Wire Response Inspector */}
          {lastResponse ? (
            <div className="space-y-3 bg-[#131724] border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`text-sm font-bold font-mono px-2.5 py-0.5 rounded ${
                      lastResponse.statusCode === 200
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-700'
                        : lastResponse.statusCode === 429
                        ? 'bg-blue-950 text-blue-400 border border-blue-700'
                        : 'bg-red-950 text-red-400 border border-red-700'
                    }`}
                  >
                    HTTP {lastResponse.statusCode} {lastResponse.statusText}
                  </span>
                  <span className="font-mono text-slate-300 text-[11px]">
                    Latency: <strong className="text-emerald-400">{lastResponse.latencyMs} ms</strong>
                  </span>
                  <span className="font-mono text-slate-400 text-[11px]">
                    Thread: <span className="text-amber-400">{lastResponse.workerId}</span>
                  </span>
                </div>

                <button
                  onClick={() => handleCopy(lastResponse.body)}
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white cursor-pointer"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Copied' : 'Copy Response'}</span>
                </button>
              </div>

              {/* Routing Diagnostics */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 py-1 text-[11px]">
                <div className="p-2 bg-[#181c2b] border border-slate-800 rounded">
                  <div className="text-slate-400 text-[10px]">Routed Server:</div>
                  <div className="font-semibold text-slate-200 mt-0.5 flex items-center gap-1">
                    <Server className="w-3 h-3 text-amber-400" />
                    <span>{lastResponse.servedBy}</span>
                  </div>
                </div>

                <div className="p-2 bg-[#181c2b] border border-slate-800 rounded">
                  <div className="text-slate-400 text-[10px]">Forwarding Mechanism:</div>
                  <div className="font-semibold text-emerald-300 mt-0.5 flex items-center gap-1">
                    <Zap className="w-3 h-3 text-emerald-400" />
                    <span>{lastResponse.forwardingEngine}</span>
                  </div>
                </div>

                <div className="p-2 bg-[#181c2b] border border-slate-800 rounded">
                  <div className="text-slate-400 text-[10px]">Active Load Balancer:</div>
                  <div className="font-semibold text-amber-300 mt-0.5 flex items-center gap-1">
                    <Activity className="w-3 h-3 text-amber-400" />
                    <span>{simulationState.algo}</span>
                  </div>
                </div>
              </div>

              {/* Headers and Body */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1 block">
                    Response Headers:
                  </span>
                  <div className="bg-[#0b0c12] p-3 rounded-lg border border-slate-800 font-mono text-[11px] text-slate-300 max-h-48 overflow-y-auto leading-relaxed">
                    {Object.entries(lastResponse.headers).map(([k, v]) => (
                      <div key={k}>
                        <span className="text-amber-400/90">{k}:</span> <span className="text-emerald-300">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1 block">
                    Response Body (JSON):
                  </span>
                  <div className="bg-[#0b0c12] p-3 rounded-lg border border-slate-800 font-mono text-[11px] text-emerald-400/90 max-h-48 overflow-y-auto leading-relaxed">
                    <pre>{lastResponse.body}</pre>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 border border-dashed border-slate-800 rounded-xl text-center text-slate-500">
              <Send className="w-6 h-6 mx-auto mb-2 text-slate-600" />
              <p>Click <strong className="text-slate-400">"Send"</strong> above to dispatch a live request through AetherProxy.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
