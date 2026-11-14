/**
 * Compact encoding for daily series in static files (SPEC §4.2): each value × 10, rounded, stored as
 * little-endian Int16 and base64-encoded. `null` (missing day) is stored as −32768.
 */
export const INT16_NULL = -32768;
export const SERIES_SCALE = 10;

const CHUNK = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeSeries(values: ReadonlyArray<number | null>, scale = SERIES_SCALE): string {
  const view = new DataView(new ArrayBuffer(values.length * 2));
  values.forEach((value, index) => {
    let stored = INT16_NULL;
    if (value !== null) {
      stored = Math.round(value * scale);
      if (!Number.isFinite(stored) || stored <= INT16_NULL || stored > 32767) {
        throw new RangeError(`value ${value} at index ${index} does not fit Int16 × ${scale}`);
      }
    }
    view.setInt16(index * 2, stored, true);
  });
  return bytesToBase64(new Uint8Array(view.buffer));
}

export function decodeSeries(encoded: string, scale = SERIES_SCALE): (number | null)[] {
  const bytes = base64ToBytes(encoded);
  if (bytes.length % 2 !== 0) throw new RangeError("encoded series has an odd number of bytes");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.length / 2 }, (_, index) => {
    const stored = view.getInt16(index * 2, true);
    return stored === INT16_NULL ? null : stored / scale;
  });
}
