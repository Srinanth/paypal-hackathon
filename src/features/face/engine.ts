import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import jpeg from 'jpeg-js';
import { loadTensorflowModel, type TfliteModel } from 'react-native-fast-tflite';
import type { RNMLKitFace, RNMLKitFaceDetector } from '@infinitered/react-native-mlkit-face-detection';
import { Image } from 'react-native';

// Metro needs a static require to bundle TFLite model assets.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FACENET = require('../../../assets/models/facenet.tflite');
let modelPromise: Promise<TfliteModel> | undefined;

async function getModel(): Promise<TfliteModel> {
  if (!modelPromise) {
    modelPromise = loadTensorflowModel(FACENET, []).catch((error: unknown) => {
      modelPromise = undefined;
      throw error;
    });
  }
  return modelPromise;
}

type FaceProcessingStage = 'Preparing face detector…' | 'Finding one face…' | 'Preparing face crop…' | 'Loading the face model on this phone…' | 'Creating your face sample…';

async function ensureDetectorReady(detector: RNMLKitFaceDetector): Promise<void> {
  if (detector.status === 'init' || detector.status === 'modelLoading') {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 8_000 && (detector.status === 'init' || detector.status === 'modelLoading')) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
  }
  if (detector.status !== 'ready') await detector.initialize();
  if (detector.status !== 'ready') throw new Error('Face detection could not start. Close enrollment, reopen it, and try again.');
}

/** Detect exactly one face, crop it locally, and run FaceNet entirely on this device. */
export async function embedPhoto(detector: RNMLKitFaceDetector, imageUri: string, onStage?: (stage: FaceProcessingStage) => void): Promise<number[]> {
  onStage?.('Preparing face detector…');
  await ensureDetectorReady(detector);
  onStage?.('Finding one face…');
  const result = await detector.detectFaces(imageUri);
  if (!result) throw new Error(detector.status === 'error' ? 'Face detection failed to read this photo. Try another capture.' : 'Face detection returned no result. Try again with your face centered in the guide.');
  // The v5 Android native record contains `faces` and `imagePath`, but omits
  // the `success` and `error` fields declared by the package's TypeScript type.
  // Only treat an explicit false as failure so valid Android results proceed.
  if (result.success === false) throw new Error(result.error || 'Face detection failed to read this photo. Try another capture.');
  if (!Array.isArray(result.faces)) throw new Error('Face detection returned an invalid result. Try another capture.');
  if (result.faces.length === 0) throw new Error('No face found. Look straight at the camera, move closer, and try again.');
  if (result.faces.length > 1) throw new Error('More than one face found. Keep only your face in the camera guide and try again.');
  onStage?.('Preparing face crop…');
  return embedDetectedFace(imageUri, result.faces[0], onStage);
}

export async function embedDetectedFace(imageUri: string, face: RNMLKitFace, onStage?: (stage: FaceProcessingStage) => void): Promise<number[]> {
  const frame = face.frame;
  const width = frame.size.x;
  const height = frame.size.y;
  if (width < 48 || height < 48) throw new Error('Move closer so the face is clear and large enough.');

  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    Image.getSize(imageUri, (imageWidth, imageHeight) => resolve({ width: imageWidth, height: imageHeight }), reject);
  });

  const margin = Math.max(width, height) * 0.18;
  const squareSize = Math.min(Math.max(1, Math.round(Math.max(width, height) + margin * 2)), dimensions.width, dimensions.height);
  const originX = Math.min(Math.max(0, Math.round(frame.origin.x + width / 2 - squareSize / 2)), dimensions.width - squareSize);
  const originY = Math.min(Math.max(0, Math.round(frame.origin.y + height / 2 - squareSize / 2)), dimensions.height - squareSize);
  const manipulated = await ImageManipulator.manipulate(imageUri)
    .crop({ originX, originY, width: squareSize, height: squareSize })
    .resize({ width: 160, height: 160 })
    .renderAsync();
  let cropUri: string | undefined;
  try {
    const image = await manipulated.saveAsync({ base64: true, compress: 0.96, format: SaveFormat.JPEG });
    cropUri = image.uri;
    if (!image.base64) throw new Error('The camera crop could not be read.');
    const binary = globalThis.atob(image.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    if (decoded.width !== 160 || decoded.height !== 160) throw new Error('The face crop has an unexpected size.');

    const input = new Float32Array(160 * 160 * 3);
    let total = 0;
    let totalSquares = 0;
    let outputIndex = 0;
    for (let pixel = 0; pixel < decoded.data.length; pixel += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const value = decoded.data[pixel + channel];
        input[outputIndex++] = value;
        total += value;
        totalSquares += value * value;
      }
    }
    const count = input.length;
    const mean = total / count;
    const variance = Math.max(totalSquares / count - mean * mean, 1 / count);
    const standardDeviation = Math.sqrt(variance);
    for (let index = 0; index < input.length; index += 1) input[index] = (input[index] - mean) / standardDeviation;

    onStage?.('Loading the face model on this phone…');
    const model = await getModel();
    const tensor = model.inputs[0];
    if (tensor.dataType !== 'float32' || tensor.shape.join(',') !== '1,160,160,3') {
      throw new Error('This FaceNet asset does not match the configured input format.');
    }
    onStage?.('Creating your face sample…');
    const output = model.runSync([input.buffer as ArrayBuffer])[0];
    const vector = new Float32Array(output);
    if (vector.length !== 128) throw new Error('This FaceNet asset returned an unexpected embedding size.');
    let norm = 0;
    for (const value of vector) norm += value * value;
    norm = Math.sqrt(norm);
    if (!Number.isFinite(norm) || norm === 0) throw new Error('The face template could not be normalized.');
    return Array.from(vector, (value) => Math.round((value / norm) * 1_000_000) / 1_000_000);
  } finally {
    try { if (cropUri) new File(cropUri).delete(); } catch { /* Best-effort cleanup of a temporary crop. */ }
  }
}
