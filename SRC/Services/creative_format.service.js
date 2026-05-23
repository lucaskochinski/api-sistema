'use strict';

function gcd(a, b) {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function aspectRatioLabel(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const g = gcd(w, h);
  return `${Math.round(w / g)}:${Math.round(h / g)}`;
}

/**
 * Dimensões nativas do vídeo — só vêm em `format[]` (filter `native`), não em width/height top-level.
 */
function extractNativeFormatFromVideoPayload(videoPayload) {
  const payload = videoPayload && typeof videoPayload === 'object' ? videoPayload : {};
  const formats = Array.isArray(payload.format) ? payload.format : [];
  const native =
    formats.find((f) => f && String(f.filter || '').toLowerCase() === 'native') ||
    formats.find((f) => f && Number(f.width) > 0 && Number(f.height) > 0) ||
    null;

  if (!native) {
    return {
      width: null,
      height: null,
      filter: null,
      length: payload.length != null ? Number(payload.length) : null,
    };
  }

  const width = Number(native.width);
  const height = Number(native.height);

  return {
    width: Number.isFinite(width) ? width : null,
    height: Number.isFinite(height) ? height : null,
    filter: native.filter != null ? String(native.filter) : null,
    length: payload.length != null ? Number(payload.length) : null,
  };
}

function countCarouselCards(rawCreative) {
  const c = rawCreative && typeof rawCreative === 'object' ? rawCreative : {};
  const feed = c.asset_feed_spec;
  if (feed && typeof feed === 'object') {
    const images = Array.isArray(feed.images) ? feed.images.length : 0;
    const videos = Array.isArray(feed.videos) ? feed.videos.length : 0;
    if (images > 1 || videos > 1) return Math.max(images, videos);
  }
  const attachments = c.object_story_spec?.link_data?.child_attachments;
  if (Array.isArray(attachments) && attachments.length > 1) return attachments.length;
  return 0;
}

/**
 * Extrai apenas fatos que existem no payload Meta (creative + vídeo persistido).
 */
function extractMetaCreativeFacts({ rawCreative, ingestMetadata }) {
  const c = rawCreative && typeof rawCreative === 'object' ? rawCreative : {};
  const meta = ingestMetadata && typeof ingestMetadata === 'object' ? ingestMetadata : {};

  const objectType = c.object_type != null ? String(c.object_type) : meta.objectType || null;
  const videoId =
    c.video_id != null
      ? String(c.video_id)
      : meta.metaVideoId != null
        ? String(meta.metaVideoId)
        : null;

  const nativeFormat =
    meta.nativeFormat && typeof meta.nativeFormat === 'object'
      ? meta.nativeFormat
      : {
          width: meta.width != null ? Number(meta.width) : null,
          height: meta.height != null ? Number(meta.height) : null,
          filter: meta.formatFilter || null,
          length: meta.videoLength != null ? Number(meta.videoLength) : null,
        };

  const width = Number.isFinite(Number(nativeFormat.width)) ? Number(nativeFormat.width) : null;
  const height = Number.isFinite(Number(nativeFormat.height)) ? Number(nativeFormat.height) : null;
  const carouselCards = countCarouselCards(c);

  let bucketKey = 'sem_dados_meta';
  let bucketLabel = 'Sem dados de formato do Meta';

  if (width && height) {
    bucketKey = `${width}x${height}`;
    bucketLabel = `${width} × ${height} px`;
  } else if (carouselCards > 1) {
    bucketKey = `carousel_${carouselCards}_cards`;
    bucketLabel = `Carrossel (${carouselCards} cards)`;
  } else if (objectType) {
    bucketKey = `object_type_${objectType}`;
    bucketLabel = objectType;
  }

  return {
    bucketKey,
    bucketLabel,
    objectType,
    videoId,
    width,
    height,
    aspectRatio: width && height ? aspectRatioLabel(width, height) : null,
    videoLengthSeconds:
      nativeFormat.length != null && Number.isFinite(Number(nativeFormat.length))
        ? Number(nativeFormat.length)
        : null,
    formatFilter: nativeFormat.filter || null,
    carouselCards: carouselCards > 1 ? carouselCards : null,
    hasThumbnail: Boolean(c.thumbnail_url || meta.thumbnailUrl),
    hasImageUrl: Boolean(c.image_url),
  };
}

function previewBoxPct(width, height) {
  if (!width || !height) return { widthPct: 70, heightPct: 70 };
  const aspect = width / height;
  if (aspect < 0.8) return { widthPct: 42, heightPct: 82 };
  if (aspect < 1.1) return { widthPct: 70, heightPct: 70 };
  return { widthPct: 82, heightPct: 46 };
}

function buildFormatsDistribution(rows) {
  /** @type {Map<string, object>} */
  const bucketMap = new Map();
  let unclassifiedCount = 0;

  for (const row of rows) {
    const rawCreative =
      row.raw_creative_data && typeof row.raw_creative_data === 'object'
        ? row.raw_creative_data
        : {};
    const ingestMeta =
      row.ingest_metadata && typeof row.ingest_metadata === 'object'
        ? row.ingest_metadata
        : {};

    const facts = extractMetaCreativeFacts({ rawCreative, ingestMetadata: ingestMeta });

    if (facts.bucketKey === 'sem_dados_meta') {
      unclassifiedCount += 1;
      continue;
    }

    if (!bucketMap.has(facts.bucketKey)) {
      const box = previewBoxPct(facts.width, facts.height);
      bucketMap.set(facts.bucketKey, {
        id: facts.bucketKey,
        bucketKey: facts.bucketKey,
        label: facts.bucketLabel,
        objectType: facts.objectType,
        width: facts.width,
        height: facts.height,
        aspectRatio: facts.aspectRatio,
        formatFilter: facts.formatFilter,
        widthPct: box.widthPct,
        heightPct: box.heightPct,
        syncedCount: 0,
        ads: [],
        filterGroup:
          facts.width && facts.height
            ? facts.height > facts.width
              ? 'vertical'
              : facts.width > facts.height
                ? 'landscape'
                : 'square'
            : facts.carouselCards
              ? 'carousel'
              : 'other',
      });
    }

    const bucket = bucketMap.get(facts.bucketKey);
    bucket.syncedCount += 1;
    bucket.ads.push({
      adId: row.ad_id,
      adName: row.ad_name,
      campaignName: row.campaign_name || null,
      objectType: facts.objectType,
      videoId: facts.videoId,
      width: facts.width,
      height: facts.height,
      aspectRatio: facts.aspectRatio,
      videoLengthSeconds: facts.videoLengthSeconds,
      carouselCards: facts.carouselCards,
    });
  }

  const items = Array.from(bucketMap.values()).sort((a, b) => b.syncedCount - a.syncedCount);

  return {
    totalImported: rows.length,
    unclassifiedCount,
    items,
  };
}

module.exports = {
  aspectRatioLabel,
  extractNativeFormatFromVideoPayload,
  extractMetaCreativeFacts,
  buildFormatsDistribution,
};
