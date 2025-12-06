import React, { useState, useRef, useMemo, useEffect, Suspense } from 'react';
import { Canvas, useFrame, ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { PerspectiveCamera, Environment } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { easing } from 'maath';

// Fix for missing R3F types in JSX
declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

// --- 配置 ---
const CONFIG = {
  colors: {
    bg: '#000000',
    red: '#D00000', gold: '#FFD700', green: '#004225', lightGreen: '#2E8B57', white: '#FFFFFF',
  },
  counts: { foliage: 10000, items: 400, snowflakes: 600 }
};

// --- 几何体工厂 ---
// 使用 lazy 初始化或简单的全局常量工厂
class CaneCurve extends THREE.Curve<THREE.Vector3> {
  constructor() {
    super();
  }
  getPoint(t: number, optionalTarget = new THREE.Vector3()) {
    if (t < 0.6) return optionalTarget.set(0, t * 1.66, 0); 
    const angle = (t - 0.6) / 0.4 * Math.PI; 
    return optionalTarget.set(0.2 - Math.cos(angle) * 0.2, 1.0 + Math.sin(angle) * 0.2, 0);
  }
}

const createStarGeometry = () => {
  const shape = new THREE.Shape();
  const outerRadius = 1; const innerRadius = 0.45; const points = 5;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    const a = (i / (points * 2)) * Math.PI * 2;
    const x = Math.cos(a + Math.PI / 2) * r;
    const y = Math.sin(a + Math.PI / 2) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 });
};

const createBellBodyGeometry = () => {
  const points = [];
  for (let i = 0; i < 10; i++) {
    points.push(new THREE.Vector2(0.5 * Math.pow(i / 10, 0.6) + 0.1, -0.8 + (i / 10) * 1.3));
  }
  points.push(new THREE.Vector2(0.4, -0.9), new THREE.Vector2(0, -0.9)); 
  return new THREE.LatheGeometry(points, 24);
};

// --- 材质与贴图 ---
const useStripedTexture = () => {
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64; 
    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.Texture();
    ctx.fillStyle = '#FFF'; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#C41E3A';
    ctx.beginPath();
    for (let i = -64; i < 128; i += 16) {
        ctx.moveTo(i, 0); ctx.lineTo(i + 10, 64); ctx.lineTo(i + 22, 64); ctx.lineTo(i + 12, 0);
    }
    ctx.fill();
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 3);
    return tex;
  }, []);
};

const SnowParticleMaterial = {
  uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#FFFFFF') } },
  vertexShader: `
    uniform float uTime;
    attribute float aRandom;
    attribute float aSize;
    void main() {
      vec3 pos = position;
      pos.y += sin(uTime + aRandom * 100.0) * 0.02;
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_PointSize = aSize * (30.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    void main() {
      if(distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;
      gl_FragColor = vec4(uColor, 1.0);
    }
  `
};

// --- 共享几何体 Context ---
const GeometryContext = React.createContext<any>(null);

const Geometries = () => {
  const geos = useMemo(() => ({
    star: createStarGeometry(),
    cane: new THREE.TubeGeometry(new CaneCurve(), 32, 0.15, 8, false),
    bell: createBellBodyGeometry(),
    sphere: new THREE.SphereGeometry(0.5, 24, 24),
    giftBox: new THREE.BoxGeometry(0.6, 0.6, 0.6),
    ribbonH: new THREE.BoxGeometry(0.62, 0.62, 0.12),
    ribbonV: new THREE.BoxGeometry(0.12, 0.62, 0.62),
  }), []);
  return geos;
}

// --- 组件 ---

const GiftBox = React.memo(({ color, ribbonColor, ratio = 1 }: { color: string, ribbonColor: string, ratio?: number }) => {
  const geos = React.useContext(GeometryContext);
  return (
    <group scale={[1, ratio, 1]}>
      <mesh geometry={geos.giftBox}>
        <meshStandardMaterial color={color} roughness={0.3} metalness={0.1} />
      </mesh>
      <mesh geometry={geos.ribbonH}>
        <meshStandardMaterial color={ribbonColor} metalness={0.6} roughness={0.2} />
      </mesh>
      <mesh geometry={geos.ribbonV}>
        <meshStandardMaterial color={ribbonColor} metalness={0.6} roughness={0.2} />
      </mesh>
    </group>
  );
});

const ComplexBell = React.memo(() => {
  const geos = React.useContext(GeometryContext);
  return (
    <group scale={[0.4, 0.4, 0.4]}>
      <mesh geometry={geos.bell}>
        <meshStandardMaterial color="#FFD700" metalness={1.0} roughness={0.15} />
      </mesh>
      <mesh position={[0, -0.8, 0]} geometry={geos.sphere} scale={0.3}>
        <meshStandardMaterial color="#333" />
      </mesh>
    </group>
  );
});

