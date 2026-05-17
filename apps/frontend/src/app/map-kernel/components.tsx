import React, { useMemo, useRef, useState, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Color, Vector3, AdditiveBlending, BackSide, MathUtils, LineBasicMaterial } from "three";
import { latLngToVector3, getSubsolarPoint, getSublunarPoint, getRealTimeEarthRotation } from "./math";
import { OrbitControls, Stars } from "@react-three/drei";
import * as topojson from "topojson-client";

/**
 * Adaptive Orbit Controls
 */
export function AdaptiveOrbitControls(props: any) {
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();
  const MIN_DIST = 1.4;
  const MAX_DIST = 5.0;

  useFrame(() => {
    if (controlsRef.current) {
      const distance = camera.position.length();
      controlsRef.current.rotateSpeed = distance * 0.06;
    }
  });

  return (
    <OrbitControls 
      ref={controlsRef} 
      enableDamping={false}
      minDistance={MIN_DIST}
      maxDistance={MAX_DIST}
      enablePan={false}
      {...props} 
    />
  );
}

/**
 * Starfield background
 */
export function Starfield() {
  return <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />;
}

/**
 * Sun Highlight Material implementation
 */
export function SunHighlight({ sunDirection = [1, 0.2, 0.5], radius = 1.2 }: { sunDirection?: any, radius?: number }) {
  const materialRef = useRef<any>(null);
  const sunDirVector = useMemo(() => {
    const v = new Vector3();
    if (Array.isArray(sunDirection)) {
      v.set(...(sunDirection as [number, number, number]));
    } else if (sunDirection && typeof sunDirection === "object") {
      v.set(sunDirection.x ?? 0, sunDirection.y ?? 0, sunDirection.z ?? 0);
    } else {
      v.set(1, 0.2, 0.5);
    }
    return v.normalize();
  }, [sunDirection]);

  useFrame(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.sunDirection.value.copy(sunDirVector);
    }
  });

  return (
    <mesh>
      <sphereGeometry args={[radius + 0.004, 112, 112]} />
      <shaderMaterial
        ref={materialRef}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        uniforms={{
          sunDirection: { value: sunDirVector },
          highlightColor: { value: new Color("#f2c98d") },
          twilightColor: { value: new Color("#c78b52") },
          highlightStrength: { value: 1 }
        }}
        vertexShader={`
          varying vec3 vSurfaceNormal;
          void main() {
            vSurfaceNormal = normalize(normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform vec3 sunDirection;
          uniform vec3 highlightColor;
          uniform vec3 twilightColor;
          uniform float highlightStrength;
          varying vec3 vSurfaceNormal;

          void main() {
            float sunAmount = dot(normalize(vSurfaceNormal), normalize(sunDirection));
            float alpha = (max(sunAmount, 0.0) * 0.16 + pow(max(sunAmount, 0.0), 2.5) * 0.08) * highlightStrength;
            if (alpha <= 0.001) discard;
            vec3 color = mix(twilightColor, highlightColor, smoothstep(-0.02, 0.32, sunAmount));
            gl_FragColor = vec4(color, alpha);
          }
        `}
      />
    </mesh>
  );
}

/**
 * SunMarker Component
 */
export function SunMarker({ date = new Date(), orbitRadius = 6 }: { date?: Date, orbitRadius?: number }) {
  const position = useMemo(() => {
    const { lat, lng } = getSubsolarPoint(date);
    return latLngToVector3(lat, lng, orbitRadius);
  }, [date, orbitRadius]);

  return (
    <mesh position={position}>
      <sphereGeometry args={[0.2, 32, 32]} />
      <meshBasicMaterial color="#ffdd00" />
    </mesh>
  );
}

/**
 * MoonMarker Component
 */
export function MoonMarker({ date = new Date(), orbitRadius = 5 }: { date?: Date, orbitRadius?: number }) {
  const position = useMemo(() => {
    const { lat, lng } = getSublunarPoint(date);
    return latLngToVector3(lat, lng, orbitRadius);
  }, [date, orbitRadius]);

  return (
    <mesh position={position}>
      <sphereGeometry args={[0.12, 32, 32]} />
      <meshBasicMaterial color="#ffffff" />
    </mesh>
  );
}

/**
 * Globe Component
 */
export function Globe(props: any) {
  const { radius = 1.2, children } = props;
  const globeGroupRef = useRef<any>(null);

  useFrame(() => {
    if (globeGroupRef.current) {
      globeGroupRef.current.rotation.y = getRealTimeEarthRotation(new Date());
    }
  });

  return (
    <group ref={globeGroupRef}>
      <mesh>
        <sphereGeometry args={[radius, 112, 112]} />
        <meshStandardMaterial
          color="#122739"
          emissive="#09131c"
          roughness={0.7}
          metalness={0.2}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[radius * 1.05, 72, 72]} />
        <shaderMaterial
          transparent
          side={BackSide}
          blending={AdditiveBlending}
          uniforms={{
            glowColor: { value: new Color("#4488ff") },
            viewVector: { value: new Vector3(0, 0, 1) }
          }}
          vertexShader={`
            varying vec3 vNormal;
            void main() {
              vNormal = normalize( normalMatrix * normal );
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            uniform vec3 glowColor;
            varying vec3 vNormal;
            void main() {
              float intensity = pow( 0.65 - dot( vNormal, vec3( 0, 0, 1.0 ) ), 2.0 );
              gl_FragColor = vec4( glowColor, intensity * 0.3 );
            }
          `}
        />
      </mesh>
      {children}
    </group>
  );
}

