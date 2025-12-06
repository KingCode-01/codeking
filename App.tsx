import React, { useState, useRef, useMemo, useEffect, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PerspectiveCamera, Stars, Environment } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { easing } from 'maath';

// --- 1. 梦幻配置 ---
const CONFIG = {
  colors: {
    bg: '#000000',
    red: '#D00000',       // 丝绒红
    gold: '#FFD700',      // 24K金
    green: '#004225',     // 英国赛车绿/深松绿
    lightGreen: '#2E8B57',// 海洋绿
    white: '#FFFFFF',
  },
  counts: {
    foliage: 12000,
    items: 480,
    snowflakes: 800,
  }
};

// --- 2. 几何体工厂 ---

const createStarGeometry = () => {
  const shape = new THREE.Shape();
  const outerRadius = 1;
  const innerRadius = 0.45;
  const points = 5;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    const a = (i / (points * 2)) * Math.PI * 2;
    
    // [修复] 角度修改：
    // 之前是 Math.PI / 2 * 3 (270度，朝下)
    // 现在改为 Math.PI / 2 (90度，朝上)
    const x = Math.cos(a + Math.PI / 2) * r;
    const y = Math.sin(a + Math.PI / 2) * r;
    
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 });
};

// 迷你胖拐杖
const createCaneGeometry = () => {
  class CaneCurve extends THREE.Curve<THREE.Vector3> {
    constructor() {
      super();
    }
    
    getPoint(t: number) {
      if (t < 0.6) {
        return new THREE.Vector3(0, t * 1.66, 0); 
      } else {
        const angle = (t - 0.6) / 0.4 * Math.PI; 
        const r = 0.2; 
        const cx = r; 
        const cy = 1.0; 
        return new THREE.Vector3(cx - Math.cos(angle) * r, cy + Math.sin(angle) * r, 0);
      }
    }
  }
  return new THREE.TubeGeometry(new CaneCurve(), 32, 0.15, 8, false);
};

// 铃铛身
const createBellBodyGeometry = () => {
  const points = [];
  for (let i = 0; i < 10; i++) {
    const x = 0.5 * Math.pow(i / 10, 0.6) + 0.1; 
    const y = -0.8 + (i / 10) * 1.3;
    points.push(new THREE.Vector2(x, y));
  }
  points.push(new THREE.Vector2(0.4, -0.9));
  points.push(new THREE.Vector2(0, -0.9)); 
  return new THREE.LatheGeometry(points, 24);
};

// --- 3. 材质与贴图 ---

const useStripedTexture = () => {
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFF'; ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#C41E3A';
    ctx.beginPath();
    for (let i = -128; i < 256; i += 32) {
        ctx.moveTo(i, 0); ctx.lineTo(i + 20, 128); ctx.lineTo(i + 45, 128); ctx.lineTo(i + 25, 0);
    }
    ctx.fill();
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 3);
    return tex;
  }, []);
};

