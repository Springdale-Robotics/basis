/**
 * Is this photograph worth uploading?
 *
 * The question is asked while the binder is still open, because that is the
 * only moment it is cheap to answer. Discovering thirty unreadable pages the
 * next morning means fetching the binder back off the shelf; refusing one
 * costs a couple of seconds and a second tap.
 *
 * ## What these numbers are, and are not
 *
 * Measured against a real photograph of a handwritten recipe card
 * (2026-08-16), sharpness scored as the variance of the Laplacian over a
 * downscaled greyscale copy:
 *
 *   as taken                1685
 *   gaussian blur sigma=3    491
 *   gaussian blur sigma=5    125
 *   very dark, in focus       74
 *   photographed from afar  1671
 *
 * Three things follow, and they set the shape of this file:
 *
 * 1. Sharpness separates out-of-focus photographs well.
 * 2. It cannot tell dark from blurry — an in-focus but underexposed frame
 *    scores *below* a badly blurred one. So brightness is measured separately.
 *    Telling somebody to hold still when they need to turn a light on is worse
 *    than saying nothing.
 * 3. It does not notice a photograph taken from too far away, which scored 99%
 *    of sharp while being equally unreadable. Nothing here catches that yet.
 *
 * The absolute number also depends on the subject — a dense printed page will
 * not score like a sparse handwritten card — so the thresholds are set low, to
 * catch only what is beyond argument. A frame that scrapes past is a frame the
 * reader will probably cope with; a false accusation costs trust and a retake.
 *
 * Untested: real motion blur, which is the likeliest cause in practice. An
 * attempt to simulate it produced 98% of sharp, i.e. it never blurred
 * anything, so there is no evidence here either way.
 */

export type PhotoVerdict =
  | { usable: true }
  | { usable: false; reason: string; advice: string };

/** Below this mean luminance (0–255) the page is too dark to read back. */
const MIN_BRIGHTNESS = 40;

/** Below this Laplacian variance a frame is unusable by any reading. */
const MIN_SHARPNESS = 150;

/** Long edge of the copy the measurements run on. Small is fine and fast. */
const SAMPLE_EDGE = 480;

export interface PhotoMeasurements {
  sharpness: number;
  brightness: number;
}

/**
 * Measure a captured frame. Cheap enough to run between shots: a few
 * milliseconds on a downscaled copy.
 */
export function measureFrame(source: CanvasImageSource, width: number, height: number): PhotoMeasurements | null {
  const scale = Math.min(1, SAMPLE_EDGE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(source, 0, 0, w, h);

  let pixels: Uint8ClampedArray;
  try {
    pixels = context.getImageData(0, 0, w, h).data;
  } catch {
    // A tainted canvas, which shouldn't happen for our own camera frames.
    return null;
  }

  // Greyscale once, then work on that.
  const grey = new Float32Array(w * h);
  let brightnessTotal = 0;
  for (let i = 0, p = 0; i < grey.length; i++, p += 4) {
    const value = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
    grey[i] = value;
    brightnessTotal += value;
  }

  // Variance of the 4-neighbour Laplacian, skipping the border.
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const laplacian = -4 * grey[i] + grey[i - 1] + grey[i + 1] + grey[i - w] + grey[i + w];
      sum += laplacian;
      sumSquares += laplacian * laplacian;
      count++;
    }
  }

  if (count === 0) return null;
  const mean = sum / count;

  return {
    sharpness: sumSquares / count - mean * mean,
    brightness: brightnessTotal / grey.length,
  };
}

/**
 * Turn measurements into something worth saying.
 *
 * Brightness is checked first because it is the more specific complaint: a
 * dark frame is also an unsharp one, and "there isn't enough light" is
 * actionable in a way that "this looks blurry" is not.
 */
export function judgeFrame(measurements: PhotoMeasurements | null): PhotoVerdict {
  // No measurement is not evidence of a bad photograph.
  if (!measurements) return { usable: true };

  if (measurements.brightness < MIN_BRIGHTNESS) {
    return {
      usable: false,
      reason: 'That page came out very dark.',
      advice: 'More light on the page, or move out of your own shadow.',
    };
  }

  if (measurements.sharpness < MIN_SHARPNESS) {
    return {
      usable: false,
      reason: 'That page came out blurry.',
      advice: 'Hold still for a moment and let the camera focus before tapping.',
    };
  }

  return { usable: true };
}
