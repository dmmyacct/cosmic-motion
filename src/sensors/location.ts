/**
 * Geolocation service. Gets the user's position for astronomical calculations.
 * Falls back to a default location if permission denied.
 */

import type { ObserverLocation } from '../engine/observer';

export class LocationService {
  private _location: ObserverLocation = {
    latDeg: 40.7128,  // NYC default
    lonDeg: -74.0060,
    altitudeKm: 0.01,
  };
  private _resolved = false;
  private _watchId: number | null = null;

  get location(): ObserverLocation {
    return this._location;
  }

  get hasRealLocation(): boolean {
    return this._resolved;
  }

  async request(): Promise<ObserverLocation> {
    if (!navigator.geolocation) return this._location;

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this._location = {
            latDeg: pos.coords.latitude,
            lonDeg: pos.coords.longitude,
            altitudeKm: (pos.coords.altitude ?? 0) / 1000,
          };
          this._resolved = true;
          resolve(this._location);
        },
        () => {
          resolve(this._location);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      );
    });
  }

  startWatching(): void {
    if (!navigator.geolocation || this._watchId !== null) return;
    this._watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this._location = {
          latDeg: pos.coords.latitude,
          lonDeg: pos.coords.longitude,
          altitudeKm: (pos.coords.altitude ?? 0) / 1000,
        };
        this._resolved = true;
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 30000 },
    );
  }

  stopWatching(): void {
    if (this._watchId !== null) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
  }
}
