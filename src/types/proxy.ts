/**
 * Unified Architecture Types for AetherProxy
 * Represents the single, integrated C++ reverse proxy pipeline and its subsystems.
 */

export type LoadBalancingAlgo = 'least-connections' | 'round-robin';
export type ProtocolMode = 'http' | 'tls' | 'websocket';
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface BackendStatus {
  id: string;
  name: string;
  port: number;
  healthy: boolean;
  activeConnections: number;
  totalRequests: number;
  latencyMs: number;
  errorCount: number;
  circuitState: CircuitState;
  circuitTrippedUntil: number | null;
  consecutiveFailures: number;
}

// Subsystem toggles inside the single running reverse proxy
export interface ProxySubsystems {
  spliceZeroCopy: boolean;    // Linux splice() zero-copy TCP stream bypass
  tokenBucketLimiter: boolean; // Per-IP token bucket rate limiting
  circuitBreaker: boolean;     // 3-state upstream circuit breaker
  memoryArena: boolean;        // 64-byte aligned arena allocator (vs glibc malloc)
  soReusePort: boolean;        // SO_REUSEPORT multi-reactor worker distribution
  tlsTermination: boolean;     // OpenSSL TLS termination
  webSocketUpgrade: boolean;   // Bi-directional WebSocket frame tunneling
}

export interface SimulationState {
  // Integrated Subsystems Configuration
  subsystems: ProxySubsystems;
  algo: LoadBalancingAlgo;
  protocol: ProtocolMode;
  targetRps: number;
  concurrency: number;
  tokenBucketRate: number;
  tokenBucketBurst: number;
  cbFailureThreshold: number;
  cbCooldownMs: number;

  // Real-time Evaluation Metrics
  currentRps: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  cpuUsagePct: number;
  memoryUsageMb: number;
  activeConnections: number;
  totalRequestsProcessed: number;
  rateLimitDrops: number;
  circuitBreakerTrips: number;
  zeroCopySplicedBytes: number;
  zeroCopyRatioPct: number;

  // Integrated Dual Backends
  backends: BackendStatus[];

  // Live Operations
  isBurstFlooding: boolean;
  isSighupReloading: boolean;
  sighupMessage: string | null;
  activePipelineStage: 'ingress' | 'reactor' | 'protection' | 'protocol' | 'lb' | 'backends';
  allBackendsDown: boolean;
  http503Count: number;
}

export interface SubsystemEvaluation {
  featureName: string;
  description: string;
  enabledMetric: string;
  disabledMetric: string;
  impactSummary: string;
}
