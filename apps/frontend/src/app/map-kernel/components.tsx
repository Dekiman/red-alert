import React, { useMemo, useRef, useState, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Color, Vector3, AdditiveBlending, BackSide, MathUtils, LineBasicMaterial, Quaternion } from "three";
import { latLngToVector3, vector3ToLatLng, wrapLongitude, isPointInPolygon, getSubsolarPoint, getSublunarPoint, getRealTimeEarthRotation } from "./math";
import { OrbitControls, Stars } from "@react-three/drei";
import * as topojson from "topojson-client";

/**
 * Global cache for GeoBoundaries to avoid redundant fetches.
 */
const geoBoundaryCache: Record<string, any> = {};

/**
 * Adaptive Orbit Controls
 */
export function AdaptiveOrbitControls(props: any) {
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();
  const MIN_DIST = 1.4;
  const MAX_DIST = 10.0;

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
  const { lat, lng, radius = 1.2, altitude = 0.012, color = "#ff5837", scale = 1, isPulse = false, showHalo = false, onClick } = props;
  const position = useMemo(() => latLngToVector3(lat, lng, radius + altitude), [lat, lng, radius, altitude]);
  
  return (
    <group position={position}>
      <mesh 
        scale={[0.01 * scale, 0.01 * scale, 0.01 * scale]} 
        renderOrder={30}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
      >
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {(showHalo || isPulse) && (
        <mesh 
          scale={[0.02 * scale, 0.02 * scale, 0.02 * scale]} 
          renderOrder={29}
          onPointerDown={(e) => e.stopPropagation()} // Prevent dragging from triggering through halo
        >
          <sphereGeometry args={[1, 16, 16]} />
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
  
  const [geometry, setGeometry] = useState<Float32Array | null>(null);
  
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
        const positions: number[] = [];

        if (geoMesh.type === "MultiLineString") {
          for (const line of geoMesh.coordinates) {
            for (let i = 0; i < line.length - 1; i++) {
              const p1 = latLngToVector3(line[i][1], line[i][0], radius + altitude);
              const p2 = latLngToVector3(line[i+1][1], line[i+1][0], radius + altitude);
              positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
            }
          }
        } else if (geoMesh.type === "LineString") {
          const line = (geoMesh as any).coordinates;
          for (let i = 0; i < line.length - 1; i++) {
            const p1 = latLngToVector3(line[i][1], line[i][0], radius + altitude);
            const p2 = latLngToVector3(line[i+1][1], line[i+1][0], radius + altitude);
            positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
          }
        }

        if (positions.length > 0) {
          setGeometry(new Float32Array(positions));
        }
      });
  }, [url, radius, altitude]);

  if (!geometry) return null;

  return (
    <lineSegments material={material} renderOrder={10} pointerEvents="none">
      <bufferGeometry onUpdate={self => self.computeBoundingSphere()}>
        <bufferAttribute 
          attach="attributes-position" 
          count={geometry.length / 3} 
          array={geometry} 
          itemSize={3} 
          args={[geometry, 3]} 
        />
      </bufferGeometry>
    </lineSegments>
  );
}

/**
 * LocalityBoundaryLayer Component
 */
export function LocalityBoundaryLayer(props: any) {
  const { radius = 1.2, altitude = 0.012, color = "#4488ff" } = props;
  const [geometry, setGeometry] = useState<Float32Array | null>(null);
  
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
        const positions: number[] = [];
        for (const loc of data.localities) {
          if (loc.polygon && loc.polygon.length > 2) {
            for (let i = 0; i < loc.polygon.length; i++) {
              const p1 = latLngToVector3(loc.polygon[i][0], loc.polygon[i][1], radius + altitude);
              const nextIndex = (i + 1) % loc.polygon.length;
              const p2 = latLngToVector3(loc.polygon[nextIndex][0], loc.polygon[nextIndex][1], radius + altitude);
              positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
            }
          }
        }
        if (positions.length > 0) {
          setGeometry(new Float32Array(positions));
        }
      });
  }, [radius, altitude]);

  if (!geometry) return null;

  return (
    <lineSegments material={material} renderOrder={10} pointerEvents="none">
      <bufferGeometry onUpdate={self => self.computeBoundingSphere()}>
        <bufferAttribute 
          attach="attributes-position" 
          count={geometry.length / 3} 
          array={geometry} 
          itemSize={3} 
          args={[geometry, 3]} 
        />
      </bufferGeometry>
    </lineSegments>
  );
}

/**
 * GeoBoundaryLayer Component
 * Fetches ADM1 or ADM2 boundaries for a specific country from our backend.
 * Uses a global cache to avoid redundant fetches.
 */
