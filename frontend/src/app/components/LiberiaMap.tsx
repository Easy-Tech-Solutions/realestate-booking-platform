import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';

// ── Fix Leaflet's default icon paths broken by Vite's asset pipeline ─────────
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

// ── Liberia bounding box & default centre ────────────────────────────────────
// Liberia: roughly 4.3°N–8.6°N, 7.4°W–11.5°W
// Centre on Monrovia: 6.3°N, 10.8°W
export const LIBERIA_CENTER: [number, number] = [6.3, -10.8];
export const LIBERIA_ZOOM = 7;
export const MONROVIA_CENTER: [number, number] = [6.3004, -10.7969];
export const MONROVIA_ZOOM = 13;

// ── Brand-coloured marker ────────────────────────────────────────────────────
export function createBrandMarker(hovered = false) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:28px;height:28px;
      background:${hovered ? '#002803' : '#004406'};
      border:3px solid #fff;
      border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
    "></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -30],
  });
}

export function createPriceMarker(price: number, hovered: boolean, currency = 'LRD') {
  const label = currency === 'USD'
    ? `$${price.toLocaleString()}`
    : `L$${price.toLocaleString()}`;
  return L.divIcon({
    className: '',
    html: `<div style="
      background:${hovered ? '#004406' : '#fff'};
      color:${hovered ? '#fff' : '#000'};
      border:2px solid #004406;
      border-radius:20px;
      padding:4px 10px;
      font-size:12px;
      font-weight:700;
      white-space:nowrap;
      box-shadow:0 2px 8px rgba(0,0,0,0.2);
      cursor:pointer;
    ">${label}</div>`,
    iconAnchor: [30, 16],
  });
}

// ── Nominatim geocoder (OpenStreetMap, no API key needed) ────────────────────
const geocodeCache = new Map<string, [number, number] | null>();

export async function geocodeAddress(address: string): Promise<[number, number] | null> {
  const key = address.toLowerCase().trim();
  if (geocodeCache.has(key)) return geocodeCache.get(key)!;

  // Always append Liberia to bias results
  const query = key.includes('liberia') ? key : `${key}, Liberia`;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=lr`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'HomeKonet/1.0' },
    });
    const data = await res.json();
    if (data.length > 0) {
      const coords: [number, number] = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
      geocodeCache.set(key, coords);
      return coords;
    }
  } catch {
    // Silently fall back to Liberia centre
  }
  geocodeCache.set(key, null);
  return null;
}

// ── Helper: are coordinates valid (not 0,0 and within Liberia's bbox) ────────
export function isValidLiberianCoord(lat: number, lng: number): boolean {
  if (!lat || !lng || (lat === 0 && lng === 0)) return false;
  // Loose bbox — accept anything roughly in or near Liberia
  return lat > 2 && lat < 10 && lng > -13 && lng < -7;
}

// ── Fly-to helper used inside MapContainer ───────────────────────────────────
function FlyTo({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, zoom, { duration: 1.2 });
  }, [center, zoom, map]);
  return null;
}

// ── Main component ────────────────────────────────────────────────────────────

interface LiberiaMapProps {
  /** Known lat from backend — may be 0 if not geocoded yet */
  lat?: number;
  lng?: number;
  /** Full address string used for Nominatim fallback */
  address?: string;
  /** Popup label shown on the marker */
  popupLabel?: string;
  className?: string;
  zoom?: number;
}

export function LiberiaMap({
  lat,
  lng,
  address,
  popupLabel,
  className = 'h-[400px] w-full rounded-xl overflow-hidden',
  zoom,
}: LiberiaMapProps) {
  const hasCoords = isValidLiberianCoord(lat ?? 0, lng ?? 0);
  const [resolvedCoords, setResolvedCoords] = useState<[number, number] | null>(
    hasCoords ? [lat!, lng!] : null,
  );
  const [geocoding, setGeocoding] = useState(!hasCoords && Boolean(address));

  useEffect(() => {
    if (hasCoords || !address) return;
    let cancelled = false;
    setGeocoding(true);
    geocodeAddress(address).then((coords) => {
      if (!cancelled) {
        setResolvedCoords(coords);
        setGeocoding(false);
      }
    });
    return () => { cancelled = true; };
  }, [address, hasCoords]);

  const center: [number, number] = resolvedCoords ?? MONROVIA_CENTER;
  const mapZoom = zoom ?? (resolvedCoords ? MONROVIA_ZOOM : LIBERIA_ZOOM);

  return (
    <div className={className}>
      {geocoding && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted/60 rounded-xl">
          <p className="text-sm text-muted-foreground">Locating on map…</p>
        </div>
      )}
      <MapContainer
        center={center}
        zoom={mapZoom}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={false}
        // Restrict panning to a generous area around Liberia
        maxBounds={[[2, -15], [10, -6]]}
        maxBoundsViscosity={0.8}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
          // OpenStreetMap has excellent Liberia coverage
        />
        {resolvedCoords && (
          <>
            <FlyTo center={resolvedCoords} zoom={mapZoom} />
            <Marker position={resolvedCoords} icon={createBrandMarker()}>
              {popupLabel && (
                <Popup>
                  <span className="font-semibold text-sm">{popupLabel}</span>
                </Popup>
              )}
            </Marker>
          </>
        )}
        {!resolvedCoords && !geocoding && (
          // Show Liberia overview with no marker when address couldn't be resolved
          <FlyTo center={LIBERIA_CENTER} zoom={LIBERIA_ZOOM} />
        )}
      </MapContainer>
    </div>
  );
}
