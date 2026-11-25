// src/lib/proofCapture.ts
// ORDER_PROOF_PHOTOS_PLAN.md: the live camera photo and the phone position for a proof photo
// (packing, drop-off, failed drop-off). Live camera only, no gallery (a client rule). The
// position goes to the server with the photo; the server keeps only the distance to the pin.
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import type { ProofPosition } from './api';
import { filePart, type FilePart } from './uploads';

const PROOF_CAMERA: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  cameraType: ImagePicker.CameraType.back,
  allowsEditing: false,
  // No resize library in the app: a lower quality keeps the photo far under the 10 MB limit.
  quality: 0.6,
  exif: false,
};

// A position fix can take long under a roof; past this the photo goes without one (flagged).
const POSITION_TIMEOUT_MS = 15000;

export const CAMERA_BLOCKED =
  'Camera access is blocked. Allow the camera for Carabao Merchant in your phone settings, then try again.';

export class CameraBlockedError extends Error {
  constructor() {
    super(CAMERA_BLOCKED);
  }
}

/** One photo from the live camera, or null when the rider closed the camera. */
export async function takeProofPhoto(kind: 'packing' | 'dropoff' | 'attempt'): Promise<FilePart | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new CameraBlockedError();
  const result = await ImagePicker.launchCameraAsync(PROOF_CAMERA);
  const asset = result.canceled ? null : result.assets?.[0];
  if (!asset) return null;
  return filePart(asset.uri, asset.fileName?.trim() || `${kind}.jpg`, asset.mimeType ?? 'image/jpeg');
}

/**
 * The phone position now, or null (location off, or no fix in time). The server accepts a
 * photo without one and flags it `gps_missing`, so this never stops a delivery.
 */
async function positionFix(): Promise<ProofPosition | null> {
  try {
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), POSITION_TIMEOUT_MS)),
    ]);
    return fix ? { lat: fix.coords.latitude, lng: fix.coords.longitude } : null;
  } catch {
    return null;
  }
}

/**
 * A drop-off or failed drop-off: the photo and the phone position. The location permission is
 * asked first (one system prompt at a time). The fix is taken when the camera closes: Android
 * can stop a "while in use" fix while the system camera is in front. Null when the rider
 * closed the camera.
 */
export async function takeProofAtAddress(
  kind: 'dropoff' | 'attempt',
): Promise<{ photo: FilePart; position: ProofPosition | null } | null> {
  let granted = false;
  try {
    granted = (await Location.requestForegroundPermissionsAsync()).granted;
  } catch {
    granted = false;
  }
  const photo = await takeProofPhoto(kind);
  if (!photo) return null;
  return { photo, position: granted ? await positionFix() : null };
}
