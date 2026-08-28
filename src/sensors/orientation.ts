/**
 * Device orientation sensor with smoothing and calibration.
 * Handles both iOS (WebKit) and standard DeviceOrientation APIs.
 */

export interface DeviceAttitude {
  /** Compass heading, degrees from true north (0-360) */
  heading: number;
  /** Pitch: device tilt forward/back in radians (-π/2 to π/2) */
  pitch: number;
  /** Roll: device tilt left/right in radians (-π to π) */
  roll: number;
  /** Whether orientation data is available */
  available: boolean;
  /** Estimated heading accuracy in degrees (lower = better) */
  accuracy: number;
}

type OrientationCallback = (attitude: DeviceAttitude) => void;

export class OrientationSensor {
  private _attitude: DeviceAttitude = {
    heading: 0, pitch: 0, roll: 0, available: false, accuracy: 999,
  };
  private _smoothed: DeviceAttitude = { ...this._attitude };
  private _listeners: OrientationCallback[] = [];
  private _listening = false;
  private _smoothingFactor = 0.15;
  private _manualOffset = { yaw: 0, pitch: 0 };
  private _handler: ((e: DeviceOrientationEvent) => void) | null = null;

  get attitude(): DeviceAttitude {
    return {
      ...this._smoothed,
      heading: (this._smoothed.heading + this._manualOffset.yaw * 180 / Math.PI + 360) % 360,
      pitch: this._smoothed.pitch + this._manualOffset.pitch,
    };
  }

  get available(): boolean {
    return this._smoothed.available;
  }

  addManualOffset(dyaw: number, dpitch: number): void {
    this._manualOffset.yaw += dyaw;
    this._manualOffset.pitch += dpitch;
    this._manualOffset.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this._manualOffset.pitch));
  }

  resetManualOffset(): void {
    this._manualOffset = { yaw: 0, pitch: 0 };
  }

  async requestPermission(): Promise<boolean> {
    // iOS 13+ requires explicit permission
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      try {
        const result = await (DeviceOrientationEvent as any).requestPermission();
        return result === 'granted';
      } catch {
        return false;
      }
    }
    return true;
  }

  start(): void {
    if (this._listening) return;
    this._handler = (e: DeviceOrientationEvent) => this._onOrientation(e);
    window.addEventListener('deviceorientation', this._handler, true);
    this._listening = true;
  }

  stop(): void {
    if (!this._listening || !this._handler) return;
    window.removeEventListener('deviceorientation', this._handler, true);
    this._listening = false;
    this._handler = null;
  }

  onUpdate(cb: OrientationCallback): () => void {
    this._listeners.push(cb);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== cb);
    };
  }

  private _onOrientation(e: DeviceOrientationEvent): void {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;

    const alpha = e.alpha; // compass heading (degrees, 0-360)
    const beta = e.beta;   // front-back tilt (-180 to 180)
    const gamma = e.gamma; // left-right tilt (-90 to 90)

    // Heading: alpha is the compass direction the phone top points to
    // When using webkitCompassHeading (iOS), it gives true north directly
    const heading = (e as any).webkitCompassHeading ?? (360 - alpha);
    const accuracy = (e as any).webkitCompassAccuracy ?? 15;

    this._attitude = {
      heading: heading % 360,
      pitch: beta * Math.PI / 180,
      roll: gamma * Math.PI / 180,
      available: true,
      accuracy,
    };

    // Exponential smoothing
    const f = this._smoothingFactor;
    if (!this._smoothed.available) {
      this._smoothed = { ...this._attitude };
    } else {
      // Smooth heading with circular interpolation
      let dh = this._attitude.heading - this._smoothed.heading;
      if (dh > 180) dh -= 360;
      if (dh < -180) dh += 360;
      this._smoothed.heading = (this._smoothed.heading + f * dh + 360) % 360;
      this._smoothed.pitch += f * (this._attitude.pitch - this._smoothed.pitch);
      this._smoothed.roll += f * (this._attitude.roll - this._smoothed.roll);
      this._smoothed.accuracy = this._attitude.accuracy;
      this._smoothed.available = true;
    }

    for (const cb of this._listeners) {
      cb(this.attitude);
    }
  }
}
