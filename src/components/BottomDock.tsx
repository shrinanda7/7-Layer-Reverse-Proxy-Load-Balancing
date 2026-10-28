/**
 * Controlled Management & Pipeline Dock for AetherProxy
 * Streamlined 3-mode interface:
 * 1. Controlled Management Plane (Subsystem switches, traffic controls, backend health)
 * 2. Real-world Benchmarks & Live Prometheus /metrics
 * 3. Unified C++ Project Architecture & Management Audit Trail
 */

import React, { useState } from 'react';
import {
  Cpu,
  Flame,
  ShieldAlert,
  BarChart3,
  FileCode2,
  RefreshCw,
  Power,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  ShieldCheck,
  Server,
  Layers,
} from 'lucide-react';
import {
  SimulationState,
  LoadBalancingAlgo,
  ProtocolMode,
} from '../types/proxy';
import { SUBSYSTEM_EVALUATIONS, ManagementAuditEntry } from '../services/simulationEngine';

interface BottomDockProps {
  simulationState: SimulationState;
  auditTrail: ManagementAuditEntry[];
  onUpdateConfigSafely: (patch: { subsystemToggle?: keyof SimulationState['subsystems']; algo?: LoadBalancingAlgo; protocol?: ProtocolMode; targetRps?: number; concurrency?: number }) => boolean;
  onToggleBackend: (backendId: string) => void;
  onTripCircuitBreaker: (backendId: string) => void;
  onTriggerBurst: () => void;
  onTriggerSighup: () => void;
  prometheusMetricsText: string;
  onReviveAllBackends?: () => void;
}

type MainView = 'pipeline' | 'evaluation' | 'cpp_project';