function SparkleCap({ radius, count = 50 }: { radius: number, count?: number }) {
  const shaderRef = useRef<THREE.ShaderMaterial>(null);
  const { positions, randoms, sizes } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const rnd = new Float32Array(count);
    const sz = new Float32Array(count);
    for(let i=0; i<count; i++) {
      const u = Math.random(); const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(1 - v * 0.35); 
      const r = radius + 0.01; 
      pos[i*3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i*3+1] = r * Math.cos(phi);
      pos[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
      rnd[i] = Math.random(); sz[i] = Math.random() * 0.4 + 0.3;
    }
    return { positions: pos, randoms: rnd, sizes: sz };
  }, [radius, count]);

  useFrame((state) => { if(shaderRef.current) shaderRef.current.uniforms.uTime.value = state.clock.elapsedTime; });
  return (
    <points>
        <bufferGeometry>
            <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
            <bufferAttribute attach="attributes-aRandom" count={count} array={randoms} itemSize={1} />
            <bufferAttribute attach="attributes-aSize" count={count} array={sizes} itemSize={1} />
        </bufferGeometry>
        {/* @ts-ignore */}
        <shaderMaterial ref={shaderRef} args={[SnowParticleMaterial]} transparent depthWrite={false} />
    </points>
  )
}

const MetalBall = React.memo(({ color }: { color: string }) => {
  const geos = React.useContext(GeometryContext);
  return (
    <group>
      <mesh geometry={geos.sphere}>
        <meshStandardMaterial color={color} metalness={1.0} roughness={0.12} envMapIntensity={2.5} />
      </mesh>
      <SparkleCap radius={0.5} />
    </group>
  );
});

const RealCandyCane = React.memo(() => {
  const geos = React.useContext(GeometryContext);
  const tex = useStripedTexture();
  return (
    <mesh geometry={geos.cane}>
      <meshStandardMaterial map={tex} roughness={0.4} metalness={0.2} />
    </mesh>
  );
});

function RealStar() {
  const ref = useRef<THREE.Group>(null);
  const geos = React.useContext(GeometryContext);
  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.4;
      ref.current.position.y = 7.8 + Math.sin(state.clock.elapsedTime * 1.5) * 0.1;
    }
  });
  return (
    <group ref={ref} position={[0, 7.8, 0]}>
      <mesh geometry={geos.star}>
        <meshStandardMaterial color={CONFIG.colors.gold} emissive={CONFIG.colors.gold} emissiveIntensity={4.0} toneMapped={false} />
      </mesh>
      <pointLight intensity={20} color="#FFD700" distance={10} decay={2} />
    </group>
  );
}

// --- 核心动画系统 ---

const DecorationContent = React.memo(({ item }: { item: any }) => {
   if (item.type === 'red_ball') return <MetalBall color={CONFIG.colors.red} />;
   if (item.type === 'gold_ball') return <MetalBall color={CONFIG.colors.gold} />;
   if (item.type === 'cane') return <RealCandyCane />;
   if (item.type === 'bell') return <ComplexBell />;
   if (item.type === 'gift') return <GiftBox color={item.giftColor} ribbonColor={item.ribbonColor} ratio={item.giftRatio} />;
   return null;
});

