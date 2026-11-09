export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return -1;
  let dot = 0; let normA = 0; let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index]; normA += a[index] * a[index]; normB += b[index] * b[index];
  }
  const denominator = Math.sqrt(normA * normB);
  return denominator === 0 ? -1 : dot / denominator;
}

export function averageEmbeddings(samples: number[][]): number[] {
  if (samples.length === 0) throw new Error('Capture at least one clear face first.');
  const output = new Array<number>(samples[0].length).fill(0);
  for (const sample of samples) {
    if (sample.length !== output.length) throw new Error('The face model returned inconsistent embeddings.');
    sample.forEach((value, index) => { output[index] += value / samples.length; });
  }
  const norm = Math.sqrt(output.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) throw new Error('The face template could not be normalized. Try enrolling again.');
  return output.map((value) => value / norm);
}

// Demo threshold only; tune with consenting participants and target devices before any real payments.
export const FACE_MATCH_THRESHOLD = 0.72;