/**
 * Marker3D Component
 */
export function Marker3D(props: any) {
  const { lat, lng, radius = 1.2, altitude = 0.014, color = "#ff5837", scale = 1, isPulse = false, showHalo = false, onClick } = props;
  const position = useMemo(() => latLngToVector3(lat, lng, radius + altitude), [lat, lng, radius, altitude]);
  const groupRef = useRef<any>(null);

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.lookAt(0, 0, 0);
    }
  });

  return (
    <group 
      ref={groupRef} 
      position={position} 
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      <mesh scale={[0.08 * scale, 0.08 * scale, 1]}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} />
      </mesh>
      {(showHalo || isPulse) && (
        <mesh scale={[0.16 * scale, 0.16 * scale, 1]}>
          <circleGeometry args={[1, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.3} />
        </mesh>
      )}
    </group>
  );
}

/**
 * BoundaryLayer Component
 */
export function BoundaryLayer(props: any) {
  const { 
    url = "/assets/world-countries-50m.json", 
    radius = 1.2, 
    altitude = 0.008, 
    color = "#ffffff"
  } = props;
  
  const [geometries, setGeometries] = useState<Float32Array[]>([]);
  
  const material = useMemo(() => new LineBasicMaterial({
    color: new Color(color),
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  }), [color]);

  useEffect(() => {
    fetch(url)
      .then(res => res.json())
      .then(topology => {
        const objectKey = topology.objects.countries ? "countries" : Object.keys(topology.objects)[0];
        if (!objectKey) return;

        const geoMesh = topojson.mesh(topology, topology.objects[objectKey]);
        const next: Float32Array[] = [];

        if (geoMesh.type === "MultiLineString") {
          for (const line of geoMesh.coordinates) {
            const positions: number[] = [];
            for (const [lng, lat] of line) {
              const p = latLngToVector3(lat, lng, radius + altitude);
              positions.push(p.x, p.y, p.z);
            }
            next.push(new Float32Array(positions));
          }
        } else if (geoMesh.type === "LineString") {
          const positions: number[] = [];
          for (const [lng, lat] of (geoMesh as any).coordinates) {
            const p = latLngToVector3(lat, lng, radius + altitude);
            positions.push(p.x, p.y, p.z);
          }
          next.push(new Float32Array(positions));
        }

        setGeometries(next);
      });
  }, [url, radius, altitude]);

  return (
    <group>
      {geometries.map((pos, i) => (
        <lineLoop key={i} material={material} renderOrder={10}>
          <bufferGeometry onUpdate={self => self.computeBoundingSphere()}>
            <bufferAttribute attach="attributes-position" array={pos} count={pos.length / 3} itemSize={3} />
          </bufferGeometry>
        </lineLoop>
      ))}
    </group>
  );
}

/**
 * LocalityBoundaryLayer Component
 */
export function LocalityBoundaryLayer(props: any) {
  const { radius = 1.2, altitude = 0.012, color = "#4488ff" } = props;
  const [geometries, setGeometries] = useState<Float32Array[]>([]);
  
  const material = useMemo(() => new LineBasicMaterial({
    color: new Color(color),
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
  }), [color]);

  useEffect(() => {
    fetch("/api/localities-map")
      .then(res => res.json())
      .then(data => {
        if (!data.localities) return;
        const next: Float32Array[] = [];
        for (const loc of data.localities) {
          if (loc.polygon && loc.polygon.length > 2) {
            const pos: number[] = [];
            for (const [lat, lng] of loc.polygon) {
              const p = latLngToVector3(lat, lng, radius + altitude);
              pos.push(p.x, p.y, p.z);
            }
            // Close the loop
            const start = latLngToVector3(loc.polygon[0][0], loc.polygon[0][1], radius + altitude);
            pos.push(start.x, start.y, start.z);
            next.push(new Float32Array(pos));
          }
        }
        setGeometries(next);
      });
  }, [radius, altitude]);

  return (
    <group>
      {geometries.map((pos, i) => (
        <lineLoop key={i} material={material} renderOrder={10}>
          <bufferGeometry onUpdate={self => self.computeBoundingSphere()}>
            <bufferAttribute attach="attributes-position" array={pos} count={pos.length / 3} itemSize={3} />
          </bufferGeometry>
        </lineLoop>
      ))}
    </group>
  );
}
