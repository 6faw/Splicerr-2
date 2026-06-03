import type { SoundProvider, SoundAsset, SearchQuery, SearchResult } from "../provider.svelte";
import { debugLog } from "../logger";
import { fetch } from "@tauri-apps/plugin-http";
import {
    BROWSER_USER_AGENT,
    buildTagSummary,
    matchesCommonFilters,
    normalizeTags,
    sortItems,
    splitSearchTerms,
} from "./provider-utils";

const SEARCH_URL = "https://api.prosoundeffects.com/v2/search/sounds";
const SOURCE_BASE_URL = "https://www.prosoundeffects.com/sound-effects";

function audioUrl(raw: any) {
    return raw.mp3Url ||
        raw.soundPaths?.find((path: any) => path.format === "mp3")?.url ||
        raw.previewUrl ||
        "";
}

function sourceUrl(raw: any) {
    if (!raw.libraryId || !raw.id) return "https://www.prosoundeffects.com/sound-effects";
    const seoName = raw.seoName || raw.truncatedFXName || raw.filename || raw.id;
    return `${SOURCE_BASE_URL}/${encodeURIComponent(raw.libraryId)}/${encodeURIComponent(raw.id)}/${encodeURIComponent(seoName)}`;
}

function mapAsset(raw: any): SoundAsset {
    const tags = normalizeTags([
        raw.category,
        raw.subCategory,
        raw.library,
        raw.publisher,
        ...(Array.isArray(raw.tags) ? raw.tags : []),
    ]);
    const url = audioUrl(raw);

    return {
        uuid: `pse:${raw.libraryId || raw.collectionId || "sound"}:${raw.id || raw.clientId || raw.filename}`,
        name: raw.description || raw.filename || raw.truncatedFXName || "Pro Sound Effects Sound",
        bpm: null,
        key: null,
        chordType: null,
        duration: Math.round(Number(raw.durationSeconds || 0) * 1000),
        previewUrl: url,
        downloadUrl: url,
        providerId: "prosoundeffects",
        assetCategorySlug: "oneshot",
        packName: raw.library || raw.publisher || "Pro Sound Effects",
        packCoverUrl: raw.artworkWebpUrl || raw.artworkUrl || null,
        sourceUrl: sourceUrl(raw),
        waveformUrl: null,
        tags,
        rawAsset: raw,
    };
}

export class ProSoundEffectsProvider implements SoundProvider {
    readonly id = "prosoundeffects";
    readonly name = "Pro Sound Effects";

    private blobUrls = new Map<string, string>();

    async search(query: SearchQuery): Promise<SearchResult> {
        const payload = {
            request: null,
            keywords: splitSearchTerms(query.query),
            categories: [],
            libraries: [],
            pageIndex: query.page,
            pageSize: query.limit,
        };

        debugLog("Querying Pro Sound Effects:", payload);
        const response = await fetch(SEARCH_URL, {
            method: "POST",
            headers: {
                "User-Agent": BROWSER_USER_AGENT,
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Origin": "https://www.prosoundeffects.com",
                "Referer": "https://www.prosoundeffects.com/search",
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} failed to fetch from Pro Sound Effects`);
        }

        const data = await response.json();
        const items = sortItems(
            (data.result || []).map(mapAsset).filter((asset: SoundAsset) => matchesCommonFilters(asset, query)),
            query
        );
        const hasLocalFilters =
            query.assetCategorySlug ||
            query.tags.length > 0 ||
            query.key ||
            query.chordType ||
            query.bpm ||
            query.minBpm !== null ||
            query.maxBpm !== null;

        return {
            items,
            totalRecords: hasLocalFilters ? items.length : Number(data.totalCount || items.length),
            tagSummary: buildTagSummary(items),
        };
    }

    async getAudioURL(asset: SoundAsset): Promise<string> {
        const existing = this.blobUrls.get(asset.uuid);
        if (existing) return existing;

        const response = await fetch(asset.downloadUrl, {
            headers: {
                "User-Agent": BROWSER_USER_AGENT,
                "Referer": asset.sourceUrl || "https://www.prosoundeffects.com/sound-effects",
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} failed to download Pro Sound Effects preview`);
        }

        const buffer = await response.arrayBuffer();
        const blobUrl = window.URL.createObjectURL(new Blob([buffer], { type: "audio/mp3" }));
        this.blobUrls.set(asset.uuid, blobUrl);
        return blobUrl;
    }

    freeAll() {
        for (const url of this.blobUrls.values()) {
            window.URL.revokeObjectURL(url);
        }
        this.blobUrls.clear();
    }
}
