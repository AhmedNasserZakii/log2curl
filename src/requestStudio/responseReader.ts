export interface ReadResponseResult {
  bodyText: string;
  sizeBytes: number;
  truncated: boolean;
}

function charsetFromContentType(contentType: string | null): string {
  const match = contentType?.match(/charset\s*=\s*["']?([^;"'\s]+)/i);
  return match?.[1] ?? 'utf-8';
}

export async function readResponseBody(
  response: Response,
  maxBytes: number
): Promise<ReadResponseResult> {
  if (!response.body) {
    return { bodyText: '', sizeBytes: 0, truncated: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let sizeBytes = 0;
  let keptBytes = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { break; }
      sizeBytes += value.byteLength;

      if (keptBytes < maxBytes) {
        const remaining = maxBytes - keptBytes;
        const kept = value.byteLength <= remaining ? value : value.slice(0, remaining);
        chunks.push(kept);
        keptBytes += kept.byteLength;
      }

      if (sizeBytes > maxBytes) {
        truncated = true;
        await reader.cancel('Response exceeded Log2Curl display limit.');
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(keptBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let decoder = new TextDecoder('utf-8');
  try {
    decoder = new TextDecoder(charsetFromContentType(response.headers.get('content-type')));
  } catch { /* keep UTF-8 fallback */ }

  return {
    bodyText: decoder.decode(combined),
    sizeBytes,
    truncated,
  };
}
