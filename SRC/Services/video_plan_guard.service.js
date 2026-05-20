'use strict';

const { UnrecoverableError } = require('bullmq');

/**
 * Tenta extrair duração aproximada de um MP4/MOV (atom `mvhd`) do buffer.
 * Retorna `null` se não for MP4 reconhecível ou atom ausente.
 */
function readMp4MvhdDurationSeconds(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 32) return null;
  const findBox = (buf, typeStr, start, end) => {
    let off = start;
    while (off + 8 <= end && off + 8 <= buf.length) {
      let size = buf.readUInt32BE(off);
      const typ = buf.toString('ascii', off + 4, off + 8);
      if (size < 8) return null;
      const boxStart = off + 8;
      const boxEnd = Math.min(off + size, end, buf.length);
      if (typ === typeStr) return { start: boxStart, end: boxEnd, containerSize: size };
      if (typ === 'moov' || typ === 'trak' || typ === 'mdia' || typ === 'minf' || typ === 'stbl') {
        const inner = findBox(buf, typeStr, boxStart, boxEnd);
        if (inner) return inner;
      }
      off += size;
    }
    return null;
  };
  const scan = Math.min(buffer.length, 12 * 1024 * 1024);
  const mvhd = findBox(buffer, 'mvhd', 0, scan);
  if (!mvhd) return null;
  const { start } = mvhd;
  if (start + 20 > buffer.length) return null;
  const version = buffer.readUInt8(start);
  let timescale;
  let duration;
  if (version === 1) {
    if (start + 32 > buffer.length) return null;
    timescale = buffer.readUInt32BE(start + 20);
    const hi = buffer.readUInt32BE(start + 24);
    const lo = buffer.readUInt32BE(start + 28);
    duration = hi * 0x100000000 + lo;
  } else {
    timescale = buffer.readUInt32BE(start + 12);
    duration = buffer.readUInt32BE(start + 16);
  }
  if (!timescale || timescale <= 0) return null;
  return duration / timescale;
}

/** Valida vídeo antes de gastar APIs caras (Deepgram). */
function assertVideoWithinPlanGuards({
  buffer,
  limits,
  metaVideoDurationSeconds,
  ingestMetadata,
}) {
  const maxMbRaw = limits.max_video_size_mb;
  const maxSecRaw = limits.max_video_duration_seconds;
  const maxMb = Number(maxMbRaw);
  const maxSec =
    maxSecRaw === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : Number(maxSecRaw);

  const sizeBytes = Buffer.isBuffer(buffer) ? buffer.length : 0;

  /** Cota ZERO (sem assinatura): qualquer arquivo com conteúdo é bloqueado. */
  if (Number.isFinite(maxMb) && maxMb <= 0 && sizeBytes > 0) {
    throw new UnrecoverableError(`video_blocked_zero_plan_max_size_mb:${sizeBytes}`);
  }

  /** Limite Infinity (bypass Super Admin): não há teto por tamanho. */
  const maxBytes =
    maxMbRaw === Number.POSITIVE_INFINITY
      ? null
      : Number.isFinite(maxMb) && maxMb > 0
        ? maxMb * 1024 * 1024
        : null;
  if (maxBytes !== null && sizeBytes > maxBytes) {
    throw new UnrecoverableError(
      `video_exceeds_max_size_mb:${maxMb}:actual_mb:${(sizeBytes / (1024 * 1024)).toFixed(2)}`,
    );
  }

  const hints = [
    metaVideoDurationSeconds,
    ingestMetadata?.metaVideoLengthSeconds,
    ingestMetadata?.graphVideoLengthSeconds,
  ];

  /** @type {number|null} */
  let dur = null;
  for (const h of hints) {
    const n = h != null ? Number(h) : NaN;
    if (Number.isFinite(n) && n > 0) {
      dur = n;
      break;
    }
  }
  if (dur == null) {
    const parsed = readMp4MvhdDurationSeconds(buffer);
    if (parsed != null && Number.isFinite(parsed) && parsed > 0) dur = parsed;
  }

  if (
    dur != null &&
    Number.isFinite(maxSec) &&
    maxSec <= 0 &&
    dur > 0
  ) {
    throw new UnrecoverableError(
      `video_blocked_zero_plan_max_duration_seconds:actual:${dur.toFixed(2)}`,
    );
  }
  if (
    dur != null &&
    Number.isFinite(maxSec) &&
    maxSec > 0 &&
    dur > maxSec
  ) {
    throw new UnrecoverableError(
      `video_exceeds_max_duration_seconds:${maxSec}:actual_seconds:${dur.toFixed(2)}`,
    );
  }

  /** Se não há duração disponível antes do envio ao Deepgram e trava existe, apenas logamos (derivada pós-response). */
  if (
    dur == null &&
    Number.isFinite(maxSec) &&
    maxSec > 0
  ) {
    console.warn('[video_guard] duration_unknown_skipping_precheck_deepgram_follows');
  }

  return { sizeBytes, durationSecondsEstimated: dur };
}

module.exports = {
  assertVideoWithinPlanGuards,
  readMp4MvhdDurationSeconds,
};