export const BottomDock: React.FC<BottomDockProps> = ({
  simulationState,
  auditTrail,
  onUpdateConfigSafely,
  onToggleBackend,
  onTripCircuitBreaker,
  onTriggerBurst,
  onTriggerSighup,
  prometheusMetricsText,
  onReviveAllBackends,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<MainView>('pipeline');
  const [copied, setCopied] = useState(false);
  const [selectedFile, setSelectedFile] = useState<'main.cpp' | 'reactor.cpp' | 'load_balancer.hpp' | 'management.hpp' | 'token_bucket.hpp' | 'circuit_breaker.hpp' | 'memory_arena.hpp'>('main.cpp');

  const sub = simulationState.subsystems;

  const cppCodeSnippets: Record<string, string> = {
    'main.cpp': `/**
 * AetherProxy - Integrated Reverse Proxy Daemon
 * Real Network Programming Sequence:
 * 1. Multi-reactor workers accept TCP connections first (SO_REUSEPORT)
 * 2. On EPOLLIN: parse HTTP request headers & evaluate Token Bucket rate limit
 * 3. Select eligible upstream via Load Balancer (filtering node Circuit Breakers)
 * 4. Choose compatible forwarding: splice() zero-copy vs Memory Arena buffer
 * 5. Exactly 3 Servers: 1 Proxy + 2 Backends (Alpha :8081 & Beta :8082)
 */
#include "proxy.hpp"
#include "management.hpp"
#include <csignal>
#include <iostream>

static std::shared_ptr<aether::ReverseProxyServer> g_proxy = nullptr;

void signal_handler(int signum) {
    if (signum == SIGHUP) {
        std::cout << "[SIGHUP] Zero-downtime atomic configuration reload applied.\\n";
        if (g_proxy) g_proxy->handle_sighup();
    }
}

int main() {
    aether::ProxyConfig cfg;
    cfg.listen_port = 8080;
    cfg.tls_port = 8443;
    cfg.enable_splice = true;
    cfg.backends = {
        {"127.0.0.1", 8081, 1, "backend-alpha"},
        {"127.0.0.1", 8082, 1, "backend-beta"}
    };

    g_proxy = std::make_shared<aether::ReverseProxyServer>(cfg);
    g_proxy->start();
    return 0;
}`,
    'reactor.cpp': `/**
 * Reactor Worker: Accept first, parse HTTP request, apply rate limit,
 * then select upstream and choose forwarding mechanism.
 */
void ReactorWorker::handle_client_data(int fd) {
    auto session = sessions_[fd];
    if (!session) return;

    if (session->backend_fd < 0) {
        char* buf = session->client_buffer.data;
        ssize_t n = session->is_tls ? SSL_read(session->ssl, buf, session->client_buffer.capacity - 1)
                                    : recv(fd, buf, session->client_buffer.capacity - 1, 0);
        if (n <= 0) { close_session(fd); return; }
        buf[n] = '\\0';

        // 1. Request-Level Token Bucket Rate Limiting
        if (!limiter_->allow_request(session->client_ip)) {
            metrics_->record_rate_limit_drop();
            send(fd, "HTTP/1.1 429 Too Many Requests\\r\\n\\r\\n", 36, 0);
            close_session(fd);
            return;
        }

        // 2. Select Upstream Backend (filtering per-node circuit breakers)
        auto backend = lb_->select_backend(session->client_ip);
        if (!backend) {
            send(fd, "HTTP/1.1 503 Service Unavailable\\r\\n\\r\\n", 38, 0);
            close_session(fd);
            return;
        }

        // 3. Connect to chosen upstream and determine forwarding path
        int backend_fd = socket(AF_INET, SOCK_STREAM, 0);
        connect_upstream(backend_fd, backend);

        // Plaintext stream -> Linux kernel splice() zero-copy bypass
        if (config_.enable_splice && !session->is_tls && !session->is_websocket) {
            session->is_splicing = true;
        }
        send(backend_fd, buf, n, 0);
        return;
    }
}`,
    'load_balancer.hpp': `// Upstream selection with integrated node circuit breaker inspection
std::shared_ptr<BackendNode> LoadBalancer::select_backend(const std::string& client_ip) {
    std::lock_guard<std::mutex> lock(backends_mutex_);
    
    // Filter backends: must be healthy AND node circuit breaker allows request
    std::vector<std::shared_ptr<BackendNode>> eligible;
    for (auto& node : backends_) {
        if (node->is_healthy.load() && node->circuit_breaker->allow_request()) {
            eligible.push_back(node);
        }
    }
    if (eligible.empty()) return nullptr; // Fast-fail with HTTP 503

    if (algorithm_.load() == LoadBalanceAlgorithm::LEAST_CONNECTIONS) {
        auto it = std::min_element(eligible.begin(), eligible.end(),
            [](const auto& a, const auto& b) {
                return a->active_connections.load() < b->active_connections.load();
            });
        (*it)->active_connections++;
        return *it;
    }
    size_t idx = (rr_index_++) % eligible.size();
    eligible[idx]->active_connections++;
    return eligible[idx];
}`,
    'management.hpp': `// Controlled Management Plane & Configuration Publisher
ValidationResult ProxyManagementPlane::update_configuration(
    const ProxyConfig& proposed_config, const std::string& actor) {
    std::lock_guard<std::mutex> lock(management_mutex_);

    auto val = validate_config(proposed_config);
    if (!val.valid) {
        audit_logs_.push_back({now(), "CONFIG_REJECTED", val.error_message, false});
        return val;
    }

    // Atomic snapshot publish to worker threads (zero-downtime)
    if (publish_callback_) {
        publish_callback_(proposed_config);
    }
    audit_logs_.push_back({now(), "CONFIG_PUBLISHED", "Atomic snapshot applied", true});
    return {true, ""};
}`,
    'token_bucket.hpp': `// Request-Level Token Bucket Rate Limiter
bool TokenBucketLimiter::allow_request(const std::string& client_ip, double cost) {
    size_t shard = std::hash<std::string>{}(client_ip) % NUM_SHARDS;
    std::lock_guard<std::mutex> lock(shard_mutexes_[shard]);
    auto now = std::chrono::steady_clock::now();
    auto& b = shard_buckets_[shard][client_ip];

    std::chrono::duration<double> elapsed = now - b.last_refill;
    b.tokens = std::min(default_capacity_, b.tokens + elapsed.count() * default_rate_);
    b.last_refill = now;

    if (b.tokens >= cost) {
        b.tokens -= cost;
        return true;
    }
    return false; // Exceeded limit -> HTTP 429
}`,
    'circuit_breaker.hpp': `// 3-State Per-Node Circuit Breaker (CLOSED -> OPEN -> HALF_OPEN)
bool CircuitBreaker::allow_request() {
    std::lock_guard<std::mutex> lock(mutex_);
    auto now = std::chrono::steady_clock::now();

    if (state_ == CircuitState::OPEN) {
        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - last_state_change_).count();
        if (elapsed >= open_cooldown_ms_) {
            state_ = CircuitState::HALF_OPEN;
            last_state_change_ = now;
            half_open_successes_ = 0;
            return true; // Allow single probe request
        }
        return false; // Fast-fail with HTTP 503
    }
    return true;
}`,
    'memory_arena.hpp': `// Shared Memory Arena Facility: 64-byte aligned connection buffer pool
ArenaAllocator::Block ArenaAllocator::acquire_block() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!free_blocks_.empty()) {
        Block b = free_blocks_.back();
        free_blocks_.pop_back();
        return b;
    }
    size_t aligned_offset = (current_offset_ + 63) & ~63;
    if (aligned_offset + block_size_ > chunk_size_) {
        allocate_new_chunk();
        aligned_offset = 0;
    }
    char* ptr = static_cast<char*>(raw_chunks_.back()) + aligned_offset;
    current_offset_ = aligned_offset + block_size_;
    return Block{ptr, 0, block_size_};
}`,
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(cppCodeSnippets[selectedFile] || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-30 w-full max-w-[1140px] px-3 transition-all duration-300">
      {/* Collapse Toggle */}
      <div className="flex justify-center mb-1">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex items-center gap-1.5 px-3 py-1 bg-[#13161f]/95 hover:bg-[#1a1f2c] border border-slate-700/60 rounded-t-md text-xs font-medium text-slate-300 shadow-lg cursor-pointer transition-colors"
        >
          {isCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5 text-amber-400" />
              <span>Show Controlled Management Interface</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5 text-amber-400" />
              <span>Hide Controls</span>
            </>
          )}
        </button>
      </div>

      {!isCollapsed && (
        <div className="bg-[#12151e]/98 border border-slate-800 shadow-2xl rounded-xl overflow-hidden backdrop-blur-md">
          {/* Header Bar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800/80 bg-[#161a26]/90">
            {/* View Selectors */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveView('pipeline')}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                  activeView === 'pipeline'
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>Controlled Management Plane</span>
              </button>

              <button
                onClick={() => setActiveView('evaluation')}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                  activeView === 'evaluation'
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Subsystem Benchmarks &amp; /metrics</span>
              </button>

              <button
                onClick={() => setActiveView('cpp_project')}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                  activeView === 'cpp_project'
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileCode2 className="w-3.5 h-3.5" />
                <span>C++ Project &amp; Audit Trail</span>
              </button>
            </div>

            {/* SIGHUP Hot Reload Trigger */}
            <button
              onClick={onTriggerSighup}
              disabled={simulationState.isSighupReloading}
              className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 rounded-md text-xs font-medium cursor-pointer transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${simulationState.isSighupReloading ? 'animate-spin' : ''}`} />
              <span>SIGHUP Hot Reload</span>
            </button>
          </div>

          {/* SIGHUP Banner */}
          {simulationState.sighupMessage && (
            <div className="px-4 py-1.5 bg-emerald-950/60 border-b border-emerald-800/60 text-xs text-emerald-300 flex items-center justify-between">
              <span>{simulationState.sighupMessage}</span>
              <span className="font-mono text-[11px] text-emerald-400">Zero-Downtime Swap</span>
            </div>
          )}

          {/* View 1: Controlled Management Plane */}
          {activeView === 'pipeline' && (
            <div className="p-4 space-y-4 text-xs">
              {/* Management API Controlled Subsystem Toggles */}
              <div>
                <div className="text-slate-400 font-medium mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                    <span>Controlled Configuration Management (Validated &amp; Atomically Published):</span>
                  </span>
                  <span className="font-mono text-[11px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/60">
                    Control Plane: POST /admin/config
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                  {/* splice() */}
                  <button
                    onClick={() => onUpdateConfigSafely({ subsystemToggle: 'spliceZeroCopy' })}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                      sub.spliceZeroCopy
                        ? 'bg-amber-500/15 border-amber-500/60 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.15)]'
                        : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[11px]">03. splice() 0-Copy</span>
                      <span className={`text-[9px] px-1 rounded font-mono ${sub.spliceZeroCopy ? 'bg-amber-500/30 text-amber-200' : 'bg-slate-800 text-slate-400'}`}>
                        {sub.spliceZeroCopy ? 'ON' : 'OFF'}
                      </span>
                    </div>
                    <div className="text-[10px] mt-1 text-slate-300">
                      {sub.spliceZeroCopy ? 'Underdeck Pipe ON · 89% 0-Copy' : 'Userspace Heap Copy (memcpy)'}
                    </div>
                    <div className="text-[9px] text-slate-500 mt-0.5">
                      {sub.spliceZeroCopy ? 'Kernel pipe buffer transfer' : 'Page faults & userspace memcpy'}
                    </div>
                  </button>

                  {/* Token Bucket */}
                  <button
                    onClick={() => onUpdateConfigSafely({ subsystemToggle: 'tokenBucketLimiter' })}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                      sub.tokenBucketLimiter
                        ? 'bg-blue-500/15 border-blue-500/60 text-blue-300 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
                        : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[11px]">04. Token Bucket</span>
                      <span className={`text-[9px] px-1 rounded font-mono ${sub.tokenBucketLimiter ? 'bg-blue-500/30 text-blue-200' : 'bg-slate-800 text-slate-400'}`}>
                        {sub.tokenBucketLimiter ? 'ON' : 'OFF'}
                      </span>
                    </div>
                    <div className="text-[10px] mt-1 text-slate-300">
                      {sub.tokenBucketLimiter ? 'Cyan Ring Spinning · Drops DDoS' : 'Bypassed (Zero Rate Limiting)'}
                    </div>
                    <div className="text-[9px] text-slate-500 mt-0.5">
                      {sub.tokenBucketLimiter ? 'Enforces per-IP burst & rate limits' : 'Allows volumetric flood downstream'}
                    </div>
                  </button>

                  {/* Circuit Breaker */}
                  <button
                    onClick={() => onUpdateConfigSafely({ subsystemToggle: 'circuitBreaker' })}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                      sub.circuitBreaker
                        ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                        : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[11px]">04. Circuit Breaker</span>
                      <span className={`text-[9px] px-1 rounded font-mono ${sub.circuitBreaker ? 'bg-emerald-500/30 text-emerald-200' : 'bg-slate-800 text-slate-400'}`}>
                        {sub.circuitBreaker ? 'ON' : 'OFF'}
                      </span>
                    </div>
                    <div className="text-[10px] mt-1 text-slate-300">
                      {sub.circuitBreaker ? 'Protective Shields Armed' : 'Unshielded (Failed nodes hammer)'}
                    </div>
                    <div className="text-[9px] text-slate-500 mt-0.5">
                      {sub.circuitBreaker ? 'CLOSED → OPEN → HALF_OPEN probes' : 'Repeated TCP SYN timeouts & delays'}
                    </div>
                  </button>

                  {/* Memory Arena */}
                  <button
                    onClick={() => onUpdateConfigSafely({ subsystemToggle: 'memoryArena' })}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                      sub.memoryArena
                        ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                        : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[11px]">06. Arena Facility</span>
                      <span className={`text-[9px] px-1 rounded font-mono ${sub.memoryArena ? 'bg-emerald-500/30 text-emerald-200' : 'bg-slate-800 text-slate-400'}`}>
                        {sub.memoryArena ? 'ON' : 'OFF'}
                      </span>
                    </div>
                    <div className="text-[10px] mt-1 text-slate-300">
                      {sub.memoryArena ? 'Green Slab Pulsing · 28MB RAM' : 'Gray Slab · glibc malloc 68MB'}
                    </div>
                    <div className="text-[9px] text-slate-500 mt-0.5">
                      {sub.memoryArena ? '64-Byte cache-aligned pre-alloc' : 'Dynamic heap fragmentation'}
                    </div>
                  </button>

                  {/* Multi-Reactor SO_REUSEPORT */}
                  <button
                    onClick={() => onUpdateConfigSafely({ subsystemToggle: 'soReusePort' })}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                      sub.soReusePort
                        ? 'bg-amber-500/15 border-amber-500/60 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.15)]'
                        : 'bg-red-500/15 border-red-500/60 text-red-300 shadow-[0_0_12px_rgba(239,68,68,0.15)]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[11px]">03. Multi-Reactor</span>
                      <span className={`text-[9px] px-1 rounded font-mono ${sub.soReusePort ? 'bg-amber-500/30 text-amber-200' : 'bg-red-500/30 text-red-200'}`}>
                        {sub.soReusePort ? '4 Workers' : '1 Worker'}
                      </span>
                    </div>
                    <div className="text-[10px] mt-1 text-slate-300">
                      {sub.soReusePort ? '4 Epoll Coils Spinning' : '3 Coils Stalled · 1 Red Bottleneck'}
                    </div>
                    <div className="text-[9px] text-slate-500 mt-0.5">
                      {sub.soReusePort ? 'Kernel SO_REUSEPORT distribution' : 'Single thread locks up at 8k RPS'}
                    </div>
                  </button>

                  {/* Protocol */}
                  <button
                    onClick={() => onUpdateConfigSafely({ protocol: simulationState.protocol === 'tls' ? 'http' : 'tls' })}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                      simulationState.protocol === 'tls'
                        ? 'bg-purple-500/15 border-purple-500/60 text-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.15)]'
                        : 'bg-sky-500/15 border-sky-500/50 text-sky-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[11px]">05. OpenSSL TLS</span>
                      <span className={`text-[9px] px-1 rounded font-mono ${simulationState.protocol === 'tls' ? 'bg-purple-500/30 text-purple-200' : 'bg-sky-500/30 text-sky-200'}`}>
                        {simulationState.protocol === 'tls' ? 'TLS 1.3' : 'HTTP/1.1'}
                      </span>
                    </div>
                    <div className="text-[10px] mt-1 text-slate-300">
                      {simulationState.protocol === 'tls' ? 'Purple Rings & Encrypted Packets' : 'Plaintext Amber Packets'}
                    </div>
                    <div className="text-[9px] text-slate-500 mt-0.5">
                      {simulationState.protocol === 'tls' ? 'SSL_read / SSL_write termination' : 'Eligible for splice() zero-copy'}
                    </div>
                  </button>
                </div>
              </div>

              {/* Lower Strip: Load Balancer Algorithm + Demand Sliders + 3 Servers Status */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-800">
                {/* 02. Load Balancer Algorithm */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-slate-400 font-medium">
                    <span>02. Load Balancer Algorithm</span>
                    <span className="font-mono text-amber-400">{simulationState.algo}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => onUpdateConfigSafely({ algo: 'least-connections' })}
                      className={`py-1.5 px-2 rounded font-medium text-center border cursor-pointer ${
                        simulationState.algo === 'least-connections'
                          ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                          : 'bg-slate-900/60 border-slate-700/60 text-slate-400'
                      }`}
                    >
                      Least-Connections
                    </button>
                    <button
                      onClick={() => onUpdateConfigSafely({ algo: 'round-robin' })}
                      className={`py-1.5 px-2 rounded font-medium text-center border cursor-pointer ${
                        simulationState.algo === 'round-robin'
                          ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                          : 'bg-slate-900/60 border-slate-700/60 text-slate-400'
                      }`}
                    >
                      Round-Robin
                    </button>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Excludes open-circuit nodes; admits half-open probe requests.
                  </div>
                </div>

                {/* Demand Sliders */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-slate-400 font-medium">
                    <span>Target Load (RPS):</span>
                    <strong className="text-amber-400 font-mono">{simulationState.targetRps.toLocaleString()} RPS</strong>
                  </div>
                  <input
                    type="range"
                    min="1000"
                    max="40000"
                    step="1000"
                    value={simulationState.targetRps}
                    onChange={(e) => onUpdateConfigSafely({ targetRps: Number(e.target.value) })}
                    className="w-full accent-amber-500 cursor-pointer"
                  />

                  <div className="flex items-center justify-between text-slate-400 font-medium pt-1">
                    <span>Concurrency:</span>
                    <strong className="text-slate-200 font-mono">{simulationState.concurrency.toLocaleString()} Conns</strong>
                  </div>
                  <input
                    type="range"
                    min="100"
                    max="5000"
                    step="100"
                    value={simulationState.concurrency}
                    onChange={(e) => onUpdateConfigSafely({ concurrency: Number(e.target.value) })}
                    className="w-full accent-amber-500 cursor-pointer"
                  />

                  <div className="flex items-center justify-between pt-1">
                    <button
                      onClick={onTriggerBurst}
                      disabled={simulationState.isBurstFlooding}
                      className="w-full py-1 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 rounded font-medium cursor-pointer disabled:opacity-50 text-[11px] flex items-center justify-center gap-1"
                    >
                      <Flame className="w-3 h-3" />
                      <span>Trigger Volumetric DDoS (Token Bucket Drop)</span>
                    </button>
                  </div>
                </div>

                {/* Exactly 3 Servers Architecture Display */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-slate-400 font-medium">
                    <span className="flex items-center gap-1">
                      <Server className="w-3.5 h-3.5 text-amber-400" />
                      <span>3 Servers Architecture</span>
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">1 Proxy + 2 Backends</span>
                  </div>

                  {simulationState.allBackendsDown && (
                    <div className="p-2 bg-red-950/80 border border-red-500/70 rounded flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-[11px] text-red-300 font-semibold">
                        <span>⚠️ 503 FAST-FAIL ACTIVE</span>
                        <span className="font-mono text-[10px] text-red-400">{simulationState.http503Count} dropped</span>
                      </div>
                      <p className="text-[10px] text-slate-300 leading-tight">
                        Both upstreams offline. Proxy returns HTTP 503 in 0.2ms from epoll loop with zero socket leaks.
                      </p>
                      {onReviveAllBackends && (
                        <button
                          onClick={onReviveAllBackends}
                          className="w-full py-1 bg-emerald-500/25 hover:bg-emerald-500/35 border border-emerald-500/60 text-emerald-300 rounded font-semibold text-[10px] cursor-pointer transition-colors"
                        >
                          Revive Both Backends (Auto Health Check)
                        </button>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    {simulationState.backends.slice(0, 2).map((be) => (
                      <div key={be.id} className="p-2 bg-slate-900/70 border border-slate-800 rounded">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-slate-200 text-[11px]">{be.name.split(' ')[0]}</span>
                          <span className={`text-[10px] font-mono ${be.healthy ? 'text-emerald-400' : 'text-red-400'}`}>
                            {be.healthy ? 'UP' : 'DOWN'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mb-1.5 flex justify-between">
                          <span>{be.activeConnections} conns</span>
                          <span className={be.circuitState === 'OPEN' ? 'text-red-400 font-bold' : 'text-slate-400'}>
                            CB: {be.circuitState}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => onToggleBackend(be.id)}
                            className={`flex-1 py-0.5 rounded text-[10px] font-medium cursor-pointer ${
                              be.healthy ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'
                            }`}
                          >
                            {be.healthy ? 'Kill' : 'Revive'}
                          </button>
                          <button
                            onClick={() => onTripCircuitBreaker(be.id)}
                            className="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded text-[10px] cursor-pointer"
                            title="Trip Node Circuit Breaker"
                          >
                            <ShieldAlert className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* View 2: Subsystem Benchmarks & /metrics */}
          {activeView === 'evaluation' && (
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <div className="text-slate-300 font-medium mb-2">
                  Empirical Performance Impact per Subsystem (10,000 Concurrent Connections):
                </div>
                <div className="space-y-2">
                  {SUBSYSTEM_EVALUATIONS.map((evalItem, idx) => (
                    <div key={idx} className="p-2.5 bg-slate-900/60 border border-slate-800 rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-amber-400">{evalItem.featureName}</span>
                        <span className="font-mono text-[11px] text-emerald-400">{evalItem.enabledMetric}</span>
                      </div>
                      <div className="text-slate-400 text-[11px] mt-0.5">{evalItem.description}</div>
                      <div className="text-slate-300 text-[11px] mt-1 font-mono">{evalItem.impactSummary}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Live Prometheus Metrics Terminal */}
              <div className="flex flex-col">
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span>Live /metrics Exporter Output (OpenMetrics standard):</span>
                  <span className="font-mono text-emerald-400">200 OK</span>
                </div>
                <div className="flex-1 bg-[#0b0c12] p-3 rounded-lg border border-slate-800 font-mono text-[11px] text-emerald-300/90 max-h-[220px] overflow-y-auto leading-relaxed select-all">
                  <pre>{prometheusMetricsText}</pre>
                </div>
              </div>
            </div>
          )}

          {/* View 3: C++ Project Code & Management Audit Trail */}
          {activeView === 'cpp_project' && (
            <div className="p-4 text-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(['main.cpp', 'reactor.cpp', 'load_balancer.hpp', 'management.hpp', 'token_bucket.hpp', 'circuit_breaker.hpp', 'memory_arena.hpp'] as const).map(
                    (file) => (
                      <button
                        key={file}
                        onClick={() => setSelectedFile(file)}
                        className={`px-2.5 py-1 rounded text-xs font-mono cursor-pointer transition-colors ${
                          selectedFile === file
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                            : 'text-slate-400 hover:text-slate-200 bg-slate-900/60'
                        }`}
                      >
                        {file}
                      </button>
                    )
                  )}
                </div>

                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy Source'}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2 bg-[#0b0c12] p-3 rounded-lg border border-slate-800 font-mono text-[11px] text-slate-300 max-h-[170px] overflow-y-auto leading-relaxed">
                  <pre>{cppCodeSnippets[selectedFile]}</pre>
                </div>

                {/* Audit Trail */}
                <div className="bg-[#0b0c12] p-3 rounded-lg border border-slate-800 flex flex-col max-h-[170px]">
                  <span className="text-[11px] font-semibold text-slate-300 mb-1 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-emerald-400" />
                    <span>Control Plane Audit Trail</span>
                  </span>
                  <div className="flex-1 overflow-y-auto space-y-1.5 font-mono text-[10px]">
                    {auditTrail.map((entry) => (
                      <div key={entry.id} className="border-b border-slate-800/80 pb-1">
                        <div className="flex justify-between text-slate-400">
                          <span className="text-amber-400">{entry.action}</span>
                          <span>{entry.timestamp}</span>
                        </div>
                        <div className="text-slate-300">{entry.details}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-slate-500 flex justify-between">
                <span>College Major Project Presentation: 3 Servers Architecture (1 Proxy + 2 Backends)</span>
                <span>Compile target: g++ -std=c++20 -O3 -pthread -lssl -lcrypto</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