function DecorationSystem({ state }: { state: number }) {
  const items = useMemo(() => {
    return new Array(CONFIG.counts.items).fill(0).map((_, i) => {
      const typeRand = Math.random();
      let type = 'red_ball';
      if (typeRand > 0.85) type = 'gift';     
      else if (typeRand > 0.70) type = 'cane'; 
      else if (typeRand > 0.55) type = 'bell'; 
      else if (typeRand > 0.30) type = 'gold_ball'; 

      const p = Math.pow(Math.random(), 0.6); 
      const y = -7 + 14 * (1 - p); 
      let baseR = 5.8; 
      if (type === 'cane') baseR -= 1.0; 
      if (type === 'gift') baseR -= 0.5;

      const r = baseR * p; 
      const angle = Math.random() * Math.PI * 2;
      const targetVec = new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r);

      const cr = 20 + Math.random() * 10;
      const cTheta = Math.random() * Math.PI * 2;
      const cPhi = Math.acos(2 * Math.random() - 1);
      const chaosVec = new THREE.Vector3(cr * Math.sin(cPhi) * Math.cos(cTheta), cr * Math.sin(cPhi) * Math.sin(cTheta), cr * Math.cos(cPhi));

      const randRot = new THREE.Euler(Math.random()*0.5, Math.random()*Math.PI*2, (Math.random()-0.5)*0.5);
      let scale = Math.random() * 0.2 + 0.7;
      let giftRatio = 1;
      let giftColor = CONFIG.colors.green; 
      let ribbonColor = CONFIG.colors.gold;

      if (type === 'gift') {
          scale *= 0.8; 
          const colRnd = Math.random();
          if (colRnd > 0.3) { giftColor = Math.random() > 0.5 ? CONFIG.colors.green : CONFIG.colors.lightGreen; ribbonColor = CONFIG.colors.red; }
          else if (colRnd > 0.15) { giftColor = CONFIG.colors.red; ribbonColor = CONFIG.colors.gold; }
          else { giftColor = CONFIG.colors.gold; ribbonColor = CONFIG.colors.red; }
          if (Math.random() > 0.5) giftRatio = 1.4; 
      }
      if (type === 'cane') scale = 1.0; 

      return { id: i, type, targetVec, chaosVec, randRot, scale, giftColor, ribbonColor, giftRatio };
    });
  }, []);

  const refs = useRef<(THREE.Group | null)[]>([]);

  useFrame((stateObj, delta) => {
    const isAssembled = state > 0.5;
    const time = stateObj.clock.elapsedTime;
    for(let i=0; i<items.length; i++) {
        const ref = refs.current[i];
        if(!ref) continue;
        const item = items[i];
        const target = isAssembled ? item.targetVec : item.chaosVec;
        easing.damp3(ref.position, target, 0.5, delta);
        
        if (isAssembled) {
            if(item.type === 'gift') ref.rotation.y = item.randRot.y + Math.sin(time + item.id) * 0.1;
            else if (item.type !== 'cane') ref.rotation.y += delta * 0.8;
            ref.position.y += Math.sin(time * 2 + item.id) * 0.005;
        } else {
            ref.rotation.x += delta; ref.rotation.z += delta;
        }
    }
  });

  return (
    <group>
      {items.map((item, i) => (
        <group key={item.id} ref={el => { refs.current[i] = el; }} position={item.chaosVec} scale={item.scale} rotation={item.randRot}>
           <DecorationContent item={item} />
        </group>
      ))}
    </group>
  );
}

function FallingSnow() {
  const count = CONFIG.counts.snowflakes;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const particles = useMemo(() => new Array(count).fill(0).map(() => ({
      x: (Math.random() - 0.5) * 60, y: (Math.random() - 0.5) * 50, z: (Math.random() - 0.5) * 40,
      speed: 0.5 + Math.random() * 1.5, factor: Math.random()
  })), []);

  useFrame((state, delta) => {
    if (!mesh.current) return;
    particles.forEach((p, i) => {
      p.y -= p.speed * delta;
      if (p.y < -25) p.y = 25;
      dummy.position.set(p.x + Math.sin(state.clock.elapsedTime+p.factor)*2, p.y, p.z + Math.cos(state.clock.elapsedTime*p.factor)*2);
      dummy.scale.setScalar(0.08); 
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.matrix);
    });
    mesh.current!.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial color="#FFF" transparent opacity={0.6} />
    </instancedMesh>
  );
}

const FoliageMaterial = {
  uniforms: { uTime: { value: 0 }, uProgress: { value: 0 } },
  vertexShader: `
    uniform float uTime; uniform float uProgress;
    attribute vec3 aChaos; attribute vec3 aTarget; attribute float aSize;
    varying float vAlpha;
    float ease(float t) { return t < .5 ? 4. * t * t * t : (t - 1.) * (2. * t - 2.) * (2. * t - 2.) + 1.; }
    void main() {
      float t = ease(uProgress);
      vec3 pos = mix(aChaos, aTarget, t);
      pos.x += sin(uTime * 2.0 + pos.y) * 0.1 * t;
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_PointSize = aSize * (50.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
      vAlpha = 0.5 + 0.5 * sin(uTime * 5.0 + aChaos.y);
    }
  `,
  fragmentShader: `
    varying float vAlpha;
    void main() {
      if (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;
      gl_FragColor = vec4(0.0, 0.5, 0.2, vAlpha); 
    }
  `
};

