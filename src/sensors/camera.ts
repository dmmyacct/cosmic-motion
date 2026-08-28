/**
 * Camera feed management for AR mode.
 * Grabs the rear camera and provides the video element as a texture source.
 */

export class CameraService {
  private _video: HTMLVideoElement | null = null;
  private _stream: MediaStream | null = null;
  private _active = false;

  get video(): HTMLVideoElement | null {
    return this._video;
  }

  get active(): boolean {
    return this._active;
  }

  async start(): Promise<HTMLVideoElement | null> {
    if (this._active && this._video) return this._video;

    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      this._video = document.createElement('video');
      this._video.srcObject = this._stream;
      this._video.setAttribute('playsinline', 'true');
      this._video.setAttribute('autoplay', 'true');
      this._video.muted = true;
      await this._video.play();
      this._active = true;
      return this._video;
    } catch {
      this._active = false;
      return null;
    }
  }

  stop(): void {
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
    if (this._video) {
      this._video.srcObject = null;
      this._video = null;
    }
    this._active = false;
  }
}