export function GeoBoundaryLayer(props: { 
  countryName: string; 
  level?: "ADM1" | "ADM2";
  radius?: number;
  altitude?: number;
  color?: string;
  opacity?: number;
}) {
  const { 
    countryName, 
    level = "ADM1", 
    radius = 1.2, 
    altitude = 0.01, 
    color = "#88ccff",
    opacity = 0.6
  } = props;
  
  const [geometry, setGeometry] = useState<Float32Array | null>(null);
  
  const material = useMemo(() => new LineBasicMaterial({
    color: new Color(color),
    transparent: true,
    opacity: opacity,
    depthWrite: false,
  }), [color, opacity]);

  useEffect(() => {
    if (!countryName) {
      setGeometry(null);
      return;
    }

    const cacheKey = `${countryName}-${level}`;
    if (geoBoundaryCache[cacheKey]) {
      setGeometry(geoBoundaryCache[cacheKey]);
      return;
    }

    const url = `/api/boundary-details?countryName=${encodeURIComponent(countryName)}&level=${level}`;
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error("Boundary not found");
        return res.json();
      })
      .then(async data => {
        let featureCollection = data.featureCollection;

        if (data.staticPath) {
          try {
            const staticResp = await fetch(data.staticPath);
            if (staticResp.ok) {
              const topology = await staticResp.json();
              // In our build script, we name the layer 'boundaries'
              const features = topojson.feature(topology, topology.objects.boundaries as any);
              featureCollection = features.type === "FeatureCollection" ? features : { type: "FeatureCollection", features: [features] };
            }
          } catch (e) {
            console.warn("Failed to fetch static boundary, falling back", e);
          }
        }

        if (!featureCollection) return;
        
        const positions: number[] = [];
        const features = featureCollection.features || [];
        
        for (const feature of features) {
          if (!feature.geometry) continue;
          
          const coords = feature.geometry.type === "Polygon" 
            ? [feature.geometry.coordinates] 
            : feature.geometry.type === "MultiPolygon"
            ? feature.geometry.coordinates
            : [];
            
          for (const polygon of coords) {
            for (const ring of polygon) {
              for (let i = 0; i < ring.length - 1; i++) {
                const p1 = latLngToVector3(ring[i][1], ring[i][0], radius + altitude);
                const p2 = latLngToVector3(ring[i+1][1], ring[i+1][0], radius + altitude);
                positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
              }
            }
          }
        }
        
        const floatArray = positions.length > 0 ? new Float32Array(positions) : null;
        geoBoundaryCache[cacheKey] = floatArray;
        setGeometry(floatArray);
      })
      .catch(() => {
        setGeometry(null);
      });
  }, [countryName, level, radius, altitude]);

  if (!geometry) return null;

  return (
    <lineSegments material={material} renderOrder={11} pointerEvents="none">
      <bufferGeometry onUpdate={self => self.computeBoundingSphere()}>
        <bufferAttribute 
          attach="attributes-position" 
          count={geometry.length / 3} 
          array={geometry} 
          itemSize={3} 
          args={[geometry, 3]} 
        />
      </bufferGeometry>
    </lineSegments>
  );
}

/**
 * AutoGeoBoundaryLayer Component
 * Automatically detects the country under the pointer when zoomed in.
 */
export function AutoGeoBoundaryLayer(props: {
  radius?: number;
  altitude?: number;
  color?: string;
  opacity?: number;
  onHover?: (country: string | null) => void;
}) {
  const { radius = 1.2, altitude = 0.012, color = "#88ccff", opacity = 0.6, onHover } = props;
  const [activeCountry, setActiveCountry] = useState<string | null>(null);
  const [topology, setTopology] = useState<any>(null);

  // Load world topology once for country lookup
  useEffect(() => {
    fetch("/assets/world-countries-50m.json")
      .then(res => res.json())
      .then(data => {
        const objectKey = data.objects.countries ? "countries" : Object.keys(data.objects)[0];
        const features = topojson.feature(data, data.objects[objectKey]) as any;
        setTopology(features.features);
      });
  }, []);

  const handlePointerMove = (e: any) => {
    if (!topology) return;

    const distance = e.camera.position.length();
    // "More than halfway zoomed in" condition: distance < 5.7 (range 1.4 to 10.0)
    if (distance > 5.7) {
      if (activeCountry !== null) {
        setActiveCountry(null);
        onHover?.(null);
      }
      return;
    }

    // Get the lat/lng of the intersection point
    // We need to account for globe rotation
    const rotationY = getRealTimeEarthRotation(new Date());
    const hitLatLng = vector3ToLatLng(e.point);

    // local_lng = world_lng - rotation_y
    const localLng = wrapLongitude(hitLatLng.lng - MathUtils.radToDeg(rotationY));
    const localLat = hitLatLng.lat;

    // Find country
    let foundCountry: string | null = null;
    for (const feature of topology) {
      const geometry = feature.geometry;
      if (!geometry) continue;

      if (geometry.type === "Polygon") {
        if (isPointInPolygon(localLng, localLat, geometry.coordinates)) {
          foundCountry = feature.properties.name;
          break;
        }
      } else if (geometry.type === "MultiPolygon") {
        let insideMulti = false;
        for (const polyCoords of geometry.coordinates) {
          if (isPointInPolygon(localLng, localLat, polyCoords)) {
            insideMulti = true;
            break;
          }
        }
        if (insideMulti) {
          foundCountry = feature.properties.name;
          break;
        }
      }
    }

    if (foundCountry !== activeCountry) {
      setActiveCountry(foundCountry);
      onHover?.(foundCountry);
    }
  };

  const handlePointerOut = () => {
    setActiveCountry(null);
    onHover?.(null);
  };

  return (
    <group>
      {/* Invisible raycasting mesh */}
      <mesh 
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
      >
        <sphereGeometry args={[radius, 64, 64]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {activeCountry && (
        <GeoBoundaryLayer 
          countryName={activeCountry} 
          level="ADM2" 
          radius={radius} 
          altitude={altitude} 
          color={color} 
          opacity={opacity}
        />
      )}
    </group>
  );
}