// 雪顶粒子
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
      float d = distance(gl_PointCoord, vec2(0.5));
      if(d > 0.5) discard;
      gl_FragColor = vec4(uColor, 1.0);
    }
  `
};

// --- 4. 组件 ---

// 礼物盒
function GiftBox({ color, ribbonColor, ratio = 1 }: { color: string, ribbonColor: string, ratio?: number }) {
  const width = 0.6;
  const height = 0.6 * ratio;
  const depth = 0.6;
  
  return (
    <group>
      <mesh>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={color} roughness={0.3} metalness={0.1} envMapIntensity={1} />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[width + 0.02, height + 0.02, depth * 0.2]} />
        <meshStandardMaterial color={ribbonColor} metalness={0.6} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[width * 0.2, height + 0.02, depth + 0.02]} />
        <meshStandardMaterial color={ribbonColor} metalness={0.6} roughness={0.2} />
      </mesh>
      <mesh position={[0, height/2, 0]} rotation={[0,0,0.5]} scale={[0.2, 0.2, 0.2]}>
        <torusGeometry args={[0.5, 0.2, 8, 16]} />
        <meshStandardMaterial color={ribbonColor} metalness={0.6} />
      </mesh>
      <mesh position={[0, height/2, 0]} rotation={[0,0,-0.5]} scale={[0.2, 0.2, 0.2]}>
        <torusGeometry args={[0.5, 0.2, 8, 16]} />
        <meshStandardMaterial color={ribbonColor} metalness={0.6} />
      </mesh>
    </group>
  );
}

// 复杂铃铛
function ComplexBell() {
  const bodyGeo = useMemo(() => createBellBodyGeometry(), []);
  return (
    <group scale={[0.4, 0.4, 0.4]}>
      <mesh geometry={bodyGeo}>
        <meshStandardMaterial color="#FFD700" metalness={1.0} roughness={0.15} envMapIntensity={3.0} />
      </mesh>
      <group position={[0, 0.4, 0]} rotation={[0.2, 0, 0]}>
         <mesh position={[0, 0, 0.15]}><sphereGeometry args={[0.15]} /><meshStandardMaterial color={CONFIG.colors.red} roughness={0.3} /></mesh>
         <mesh position={[-0.2, 0, 0]} rotation={[0, 0, 0.5]}><torusGeometry args={[0.15, 0.06, 8, 16]} /><meshStandardMaterial color={CONFIG.colors.red} roughness={0.3} /></mesh>
         <mesh position={[0.2, 0, 0]} rotation={[0, 0, -0.5]}><torusGeometry args={[0.15, 0.06, 8, 16]} /><meshStandardMaterial color={CONFIG.colors.red} roughness={0.3} /></mesh>
      </group>
      <group position={[0, 0.5, -0.1]}>
         <mesh position={[-0.2, 0.1, 0]} rotation={[0, 0, 0.5]}><sphereGeometry args={[0.25]} /><meshStandardMaterial color={CONFIG.colors.green} roughness={0.5} /><group scale={[1, 0.2, 0.5]} /></mesh>
         <mesh position={[0.2, 0.1, 0]} rotation={[0, 0, -0.5]}><sphereGeometry args={[0.25]} /><meshStandardMaterial color={CONFIG.colors.green} roughness={0.5} /><group scale={[1, 0.2, 0.5]} /></mesh>
      </group>
      <mesh position={[0, -0.8, 0]}><sphereGeometry args={[0.15]} /><meshStandardMaterial color="#333" /></mesh>
      <group position={[0, 0.5, 0]} scale={[0.5, 0.5, 0.5]}><SparkleCap radius={0.5} count={30} /></group>
    </group>
  );
}

// 雪顶
function SparkleCap({ radius, count = 80 }: { radius: number, count?: number }) {
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
    <group>
        <points>
            <bufferGeometry>
                <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
                <bufferAttribute attach="attributes-aRandom" count={count} array={randoms} itemSize={1} />
                <bufferAttribute attach="attributes-aSize" count={count} array={sizes} itemSize={1} />
            </bufferGeometry>
            {/* @ts-ignore */}
            <shaderMaterial ref={shaderRef} args={[SnowParticleMaterial]} transparent depthWrite={false} />
        </points>
        <mesh position={[0, radius * 0.85, 0]}><sphereGeometry args={[radius * 0.6, 16, 8, 0, Math.PI*2, 0, Math.PI*0.3]} /><meshBasicMaterial color="#FFF" /></mesh>
    </group>
  )
}

function MetalBall({ color }: { color: string }) {
  return (
    <group>
      <mesh><sphereGeometry args={[0.5, 32, 32]} /><meshStandardMaterial color={color} metalness={1.0} roughness={0.12} envMapIntensity={3.5} /></mesh>
      <SparkleCap radius={0.5} />
    </group>
  );
}

function RealCandyCane({ randRotation }: { randRotation: THREE.Euler }) {
  const geo = useMemo(() => createCaneGeometry(), []);
  const tex = useStripedTexture();
  return (
    <group rotation={randRotation}> 
      <mesh geometry={geo}><meshStandardMaterial map={tex} roughness={0.4} metalness={0.2} /></mesh>
    </group>
  );
}

// 顶星
function RealStar() {
  const geo = useMemo(() => createStarGeometry(), []);
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.4;
      ref.current.position.y = 7.8 + Math.sin(state.clock.elapsedTime * 1.5) * 0.1;
    }
  });
  return (
    <group ref={ref} position={[0, 7.8, 0]} scale={[1, 1, 1]}>
      <mesh geometry={geo}><meshStandardMaterial color={CONFIG.colors.gold} emissive={CONFIG.colors.gold} emissiveIntensity={4.0} toneMapped={false} /></mesh>
      <pointLight intensity={30} color="#FFD700" distance={10} decay={2} />
    </group>
  );
}

// --- 5. 装饰系统 ---

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
      
      let baseR = 5.8; // 45度锥角

      let rFactor = baseR;
      if (type === 'cane') rFactor = baseR - 1.0; 
      if (type === 'gift') rFactor = baseR - 0.5;

      const r = rFactor * p; 
      const angle = Math.random() * Math.PI * 2;
      const target = [Math.cos(angle) * r, y, Math.sin(angle) * r];

      const cr = 20 + Math.random() * 10;
      const cTheta = Math.random() * Math.PI * 2;
      const cPhi = Math.acos(2 * Math.random() - 1);
      const chaos = [cr * Math.sin(cPhi) * Math.cos(cTheta), cr * Math.sin(cPhi) * Math.sin(cTheta), cr * Math.cos(cPhi)];

      const randRot = new THREE.Euler(
        Math.random() * 0.5, 
        Math.random() * Math.PI * 2, 
        (Math.random() - 0.5) * 0.5
      );

      let scale = Math.random() * 0.2 + 0.7;
      let giftRatio = 1;
      let giftColor = CONFIG.colors.green; 
      let ribbonColor = CONFIG.colors.gold;

      if (type === 'gift') {
          scale *= 0.8; 
          const colRnd = Math.random();
          if (colRnd > 0.3) {
             giftColor = Math.random() > 0.5 ? CONFIG.colors.green : CONFIG.colors.lightGreen;
             ribbonColor = CONFIG.colors.red;
          } else if (colRnd > 0.15) {
             giftColor = CONFIG.colors.red;
             ribbonColor = CONFIG.colors.gold;
          } else {
             giftColor = CONFIG.colors.gold;
             ribbonColor = CONFIG.colors.red;
          }
          if (Math.random() > 0.5) giftRatio = 1.4; 
      }
      
      if (type === 'cane') scale = 1.0; 

      return { id: i, type, target, chaos, randRot, scale, giftColor, ribbonColor, giftRatio };
    });
  }, []);

  return (
    <group>
      {items.map((item) => (
        <DecorationItem key={item.id} item={item} state={state} />
      ))}
    </group>
  );
}

function DecorationItem({ item, state }: any) {
  const ref = useRef<THREE.Group>(null);
  
  useFrame((stateObj, delta) => {
    if(!ref.current) return;
    const targetVec = state > 0.5 ? new THREE.Vector3(...item.target) : new THREE.Vector3(...item.chaos);
    easing.damp3(ref.current.position, targetVec, 0.5, delta);
    
    if (state > 0.5) {
       if(item.type === 'cane') {
       } else if (item.type === 'gift') {
           ref.current.rotation.y = item.randRot.y + Math.sin(stateObj.clock.elapsedTime + item.id) * 0.1;
       } else {
           ref.current.rotation.y += delta * 0.8;
       }
       ref.current.position.y += Math.sin(stateObj.clock.elapsedTime * 2 + item.id) * 0.005;
    } else {
       ref.current.rotation.x += delta; ref.current.rotation.z += delta;
    }
  });

  return (
    <group ref={ref} position={item.chaos} scale={item.scale} rotation={item.randRot}>
       {item.type === 'red_ball' && <MetalBall color={CONFIG.colors.red} />}
       {item.type === 'gold_ball' && <MetalBall color={CONFIG.colors.gold} />}
       {item.type === 'cane' && <RealCandyCane randRotation={new THREE.Euler(0,0,0)} />}
       {item.type === 'bell' && <ComplexBell />}
       {item.type === 'gift' && <GiftBox color={item.giftColor} ribbonColor={item.ribbonColor} ratio={item.giftRatio} />}
    </group>
  );
}

// --- 6. 环境飘雪 ---
function FallingSnow() {
  const count = CONFIG.counts.snowflakes;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const particles = useMemo(() => new Array(count).fill(0).map(() => ({
      x: (Math.random() - 0.5) * 60,
      y: (Math.random() - 0.5) * 50,
      z: (Math.random() - 0.5) * 40,
      speed: 0.5 + Math.random() * 1.5,
      factor: Math.random()
  })), []);

  useFrame((state, delta) => {
    if (!mesh.current) return;
    particles.forEach((p, i) => {
      p.y -= p.speed * delta;
      if (p.y < -25) p.y = 25;
      dummy.position.set(
        p.x + Math.sin(state.clock.elapsedTime + p.factor) * 2,
        p.y,
        p.z + Math.cos(state.clock.elapsedTime * p.factor) * 2
      );
      dummy.scale.setScalar(0.08); 
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial color="#FFF" transparent opacity={0.6} />
    </instancedMesh>
  );
}

// 针叶
const FoliageMaterial = {
  uniforms: { uTime: { value: 0 }, uProgress: { value: 0 } },
  vertexShader: `
    uniform float uTime;
    uniform float uProgress;
    attribute vec3 aChaos;
    attribute vec3 aTarget;
    attribute float aSize;
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