function Foliage({ state }: { state: number }) {
  const shaderRef = useRef<THREE.ShaderMaterial>(null);
  const { positions, chaos, sizes } = useMemo(() => {
    const pos = [], ch = [], sz = [];
    for (let i = 0; i < CONFIG.counts.foliage; i++) {
      const p = Math.pow(Math.random(), 0.7);
      const y = -7 + 14 * (1 - p);
      const r = 5.5 * p;
      const angle = Math.random() * Math.PI * 2;
      pos.push(Math.cos(angle) * r, y, Math.sin(angle) * r);
      const cr = 25 * Math.cbrt(Math.random());
      const cTheta = Math.random() * Math.PI * 2;
      const cPhi = Math.acos(2 * Math.random() - 1);
      ch.push(cr * Math.sin(cPhi) * Math.cos(cTheta), cr * Math.sin(cPhi) * Math.sin(cTheta), cr * Math.cos(cPhi));
      sz.push(Math.random() * 0.15 + 0.1);
    }
    return { positions: new Float32Array(pos), chaos: new Float32Array(ch), sizes: new Float32Array(sz) };
  }, []);

  useFrame((stateObj, delta) => {
    if (shaderRef.current) {
      shaderRef.current.uniforms.uTime.value = stateObj.clock.elapsedTime;
      easing.damp(shaderRef.current.uniforms.uProgress, 'value', state, 0.5, delta);
    }
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={CONFIG.counts.foliage} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-aTarget" count={CONFIG.counts.foliage} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-aChaos" count={CONFIG.counts.foliage} array={chaos} itemSize={3} />
        <bufferAttribute attach="attributes-aSize" count={CONFIG.counts.foliage} array={sizes} itemSize={1} />
      </bufferGeometry>
      {/* @ts-ignore */}
      <shaderMaterial ref={shaderRef} args={[FoliageMaterial]} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

function Scene({ isPressed, mousePos }: { isPressed: boolean, mousePos: React.MutableRefObject<any> }) {
  const [targetState, setTargetState] = useState(0);
  const geos = Geometries();

  useEffect(() => { setTargetState(isPressed ? 1 : 0); }, [isPressed]);

  useFrame((state) => {
    const mx = (mousePos.current.x / window.innerWidth) * 2 - 1;
    const my = -(mousePos.current.y / window.innerHeight) * 2 + 1;
    state.camera.position.x = THREE.MathUtils.lerp(state.camera.position.x, mx * 10, 0.05);
    state.camera.position.y = THREE.MathUtils.lerp(state.camera.position.y, my * 8, 0.05);
    state.camera.lookAt(0, -1, 0); 
  });

  return (
    <GeometryContext.Provider value={geos}>
      <PerspectiveCamera makeDefault position={[0, 0, 32]} fov={35} />
      <color attach="background" args={[CONFIG.colors.bg]} />
      <Environment preset="city" /> 

      <ambientLight intensity={0.5} />
      <spotLight position={[10, 20, 20]} angle={0.5} intensity={50} color="#FFD700" castShadow />
      <pointLight position={[-10, -5, 10]} intensity={10} color="#E0FFFF" />
      
      <FallingSnow />

      <group position={[0, -2, 0]}>
        <RealStar />
        <Foliage state={targetState} />
        <DecorationSystem state={targetState} />
      </group>

      <EffectComposer enableNormalPass={false}>
        <Bloom luminanceThreshold={0.8} mipmapBlur intensity={1.5} radius={0.5} />
        <Vignette eskil={false} offset={0.1} darkness={0.5} />
      </EffectComposer>
    </GeometryContext.Provider>
  );
}

export default function App() {
  const [isPressed, setIsPressed] = useState(false);
  const mousePos = useRef({ x: 0, y: 0 });

  return (
    <div 
      style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: '#000' }}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      onTouchStart={() => setIsPressed(true)}
      onTouchEnd={() => setIsPressed(false)}
      onMouseMove={(e) => { mousePos.current = { x: e.clientX, y: e.clientY }; }}
    >
      <div style={{ position: 'absolute', zIndex: 10, padding: '40px', width: '100%', pointerEvents: 'none', color: '#FFD700', fontFamily: 'serif', textAlign: 'center' }}>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 4rem)', margin: 0, letterSpacing: '0.2em', textShadow: '0 0 20px rgba(255,215,0,0.6)' }}>MERRY CHRISTMAS</h1>
        <p style={{ opacity: 0.8, letterSpacing: '0.1em', marginTop: '10px' }}>{isPressed ? "Interactive 3D Installation" : "Hold to Assemble"}</p>
      </div>

      <Canvas 
        dpr={[1, 1.5]} 
        gl={{ antialias: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.2 }}
      >
        <Suspense fallback={null}>
          <Scene isPressed={isPressed} mousePos={mousePos} />
        </Suspense>
      </Canvas>
    </div>
  );
}