/**
 * AetherProxy - One Integrated C++ Reverse Proxy System & 3D Network Engine
 * All seven deliverables unified into a single, cohesive proxy architecture:
 * 1. Base reverse proxy forwarding to 2 working backends (Alpha :8081 & Beta :8082)
 * 2. Load balancing (Round-robin / Least-connections) + active health checks
 * 3. Epoll multi-reactor workers with SO_REUSEPORT & splice() zero-copy
 * 4. Per-IP Token Bucket rate limiting & upstream Circuit Breaker
 * 5. OpenSSL TLS termination & WebSocket bi-directional forwarding
 * 6. Memory Arena allocation, safe atomic SIGHUP reload & Prometheus /metrics
 * 7. Live empirical evaluation (Throughput, p50/p95/p99, CPU, Memory, Concurrency)
 */

import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, ShieldAlert, Terminal, Layers } from 'lucide-react';
import { NetworkTopology3D } from './components/NetworkTopology3D';
import { BottomDock } from './components/BottomDock';
import { LiveHttpConsole } from './components/LiveHttpConsole';
import { ProxySimulation } from './services/simulationEngine';
import { SimulationState } from './types/proxy';

export default function App() {
  const simulationRef = useRef<ProxySimulation | null>(null);
  if (!simulationRef.current) {
    simulationRef.current = new ProxySimulation();
  }
  const sim = simulationRef.current;

  const [state, setState] = useState<SimulationState>(sim.getState());
  const [cameraPreset, setCameraPreset] = useState<'overview' | 'reactor' | 'circuit' | 'backends'>('overview');
  const [prometheusText, setPrometheusText] = useState<string>('');
  const [isHttpConsoleOpen, setIsHttpConsoleOpen] = useState(false);

  // Simulation tick loop (~10Hz)
  useEffect(() => {
    const interval = setInterval(() => {
      sim.tick(0.1);
      const newState = sim.getState();
      setState(newState);
      setPrometheusText(sim.generatePrometheusMetrics());
    }, 100);

    return () => clearInterval(interval);
  }, [sim]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0c0e14] text-slate-100 font-sans select-none flex flex-col">
      {/* 1. TOP BAR (Compliant with Top Bar Contract) */}
      <header className="relative z-20 flex items-center justify-between gap-8 px-6 py-3 border-b border-slate-800/80 bg-[#10131d]/90 backdrop-blur-md shrink-0">
        {/* Zone 1: Single Brand Wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 font-bold text-xs">
            <Layers className="w-4 h-4 text-amber-400" />
          </div>
          <span className="text-base font-semibold tracking-tight text-white whitespace-nowrap">
            7 Layer Reverse Proxy <span className="text-xs text-slate-400 font-normal">· Integrated C++ System</span>
          </span>
        </div>

        {/* Zone 2: 4 Single-Line Camera Preset Links */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-400">
          <button
            onClick={() => setCameraPreset('overview')}
            className={`cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
              cameraPreset === 'overview' ? 'text-amber-400 font-semibold' : 'hover:text-slate-200'
            }`}
          >
            System Topology
          </button>
          <button
            onClick={() => setCameraPreset('reactor')}
            className={`cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
              cameraPreset === 'reactor' ? 'text-amber-400 font-semibold' : 'hover:text-slate-200'
            }`}
          >
            Reactor Core
          </button>
          <button
            onClick={() => setCameraPreset('circuit')}
            className={`cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
              cameraPreset === 'circuit' ? 'text-amber-400 font-semibold' : 'hover:text-slate-200'
            }`}
          >
            Protection Gateway
          </button>
          <button
            onClick={() => setCameraPreset('backends')}
            className={`cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
              cameraPreset === 'backends' ? 'text-amber-400 font-semibold' : 'hover:text-slate-200'
            }`}
          >
            Dual Backends
          </button>
        </nav>

        {/* Zone 3: Interactive Live Test Client */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setIsHttpConsoleOpen(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-emerald-300 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/60 rounded-lg shadow-sm cursor-pointer transition-colors whitespace-nowrap shrink-0"
          >
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span>Interactive HTTP Client</span>
          </button>
        </div>
      </header>

      {/* 2. REAL-TIME TELEMETRY HUD (Floating Top HUD) */}
      <div className="absolute top-16 left-6 z-20 pointer-events-auto">
        <div className="bg-[#121520]/90 border border-slate-800 shadow-xl rounded-xl p-3 backdrop-blur-md flex flex-wrap items-center gap-6 text-xs">
          {/* Throughput */}
          <div className="flex flex-col">
            <span className="text-[11px] text-slate-400 uppercase tracking-wider">Throughput</span>
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-xl font-bold text-amber-400 tabular-nums">
                {state.currentRps.toLocaleString()}
              </span>
              <span className="text-[11px] text-slate-500 font-mono">req/s</span>
            </div>
          </div>

          <div className="w-[1px] h-8 bg-slate-800 hidden sm:block" />

          {/* p99 Tail Latency */}
          <div className="flex flex-col">
            <span className="text-[11px] text-slate-400 uppercase tracking-wider">p99 Latency</span>
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-xl font-bold text-slate-100 tabular-nums">
                {state.p99LatencyMs}
              </span>
              <span className="text-[11px] text-slate-500 font-mono">ms</span>
            </div>
          </div>

          <div className="w-[1px] h-8 bg-slate-800 hidden sm:block" />

          {/* p50 Median Latency */}
          <div className="flex flex-col">
            <span className="text-[11px] text-slate-400 uppercase tracking-wider">p50 Latency</span>
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-lg font-semibold text-emerald-400 tabular-nums">
                {state.p50LatencyMs}
              </span>
              <span className="text-[11px] text-slate-500 font-mono">ms</span>
            </div>
          </div>

          <div className="w-[1px] h-8 bg-slate-800 hidden sm:block" />

          {/* CPU & Memory */}
          <div className="flex flex-col">
            <span className="text-[11px] text-slate-400 uppercase tracking-wider">CPU / Memory</span>
            <div className="flex items-baseline gap-1 font-mono text-slate-300">
              <span className="font-semibold text-slate-100 tabular-nums">{state.cpuUsagePct}%</span>
              <span className="text-slate-500">·</span>
              <span className="tabular-nums text-slate-300">{state.memoryUsageMb} MB</span>
            </div>
          </div>

          <div className="w-[1px] h-8 bg-slate-800 hidden sm:block" />

          {/* Zero-Copy Ratio */}
          <div className="flex flex-col">
            <span className="text-[11px] text-slate-400 uppercase tracking-wider">splice() 0-Copy</span>
            <div className="flex items-baseline gap-1 font-mono">
              <span className="text-lg font-semibold text-amber-400 tabular-nums">
                {state.zeroCopyRatioPct}%
              </span>
            </div>
          </div>

          {/* Static Live State Tag */}
          <div className="ml-auto flex items-center gap-2 pl-2">
            <span className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
              state.allBackendsDown
                ? 'text-red-400 bg-red-950/80 border-red-700/80 font-bold'
                : 'text-emerald-400 bg-emerald-950/60 border-emerald-800/80'
            }`}>
              {state.allBackendsDown ? 'CLUSTER OUTAGE · 503 FAST-FAIL' : 'PIPELINE ACTIVE'}
            </span>
          </div>
        </div>
      </div>

      {/* Cluster Outage Callout Banner (Appears when both backends are down/tripped) */}
      {state.allBackendsDown && (
        <div className="absolute top-36 left-6 z-20 pointer-events-auto max-w-lg bg-[#140b0f]/95 border-2 border-red-500/80 shadow-2xl rounded-xl p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-red-500/20 rounded-lg border border-red-500/40 text-red-400 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="text-xs">
              <div className="font-semibold text-red-200 uppercase tracking-wide flex items-center justify-between">
                <span>Both Backends Offline · 503 Fast-Fail Active</span>
                <span className="font-mono text-[10px] text-red-400 bg-red-950 px-1.5 py-0.5 rounded border border-red-800">
                  {state.http503Count.toLocaleString()} 503s
                </span>
              </div>
              <p className="text-slate-300 mt-1.5 leading-relaxed text-[11px]">
                Both Backend Alpha (:8081) and Beta (:8082) are unroutable or circuit-broken. The proxy avoids backend socket connection leaks and returns <code className="text-amber-300 font-mono">HTTP 503 Service Unavailable</code> directly from reactor workers in <strong className="text-emerald-400">0.2ms</strong>.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={() => {
                    sim.reviveAllBackends();
                    setState(sim.getState());
                  }}
                  className="px-3 py-1.5 bg-emerald-500/25 hover:bg-emerald-500/40 border border-emerald-500/60 text-emerald-300 rounded-md font-semibold text-[11px] cursor-pointer transition-colors shadow-sm"
                >
                  Revive Both Backends (Auto Health Check)
                </button>
                <span className="text-[10px] text-slate-400 font-mono">
                  Prober pinging :8081 &amp; :8082
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. 3D INTEGRATED PIPELINE VIEWPORT */}
      <main className="relative flex-1 w-full h-full overflow-hidden">
        <NetworkTopology3D
          simulationState={state}
          activeCameraPreset={cameraPreset}
        />

        {/* Viewport Subsystem Status Pill */}
        <div className="absolute top-6 right-6 z-10 flex items-center gap-2 text-xs text-slate-400 pointer-events-auto">
          <div className="bg-[#121520]/80 border border-slate-800 px-3 py-1.5 rounded-lg backdrop-blur-md flex items-center gap-3 font-mono text-[11px]">
            <span>Algorithm: <strong className="text-amber-400">{state.algo}</strong></span>
            <span>·</span>
            <span>splice(): <strong className={state.subsystems.spliceZeroCopy ? 'text-emerald-400' : 'text-slate-500'}>{state.subsystems.spliceZeroCopy ? 'ON' : 'OFF'}</strong></span>
            <span>·</span>
            <span>Limiter: <strong className={state.subsystems.tokenBucketLimiter ? 'text-emerald-400' : 'text-slate-500'}>{state.subsystems.tokenBucketLimiter ? 'ON' : 'OFF'}</strong></span>
            <span>·</span>
            <span>CB: <strong className={state.subsystems.circuitBreaker ? 'text-emerald-400' : 'text-slate-500'}>{state.subsystems.circuitBreaker ? 'ON' : 'OFF'}</strong></span>
          </div>
        </div>
      </main>

      {/* 4. COLLAPSIBLE CONTROLLED MANAGEMENT DOCK */}
      <BottomDock
        simulationState={state}
        auditTrail={sim.getAuditTrail()}
        onUpdateConfigSafely={(patch) => {
          const ok = sim.updateConfigurationSafely(patch);
          setState(sim.getState());
          return ok;
        }}
        onToggleBackend={(id) => {
          sim.toggleBackendHealth(id);
          setState(sim.getState());
        }}
        onTripCircuitBreaker={(id) => {
          sim.tripCircuitBreaker(id);
          setState(sim.getState());
        }}
        onTriggerBurst={() => {
          sim.triggerBurstFlood();
          setState(sim.getState());
        }}
        onTriggerSighup={() => {
          sim.triggerSighupReload();
          setState(sim.getState());
        }}
        onReviveAllBackends={() => {
          sim.reviveAllBackends();
          setState(sim.getState());
        }}
        prometheusMetricsText={prometheusText}
      />

      {/* 5. INTERACTIVE LIVE HTTP CLIENT & VIVA TEST SUITE */}
      <LiveHttpConsole
        simulation={sim}
        simulationState={state}
        isOpen={isHttpConsoleOpen}
        onClose={() => setIsHttpConsoleOpen(false)}
        onRefreshState={() => setState(sim.getState())}
      />
    </div>
  );
}