// --- 7. 场景 ---

function Scene({ isPressed, mousePos }: { isPressed: boolean, mousePos: React.MutableRefObject<any> }) {
  const [targetState, setTargetState] = useState(0);
  useEffect(() => { setTargetState(isPressed ? 1 : 0); }, [isPressed]);

  useFrame((state) => {
    const mx = (mousePos.current.x / window.innerWidth) * 2 - 1;
    const my = -(mousePos.current.y / window.innerHeight) * 2 + 1;
    const targetX = mx * 10;
    const targetY = my * 8;
    state.camera.position.x = THREE.MathUtils.lerp(state.camera.position.x, targetX, 0.05);
    state.camera.position.y = THREE.MathUtils.lerp(state.camera.position.y, targetY, 0.05);
    state.camera.lookAt(0, -1, 0); 
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, 32]} fov={35} />
      <color attach="background" args={[CONFIG.colors.bg]} />
      
      <Environment preset="warehouse" background={false} /> 

      <ambientLight intensity={0.2} />
      <spotLight position={[10, 20, 20]} angle={0.5} intensity={50} color="#FFD700" castShadow />
      <pointLight position={[-10, -5, 10]} intensity={20} color="#E0FFFF" />
      
      <FallingSnow />

      <group position={[0, -2, 0]}>
        <RealStar />
        <Foliage state={targetState} />
        <DecorationSystem state={targetState} />
      </group>

      <EffectComposer enableNormalPass={false}>
        <Bloom luminanceThreshold={0.8} mipmapBlur intensity={1.8} radius={0.6} />
        <Vignette eskil={false} offset={0.1} darkness={0.5} />
      </EffectComposer>
    </>
  );
}

// --- 8. 入口 ---

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
      <div style={{ position: 'absolute', zIndex: 10, padding: '40px', width: '100%', pointerEvents: 'none', color: '#FFD700', fontFamily: 'serif' }}>
        <h1 style={{ fontSize: '3rem', margin: 0, letterSpacing: '0.2em', textShadow: '0 0 20px rgba(255,215,0,0.6)' }}>MERRY CHRISTMAS</h1>
        <p style={{ opacity: 0.8, letterSpacing: '0.1em' }}>{isPressed ? "Interactive 3D Installation" : "Hold to Assemble"}</p>
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