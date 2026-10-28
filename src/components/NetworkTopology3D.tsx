/**
 * AetherProxy - High-Fidelity 3D Network Architecture Visualizer
 *
 * Visual Features:
 * - Floating 3D-tracked screen labels for all 7 architectural stations
 * - Interactive click-to-inspect on any component (shows C++ code, inputs, outputs, live metrics)
 * - Dynamic visual responsiveness:
 *   * RPS slider directly scales packet density from 10 to 120+ active laser particles
 *   * Concurrency slider physically drives Backend LED tower heights
 *   * Backend Kill/Revive immediately triggers emergency red visual shutdown and 100% packet reroute
 *   * Circuit Breaker trip manifests as a glowing ruby barrier with 503 deflections
 *   * splice() toggle reveals glowing underdeck kernel plasma conduit vs userspace path
 *   * Token Bucket DDoS burst triggers red packet storm with 429 spark deflections
 * - Exactly 3 servers: Server 01 (Proxy Core), Server 02 (Alpha), Server 03 (Beta)
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SimulationState } from '../types/proxy';
import { X, Info, Code2, ArrowRight } from 'lucide-react';

interface NetworkTopology3DProps {
  simulationState: SimulationState;
  activeCameraPreset: 'overview' | 'reactor' | 'circuit' | 'backends';
  onSelectComponent?: (componentName: string) => void;
}

interface StationInfo {
  id: string;
  name: string;
  badge: string;
  position: THREE.Vector3;
  role: string;
  cppFunction: string;
  description: string;
}

const STATIONS: StationInfo[] = [
  {
    id: 'ingress',
    name: '1. TCP Client Ingress',
    badge: 'Port 8080 / 8443',
    position: new THREE.Vector3(-18, 5.0, 0),
    role: 'Connection Establishment',
    cppFunction: 'accept4(listen_fd, &client_addr, SOCK_NONBLOCK)',
    description: 'Accepts raw client TCP connections, configures non-blocking flags, and hands socket to epoll reactor without evaluating rate limits or upstream routing prematurely.',
  },
  {
    id: 'reactor',
    name: '2. Server 01: Multi-Reactor Core',
    badge: '4 Workers · SO_REUSEPORT',
    position: new THREE.Vector3(-6, 5.5, 0),
    role: 'Event-Driven Dispatch',
    cppFunction: 'epoll_wait(epoll_fd, events, MAX_EVENTS, 200)',
    description: 'Multi-threaded reactor pool bound to same port via SO_REUSEPORT. Distributes incoming connections via kernel 4-tuple hashing and handles edge-triggered I/O.',
  },
  {
    id: 'arena',
    name: 'Shared Memory Arena Facility',
    badge: '64B Aligned Pool',
    position: new THREE.Vector3(-1, 0.4, 5.2),
    role: 'Zero-Malloc Buffer Management',
    cppFunction: 'worker_arena_->acquire_block() / release_block()',
    description: 'Foundational memory slab underlying the workers and buffers. Eliminates glibc heap fragmentation and lock contention by providing pre-allocated 64-byte cache-aligned blocks.',
  },
  {
    id: 'limiter',
    name: '3. Token Bucket Rate Limiter',
    badge: 'Request-Level Guard',
    position: new THREE.Vector3(1.5, 4.5, 0),
    role: 'Traffic Protection',
    cppFunction: 'limiter_->allow_request(client_ip, cost)',
    description: 'Evaluated AFTER parsing HTTP request line and headers. Recharges tokens continuously based on clock timestamps. Drops volumetric abusive spikes with HTTP 429.',
  },
  {
    id: 'router',
    name: '4. Load Balancer & Circuit Breakers',
    badge: 'Least-Conn / Round-Robin',
    position: new THREE.Vector3(7.5, 5.2, 0),
    role: 'Upstream Selection & Isolation',
    cppFunction: 'lb_->select_backend() [checks node->circuit_breaker]',
    description: 'Inspects health and per-node Circuit Breakers (CLOSED / OPEN / HALF_OPEN). Excludes failing nodes, admits half-open test probes, and routes to Alpha or Beta.',
  },
  {
    id: 'backend_alpha',
    name: 'Server 02: Backend Alpha',
    badge: 'Port 8081',
    position: new THREE.Vector3(16, 7.2, -3.5),
    role: 'Upstream HTTP & Health Service',
    cppFunction: 'GET /health JSON status probe + Workload Echo',
    description: 'Active upstream server processing routed traffic. Monitored by the background prober every 2,000 ms. Automatically evicted upon consecutive failures.',
  },
  {
    id: 'backend_beta',
    name: 'Server 03: Backend Beta',
    badge: 'Port 8082',
    position: new THREE.Vector3(16, 7.2, 3.5),
    role: 'Upstream HTTP & Health Service',
    cppFunction: 'GET /health JSON status probe + Workload Echo',
    description: 'Second active upstream server. Shares load dynamically according to active in-flight TCP connections and health checks.',
  },
];

const _vec3A = new THREE.Vector3();
const _vec3Screen = new THREE.Vector3();

export const NetworkTopology3D: React.FC<NetworkTopology3DProps> = ({
  simulationState,
  activeCameraPreset,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<SimulationState>(simulationState);
  stateRef.current = simulationState;

  const [stationScreens, setStationScreens] = useState<{ id: string; x: number; y: number; visible: boolean }[]>([]);
  const [selectedStation, setSelectedStation] = useState<StationInfo | null>(null);

  const targetCameraPos = useRef<THREE.Vector3>(new THREE.Vector3(0, 19, 36));
  const targetCameraLookAt = useRef<THREE.Vector3>(new THREE.Vector3(0, 2, 0));

  useEffect(() => {
    switch (activeCameraPreset) {
      case 'overview':
        targetCameraPos.current.set(0, 19, 36);
        targetCameraLookAt.current.set(0, 2, 0);
        break;
      case 'reactor':
        targetCameraPos.current.set(-6, 11, 15);
        targetCameraLookAt.current.set(-6, 3, 0);
        break;
      case 'circuit':
        targetCameraPos.current.set(5, 10, 14);
        targetCameraLookAt.current.set(5, 3, 0);
        break;
      case 'backends':
        targetCameraPos.current.set(16, 13, 18);
        targetCameraLookAt.current.set(15, 3.5, 0);
        break;
    }
  }, [activeCameraPreset]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0e14);
    scene.fog = new THREE.FogExp2(0x0c0e14, 0.015);

    let width = container.clientWidth || window.innerWidth;
    let height = container.clientHeight || window.innerHeight;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 200);
    camera.position.set(0, 19, 36);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minDistance = 6;
    controls.maxDistance = 85;
    controls.target.set(0, 2, 0);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Studio Lighting
    const keyLight = new THREE.DirectionalLight(0xfff3e0, 2.5);
    keyLight.position.set(16, 25, 20);
    keyLight.castShadow = !isSoftwareGl;
    scene.add(keyLight);

    const fillLight = new THREE.HemisphereLight(0x2d3748, 0x0c0e14, 1.3);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xd97706, 1.6);
    rimLight.position.set(-18, 12, -15);
    scene.add(rimLight);

    // Grid Floor
    const gridHelper = new THREE.GridHelper(90, 45, 0x334155, 0x1e2433);
    gridHelper.position.y = -0.01;
    scene.add(gridHelper);

    const floorGeo = new THREE.PlaneGeometry(120, 120);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x0c0e14, roughness: 0.85, metalness: 0.2 });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = !isSoftwareGl;
    floorMesh.position.y = -0.02;
    scene.add(floorMesh);

    // 0. SHARED MEMORY ARENA FOUNDATION SLAB (Underneath workers and buffers)
    const arenaSlab = new THREE.Mesh(
      new THREE.BoxGeometry(24, 0.28, 13),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3, metalness: 0.85 })
    );
    arenaSlab.position.set(-1, 0.14, 0);
    scene.add(arenaSlab);

    const arenaGrid = new THREE.Mesh(
      new THREE.PlaneGeometry(23.5, 12.5),
      new THREE.MeshBasicMaterial({ color: 0x10b981, wireframe: true, transparent: true, opacity: 0.3 })
    );
    arenaGrid.rotation.x = -Math.PI / 2;
    arenaGrid.position.set(-1, 0.29, 0);
    scene.add(arenaGrid);

    // 1. CLIENT INGRESS (x = -18, z = 0)
    const clientGroup = new THREE.Group();
    clientGroup.position.set(-18, 0, 0);

    const clientBase = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 3.8, 0.6, 32),
      new THREE.MeshStandardMaterial({ color: 0x1a1e29, roughness: 0.35, metalness: 0.8 })
    );
    clientBase.position.y = 0.3;
    clientGroup.add(clientBase);

    const clientTower = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.8, 3.2, 24),
      new THREE.MeshStandardMaterial({ color: 0x242a38, roughness: 0.2, metalness: 0.9 })
    );
    clientTower.position.y = 2.2;
    clientGroup.add(clientTower);

    const clientRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.9, 0.12, 16, 32),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 1.3 })
    );
    clientRing.rotation.x = Math.PI / 2;
    clientRing.position.y = 3.6;
    clientGroup.add(clientRing);
    scene.add(clientGroup);

    // 2. SERVER 01: MULTI-REACTOR CORE (x = -6, z = 0)
    const proxyGroup = new THREE.Group();
    proxyGroup.position.set(-6, 0, 0);

    const proxyBase = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 5.8, 0.8, 48),
      new THREE.MeshStandardMaterial({ color: 0x141822, roughness: 0.4, metalness: 0.7 })
    );
    proxyBase.position.y = 0.4;
    proxyGroup.add(proxyBase);

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 3.8, 32),
      new THREE.MeshStandardMaterial({ color: 0x2b3245, roughness: 0.2, metalness: 0.95 })
    );
    hub.position.y = 2.3;
    proxyGroup.add(hub);

    const hubRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.9, 0.15, 16, 40),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xd97706, emissiveIntensity: 1.8 })
    );
    hubRing.rotation.x = Math.PI / 2;
    hubRing.position.y = 4.0;
    proxyGroup.add(hubRing);

    // 4 Epoll Reactor Workers
    const workerCoils: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const wx = Math.cos(angle) * 3.4;
      const wz = Math.sin(angle) * 3.4;

      const workerGroup = new THREE.Group();
      workerGroup.position.set(wx, 0.8, wz);

      const wCyl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.65, 0.65, 2.8, 24),
        new THREE.MeshStandardMaterial({ color: 0x1e2433, roughness: 0.3, metalness: 0.85 })
      );
      wCyl.position.y = 1.4;
      workerGroup.add(wCyl);

      const coil = new THREE.Mesh(
        new THREE.TorusGeometry(0.8, 0.08, 12, 24),
        new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x059669, emissiveIntensity: 1.5 })
      );
      coil.rotation.x = Math.PI / 2;
      coil.position.y = 1.4;
      workerGroup.add(coil);
      workerCoils.push(coil);

      proxyGroup.add(workerGroup);
    }
    scene.add(proxyGroup);

    // 3. REQUEST-LEVEL TOKEN BUCKET GUARD (x = 1.5, z = 0)
    const parserGroup = new THREE.Group();
    parserGroup.position.set(1.5, 0, 0);

    const parserBase = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 2.2, 0.5, 32),
      new THREE.MeshStandardMaterial({ color: 0x181c26, roughness: 0.4, metalness: 0.8 })
    );
    parserBase.position.y = 0.25;
    parserGroup.add(parserBase);

    const tbRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.12, 16, 40),
      new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x1d4ed8, emissiveIntensity: 1.3 })
    );
    tbRing.rotation.y = Math.PI / 2;
    tbRing.position.y = 2.8;
    parserGroup.add(tbRing);
    scene.add(parserGroup);

    // 4. LOAD BALANCER & INTEGRATED CIRCUIT BREAKERS (x = 7.5, z = 0)
    const lbGroup = new THREE.Group();
    lbGroup.position.set(7.5, 0, 0);

    const lbBase = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 0.6, 4.0),
      new THREE.MeshStandardMaterial({ color: 0x1e2433, roughness: 0.35, metalness: 0.9 })
    );
    lbBase.position.y = 0.3;
    lbGroup.add(lbBase);

    const lbTower = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 3.2, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x2b3245, roughness: 0.2, metalness: 0.95 })
    );
    lbTower.position.y = 2.0;
    lbGroup.add(lbTower);

    const lbBeacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xd97706, emissiveIntensity: 1.8 })
    );
    lbBeacon.position.y = 3.9;
    lbGroup.add(lbBeacon);

    // 503 Cluster Outage Forcefield (Visualized when all backends are down)
    const lbClusterShield = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 2.4, 0.12, 32),
      new THREE.MeshPhysicalMaterial({
        color: 0xef4444,
        emissive: 0xdc2626,
        emissiveIntensity: 2.5,
        transmission: 0.3,
        transparent: true,
        opacity: 0.85,
        roughness: 0.2,
      })
    );
    lbClusterShield.rotation.y = Math.PI / 2;
    lbClusterShield.position.set(1.4, 2.0, 0);
    lbClusterShield.visible = false;
    lbGroup.add(lbClusterShield);

    scene.add(lbGroup);

    // 5. UNDERDECK ZERO-COPY SPLICE PIPE
    const spliceCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(7.5, 0.6, -1.0),
      new THREE.Vector3(11, 0.6, -2.5),
      new THREE.Vector3(15, 2.6, -3.5),
    ]);
    const spliceGeo = new THREE.TubeGeometry(spliceCurve, 24, 0.25, 16, false);
    const spliceMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      emissive: 0xb45309,
      emissiveIntensity: 1.2,
      roughness: 0.25,
      metalness: 0.9,
    });
    const spliceMesh = new THREE.Mesh(spliceGeo, spliceMat);
    scene.add(spliceMesh);

    // 6. EXACTLY 3 SERVERS: Upstream Backend Alpha (:8081) and Beta (:8082)
    const backendRacks: {
      group: THREE.Group;
      chassis: THREE.Mesh;
      loadBar: THREE.Mesh;
      beacon: THREE.Mesh;
      shield: THREE.Mesh;
      baseY: number;
    }[] = [];

    const zOffsets = [-3.5, 3.5];
    for (let i = 0; i < 2; i++) {
      const beGroup = new THREE.Group();
      beGroup.position.set(16, 0, zOffsets[i]);

      const chassis = new THREE.Mesh(
        new THREE.BoxGeometry(2.8, 5.8, 2.8),
        new THREE.MeshStandardMaterial({ color: 0x161a24, roughness: 0.35, metalness: 0.9 })
      );
      chassis.position.y = 2.9;
      beGroup.add(chassis);

      for (let s = 0; s < 5; s++) {
        const blade = new THREE.Mesh(
          new THREE.BoxGeometry(2.85, 0.5, 2.6),
          new THREE.MeshStandardMaterial({ color: 0x222838, roughness: 0.4, metalness: 0.8 })
        );
        blade.position.y = 1.0 + s * 0.95;
        beGroup.add(blade);
      }

      // Connection Load Meter
      const loadBar = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 1, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x059669, emissiveIntensity: 1.8 })
      );
      loadBar.position.set(1.5, 1.0, 0);
      beGroup.add(loadBar);

      // Status Beacon
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.38, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x059669, emissiveIntensity: 2.0 })
      );
      beacon.position.y = 6.2;
      beGroup.add(beacon);

      // Node Circuit Breaker Shield
      const shield = new THREE.Mesh(
        new THREE.CylinderGeometry(1.8, 1.8, 0.12, 32),
        new THREE.MeshPhysicalMaterial({
          color: 0x10b981,
          emissive: 0x059669,
          emissiveIntensity: 1.2,
          transmission: 0.5,
          opacity: 0.85,
          transparent: true,
          roughness: 0.2,
        })
      );
      shield.rotation.y = Math.PI / 2;
      shield.position.set(-2.2, 2.9, 0);
      beGroup.add(shield);

      scene.add(beGroup);
      backendRacks.push({ group: beGroup, chassis, loadBar, beacon, shield, baseY: 1.0 });
    }

    // 7. Dynamic Traveling Packets
    interface ActivePacket {
      mesh: THREE.Mesh;
      type: 'http' | 'splice' | 'tls' | 'ws' | 'dropped_rate' | 'dropped_cb';
      t: number;
      speed: number;
      curve: THREE.CatmullRomCurve3;
      backendIdx: number;
    }

    const packets: ActivePacket[] = [];

    const packetGeo = new THREE.SphereGeometry(0.24, 12, 12);
    const packetMatHttp = new THREE.MeshBasicMaterial({ color: 0x10b981 });
    const packetMatSplice = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
    const packetMatTls = new THREE.MeshBasicMaterial({ color: 0xa855f7 });
    const packetMatWs = new THREE.MeshBasicMaterial({ color: 0x06b6d4 });
    const packetMatDrop = new THREE.MeshBasicMaterial({ color: 0xef4444 });

    const getPacketMaterial = (type: string) => {
      switch (type) {
        case 'splice': return packetMatSplice;
        case 'tls': return packetMatTls;
        case 'ws': return packetMatWs;
        case 'dropped_rate':
        case 'dropped_cb': return packetMatDrop;
        default: return packetMatHttp;
      }
    };

    const createPacketPath = (backendIndex: number, isSplice: boolean, isDropRate: boolean, isDropCb: boolean) => {
      const zTarget = zOffsets[backendIndex];

      if (isDropRate) {
        return new THREE.CatmullRomCurve3([
          new THREE.Vector3(-18, 2.5, 0),
          new THREE.Vector3(-6, 3.2, 0),
          new THREE.Vector3(1.5, 3.0, 0),
          new THREE.Vector3(2.5, 7.5, (Math.random() - 0.5) * 6),
        ]);
      }

      if (isDropCb) {
        if (stateRef.current.allBackendsDown) {
          // Both backends down: Fast-fail deflection right at the Load Balancer (x = 7.5)
          return new THREE.CatmullRomCurve3([
            new THREE.Vector3(-18, 2.5, 0),
            new THREE.Vector3(-6, 3.2, 0),
            new THREE.Vector3(1.5, 3.0, 0),
            new THREE.Vector3(7.4, 3.0, 0), // Hits Load Balancer 503 barrier
            new THREE.Vector3(8.2, 7.5, (Math.random() - 0.5) * 6), // 503 deflection into void
          ]);
        }

        // Single backend circuit broken
        return new THREE.CatmullRomCurve3([
          new THREE.Vector3(-18, 2.5, 0),
          new THREE.Vector3(-6, 3.2, 0),
          new THREE.Vector3(1.5, 3.0, 0),
          new THREE.Vector3(7.5, 3.0, 0),
          new THREE.Vector3(13.8, 3.0, zTarget),
          new THREE.Vector3(13.5, 0.4, zTarget + (Math.random() - 0.5) * 4),
        ]);
      }

      if (isSplice) {
        return new THREE.CatmullRomCurve3([
          new THREE.Vector3(-18, 2.5, 0),
          new THREE.Vector3(-6, 3.0, 0),
          new THREE.Vector3(1.5, 3.0, 0),
          new THREE.Vector3(7.5, 3.0, 0),
          new THREE.Vector3(11.5, 0.8, zTarget * 0.7),
          new THREE.Vector3(16, 2.9, zTarget),
        ]);
      }

      return new THREE.CatmullRomCurve3([
        new THREE.Vector3(-18, 2.5, 0),
        new THREE.Vector3(-6, 3.2, (Math.random() - 0.5) * 1.5),
        new THREE.Vector3(1.5, 3.0, 0),
        new THREE.Vector3(7.5, 3.0, 0),
        new THREE.Vector3(11.5, 3.2, zTarget * 0.8),
        new THREE.Vector3(16, 2.9, zTarget),
      ]);
    };

    let lastSpawnTime = 0;
    let frameId = 0;
    const clock = new THREE.Clock();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      const delta = Math.min(0.1, clock.getDelta());
      const now = performance.now();
      const sim = stateRef.current;
      const sub = sim.subsystems;

      // Smooth camera interpolation
      camera.position.x = THREE.MathUtils.damp(camera.position.x, targetCameraPos.current.x, 3.5, delta);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, targetCameraPos.current.y, 3.5, delta);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, targetCameraPos.current.z, 3.5, delta);

      controls.target.x = THREE.MathUtils.damp(controls.target.x, targetCameraLookAt.current.x, 4.0, delta);
      controls.target.y = THREE.MathUtils.damp(controls.target.y, targetCameraLookAt.current.y, 4.0, delta);
      controls.target.z = THREE.MathUtils.damp(controls.target.z, targetCameraLookAt.current.z, 4.0, delta);
      controls.update();

      // 1. Shared Memory Arena Grid (glowing green 64B cache aligned vs dim gray glibc malloc)
      if (sub.memoryArena) {
        (arenaGrid.material as THREE.MeshBasicMaterial).color.setHex(0x10b981);
        (arenaGrid.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(now * 0.003) * 0.08;
      } else {
        (arenaGrid.material as THREE.MeshBasicMaterial).color.setHex(0x475569);
        (arenaGrid.material as THREE.MeshBasicMaterial).opacity = 0.08;
      }

      // 2. Multi-Reactor Core & SO_REUSEPORT Workers
      const rotSpeed = 0.8 + (sim.currentRps / 8000) * 3.5;
      if (sub.soReusePort) {
        // 4 Epoll workers active (emerald glow, balanced rotation)
        for (let i = 0; i < workerCoils.length; i++) {
          workerCoils[i].rotation.z += delta * rotSpeed * (i % 2 === 0 ? 1 : -1);
          (workerCoils[i].material as THREE.MeshStandardMaterial).color.setHex(0x10b981);
          (workerCoils[i].material as THREE.MeshStandardMaterial).emissive.setHex(0x059669);
          (workerCoils[i].material as THREE.MeshStandardMaterial).emissiveIntensity = 1.5;
        }
      } else {
        // 1 Worker bottleneck: worker 0 spins frantically under high CPU (red/orange), workers 1,2,3 stalled (dim gray)
        workerCoils[0].rotation.z += delta * rotSpeed * 1.8;
        (workerCoils[0].material as THREE.MeshStandardMaterial).color.setHex(0xef4444);
        (workerCoils[0].material as THREE.MeshStandardMaterial).emissive.setHex(0xdc2626);
        (workerCoils[0].material as THREE.MeshStandardMaterial).emissiveIntensity = 2.4;
        for (let i = 1; i < workerCoils.length; i++) {
          (workerCoils[i].material as THREE.MeshStandardMaterial).color.setHex(0x334155);
          (workerCoils[i].material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
          (workerCoils[i].material as THREE.MeshStandardMaterial).emissiveIntensity = 0.0;
        }
      }

      // 3. Request-Level Token Bucket Guard (cyan spin if enforced vs dark inactive if bypassed)
      if (sub.tokenBucketLimiter) {
        tbRing.rotation.x += delta * 1.8;
        (tbRing.material as THREE.MeshStandardMaterial).color.setHex(0x38bdf8);
        (tbRing.material as THREE.MeshStandardMaterial).emissive.setHex(0x0284c7);
        (tbRing.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.5;
      } else {
        (tbRing.material as THREE.MeshStandardMaterial).color.setHex(0x334155);
        (tbRing.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
        (tbRing.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.0;
      }

      // 4. Protocol Mode & Concurrency Ingress Dynamics
      const connRatio = Math.min(1.0, Math.max(0.05, sim.concurrency / 5000));
      clientRing.scale.set(1.0 + connRatio * 0.35, 1.0 + connRatio * 0.35, 1.0);

      if (sim.protocol === 'tls') {
        (clientRing.material as THREE.MeshStandardMaterial).color.setHex(0xc084fc);
        (clientRing.material as THREE.MeshStandardMaterial).emissive.setHex(0x9333ea);
        (clientRing.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.0 + connRatio * 1.5;
        (hubRing.material as THREE.MeshStandardMaterial).color.setHex(0xc084fc);
        (hubRing.material as THREE.MeshStandardMaterial).emissive.setHex(0x9333ea);
      } else {
        (clientRing.material as THREE.MeshStandardMaterial).color.setHex(0x38bdf8);
        (clientRing.material as THREE.MeshStandardMaterial).emissive.setHex(0x0284c7);
        (clientRing.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.8 + connRatio * 1.8;
        (hubRing.material as THREE.MeshStandardMaterial).color.setHex(0xf59e0b);
        (hubRing.material as THREE.MeshStandardMaterial).emissive.setHex(0xd97706);
      }
      hubRing.rotation.z += delta * 1.2;

      // 5. Splice pipe visibility reflects active state (disabled during TLS or outage)
      spliceMesh.visible = sub.spliceZeroCopy && sim.protocol !== 'tls' && !sim.allBackendsDown;

      // 6. 503 Cluster Outage Forcefield (Visualized at Load Balancer when all backends are down)
      lbClusterShield.visible = sim.allBackendsDown;
      if (sim.allBackendsDown) {
        lbClusterShield.rotation.z += delta * 3.0;
        (lbBeacon.material as THREE.MeshStandardMaterial).color.setHex(0xef4444);
        (lbBeacon.material as THREE.MeshStandardMaterial).emissive.setHex(0xdc2626);
      } else {
        (lbBeacon.material as THREE.MeshStandardMaterial).color.setHex(0xf59e0b);
        (lbBeacon.material as THREE.MeshStandardMaterial).emissive.setHex(0xd97706);
      }

      // 7. Update Dual Backends (Alpha & Beta) with Circuit Breaker status
      for (let i = 0; i < 2; i++) {
        const beStatus = sim.backends[i];
        const rack = backendRacks[i];

        // Circuit Breaker shield visibility
        rack.shield.visible = sub.circuitBreaker;

        if (!beStatus || !beStatus.healthy || (sub.circuitBreaker && beStatus.circuitState === 'OPEN')) {
          // Down or Circuit Open -> Tower turns dark red, beacon turns red/amber
          (rack.chassis.material as THREE.MeshStandardMaterial).color.setHex(0x3f1212);
          rack.beacon.material = new THREE.MeshBasicMaterial({
            color: beStatus?.circuitState === 'OPEN' ? 0xf59e0b : 0xef4444,
          });
          rack.loadBar.scale.y = 0.05;

          if (sub.circuitBreaker) {
            (rack.shield.material as THREE.MeshPhysicalMaterial).color.setHex(0xef4444);
            (rack.shield.material as THREE.MeshPhysicalMaterial).emissive.setHex(0xb91c1c);
            (rack.shield.material as THREE.MeshPhysicalMaterial).emissiveIntensity = 2.4;
          }
        } else if (sub.circuitBreaker && beStatus.circuitState === 'HALF_OPEN') {
          (rack.chassis.material as THREE.MeshStandardMaterial).color.setHex(0x161a24);
          rack.beacon.material = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
          (rack.shield.material as THREE.MeshPhysicalMaterial).color.setHex(0xf59e0b);
          (rack.shield.material as THREE.MeshPhysicalMaterial).emissive.setHex(0xb45309);
          (rack.shield.material as THREE.MeshPhysicalMaterial).emissiveIntensity = 1.6;
        } else {
          // Healthy & Eligible
          (rack.chassis.material as THREE.MeshStandardMaterial).color.setHex(0x161a24);
          rack.beacon.material = new THREE.MeshBasicMaterial({ color: 0x10b981 });

          // Scale LED bar dynamically based on absolute active connections:
          // Low concurrency (100 conns, 50/server) = ~0.25 (short bar)
          // Med concurrency (2500 conns, 1250/server) = ~2.4 (half bar)
          // High concurrency (5000 conns, 2500/server) = ~4.8 (towering full bar)
          const targetScale = Math.min(4.8, Math.max(0.2, (beStatus.activeConnections / 2500) * 4.8));
          rack.loadBar.scale.y = THREE.MathUtils.damp(rack.loadBar.scale.y, targetScale, 4.0, delta);
          rack.loadBar.position.y = rack.baseY + rack.loadBar.scale.y * 0.5;

          // Color shift: green at normal load -> amber when server connection capacity exceeds 1,500
          if (beStatus.activeConnections > 1500) {
            (rack.loadBar.material as THREE.MeshBasicMaterial).color.setHex(0xf59e0b);
          } else {
            (rack.loadBar.material as THREE.MeshBasicMaterial).color.setHex(0x10b981);
          }

          if (sub.circuitBreaker) {
            (rack.shield.material as THREE.MeshPhysicalMaterial).color.setHex(0x10b981);
            (rack.shield.material as THREE.MeshPhysicalMaterial).emissive.setHex(0x059669);
            (rack.shield.material as THREE.MeshPhysicalMaterial).emissiveIntensity = 0.8;
          }
        }
      }

      // Max active particles scales directly with RPS slider (from 15 up to 100 particles!)
      const maxParticles = Math.min(100, Math.max(15, Math.floor(sim.currentRps / 350)));
      // Spawn interval shrinks dramatically at high load
      const spawnInterval = Math.max(16, 1200 / Math.max(10, sim.currentRps / 120));

      if (now - lastSpawnTime > spawnInterval && packets.length < maxParticles) {
        lastSpawnTime = now;

        const isAllDown = sim.allBackendsDown;
        const isRateDrop = sub.tokenBucketLimiter && Math.random() < (sim.rateLimitDrops > 0 ? 0.35 : 0);
        const hasOpenCircuit = sim.backends.some(b => b.circuitState === 'OPEN') || isAllDown;
        const isCbDrop = !isRateDrop && (isAllDown || (sub.circuitBreaker && hasOpenCircuit && Math.random() < 0.4));
        const isSplice = !isRateDrop && !isCbDrop && sub.spliceZeroCopy && Math.random() < 0.85;
        const isTls = sim.protocol === 'tls';
        const isWs = sim.protocol === 'websocket';

        let pType: ActivePacket['type'] = 'http';
        if (isRateDrop) pType = 'dropped_rate';
        else if (isCbDrop) pType = 'dropped_cb';
        else if (isSplice) pType = 'splice';
        else if (isTls) pType = 'tls';
        else if (isWs) pType = 'ws';

        // Select candidate backend
        let beIdx = 0;
        const be0Healthy = sim.backends[0]?.healthy && (!sub.circuitBreaker || sim.backends[0]?.circuitState !== 'OPEN');
        const be1Healthy = sim.backends[1]?.healthy && (!sub.circuitBreaker || sim.backends[1]?.circuitState !== 'OPEN');

        if (be0Healthy && be1Healthy) {
          if (sim.algo === 'least-connections') {
            beIdx = (sim.backends[0]?.activeConnections <= sim.backends[1]?.activeConnections) ? 0 : 1;
          } else {
            beIdx = Math.floor(Math.random() * 2);
          }
        } else if (be0Healthy) {
          beIdx = 0;
        } else if (be1Healthy) {
          beIdx = 1;
        }

        const path = createPacketPath(beIdx, isSplice, isRateDrop, isCbDrop);
        const mesh = new THREE.Mesh(packetGeo, getPacketMaterial(pType));
        scene.add(mesh);

        packets.push({
          mesh,
          type: pType,
          t: 0,
          speed: isSplice ? 1.15 : 0.75,
          curve: path,
          backendIdx: beIdx,
        });
      }

      // Update traveling packets
      for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i];
        p.t += delta * p.speed;

        if (p.t >= 1.0) {
          scene.remove(p.mesh);
          packets.splice(i, 1);
        } else {
          p.curve.getPointAt(p.t, _vec3A);
          p.mesh.position.copy(_vec3A);
        }
      }

      // Update 2D Screen Projections for Floating Station Badges
      const screenCoords = STATIONS.map((st) => {
        _vec3Screen.copy(st.position);
        _vec3Screen.project(camera);
        const x = (_vec3Screen.x * 0.5 + 0.5) * width;
        const y = (-(_vec3Screen.y * 0.5) + 0.5) * height;
        const visible = _vec3Screen.z < 1.0;
        return { id: st.id, x, y, visible };
      });
      setStationScreens(screenCoords);

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    const handleResize = () => {
      if (!container) return;
      width = container.clientWidth;
      height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="relative w-full h-full min-h-[420px] bg-[#0c0e14] overflow-hidden select-none cursor-grab active:cursor-grabbing"
    >
      {/* Floating 3D-Projected Station Nameplates */}
      {stationScreens.map((sc) => {
        const station = STATIONS.find((s) => s.id === sc.id);
        if (!station || !sc.visible) return null;

        // Dynamic badge color based on station type and state
        let badgeColor = 'text-amber-400 border-amber-500/40 bg-amber-950/70';
        let extraLiveInfo = '';

        if (station.id === 'backend_alpha') {
          const be = simulationState.backends[0];
          badgeColor = be?.healthy && be?.circuitState !== 'OPEN'
            ? 'text-emerald-400 border-emerald-500/40 bg-emerald-950/70'
            : 'text-red-400 border-red-500/40 bg-red-950/70';
          extraLiveInfo = `${be?.activeConnections || 0} conns · ${be?.healthy ? 'UP' : 'DOWN'}`;
        } else if (station.id === 'backend_beta') {
          const be = simulationState.backends[1];
          badgeColor = be?.healthy && be?.circuitState !== 'OPEN'
            ? 'text-emerald-400 border-emerald-500/40 bg-emerald-950/70'
            : 'text-red-400 border-red-500/40 bg-red-950/70';
          extraLiveInfo = `${be?.activeConnections || 0} conns · ${be?.healthy ? 'UP' : 'DOWN'}`;
        } else if (station.id === 'reactor') {
          if (simulationState.subsystems.soReusePort) {
            badgeColor = 'text-amber-400 border-amber-500/40 bg-amber-950/70';
            extraLiveInfo = `4 Workers (REUSEPORT) · ${simulationState.currentRps.toLocaleString()} req/s`;
          } else {
            badgeColor = 'text-red-400 border-red-500/40 bg-red-950/80';
            extraLiveInfo = '1 Worker (Bottleneck)';
          }
        } else if (station.id === 'token_bucket') {
          if (simulationState.subsystems.tokenBucketLimiter) {
            badgeColor = 'text-blue-400 border-blue-500/40 bg-blue-950/70';
            extraLiveInfo = simulationState.rateLimitDrops > 0 ? `${simulationState.rateLimitDrops} Drops` : 'Enforced (Post-Parse)';
          } else {
            badgeColor = 'text-slate-400 border-slate-600/40 bg-slate-900/70';
            extraLiveInfo = 'Bypassed';
          }
        } else if (station.id === 'load_balancer') {
          if (simulationState.allBackendsDown) {
            badgeColor = 'text-red-400 border-red-500/60 bg-red-950/90';
            extraLiveInfo = '503 Fast-Fail Active';
          } else {
            badgeColor = 'text-amber-400 border-amber-500/40 bg-amber-950/70';
            extraLiveInfo = `${simulationState.algo} · ${simulationState.subsystems.circuitBreaker ? 'CB Armed' : 'CB Off'}`;
          }
        } else if (station.id === 'arena') {
          if (simulationState.subsystems.memoryArena) {
            badgeColor = 'text-emerald-400 border-emerald-500/40 bg-emerald-950/70';
            extraLiveInfo = '64B Aligned Pool';
          } else {
            badgeColor = 'text-slate-400 border-slate-600/40 bg-slate-900/70';
            extraLiveInfo = 'glibc malloc';
          }
        } else if (station.id === 'client') {
          badgeColor = simulationState.protocol === 'tls'
            ? 'text-purple-400 border-purple-500/40 bg-purple-950/70'
            : 'text-sky-400 border-sky-500/40 bg-sky-950/70';
          extraLiveInfo = `${simulationState.protocol.toUpperCase()} · ${simulationState.concurrency} conns`;
        }

        return (
          <div
            key={sc.id}
            style={{
              position: 'absolute',
              left: `${sc.x}px`,
              top: `${sc.y}px`,
              transform: 'translate(-50%, -100%)',
              pointerEvents: 'auto',
            }}
            onClick={() => setSelectedStation(station)}
            className="cursor-pointer group transition-transform hover:scale-105"
          >
            <div className={`px-2.5 py-1 rounded-md border text-[11px] font-sans shadow-lg flex items-center gap-1.5 backdrop-blur-md ${badgeColor}`}>
              <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
              <span className="font-semibold">{station.name}</span>
              {extraLiveInfo && (
                <span className="font-mono text-[10px] opacity-80 border-l border-current/30 pl-1.5">
                  {extraLiveInfo}
                </span>
              )}
            </div>
            {/* Tooltip hint on hover */}
            <div className="hidden group-hover:block text-[9px] font-mono text-slate-300 text-center mt-0.5 bg-black/80 px-1 py-0.5 rounded">
              Click to Inspect C++ Code
            </div>
          </div>
        );
      })}

      {/* Interactive Station Inspector Modal */}
      {selectedStation && (
        <div className="absolute top-16 right-6 z-40 w-96 bg-[#121520]/95 border border-slate-700 shadow-2xl rounded-xl p-4 backdrop-blur-lg text-xs text-slate-200 pointer-events-auto">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
            <div>
              <div className="font-bold text-amber-400 text-sm">{selectedStation.name}</div>
              <div className="text-[11px] text-slate-400 font-mono">{selectedStation.role}</div>
            </div>
            <button
              onClick={() => setSelectedStation(null)}
              className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-slate-300 leading-relaxed mb-3 text-[11px]">
            {selectedStation.description}
          </p>

          <div className="mb-3">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
              Active C++ Network Function:
            </span>
            <div className="bg-[#0b0c12] p-2 rounded border border-slate-800 font-mono text-[11px] text-emerald-300">
              <code>{selectedStation.cppFunction}</code>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
            <span>Station: {selectedStation.badge}</span>
            <span className="text-emerald-400 font-mono">Real-Time Operational</span>
          </div>
        </div>
      )}
    </div>
  );
};
