import type { SoundProvider, SoundAsset, SearchQuery, SearchResult } from "../provider.svelte";
import { debugLog } from "../logger";
import { fetch } from "@tauri-apps/plugin-http";
import {
    BROWSER_USER_AGENT,
    buildTagSummary,
    deriveTagsFromText,
    matchesCommonFilters,
    sortItems,
} from "./provider-utils";

const ORIGIN = "https://sounddogs.com";

function absoluteUrl(path: string) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    return `${ORIGIN}${path.startsWith("/") ? "" : "/"}${path}`;
}

function parseProductDescriptions(html: string) {
    const match = html.match(/soundInfo\.productDescriptions\s*=\s*(\[[\s\S]*?\]);/);
    if (!match) return [];
    return JSON.parse(match[1]);
}

function mapAsset(raw: any): SoundAsset {
    const previewUrl = absoluteUrl(raw.previewUrl);
    const tags = deriveTagsFromText(raw.description || raw.name || "", [raw.library]);

    return {
        uuid: `sounddogs:${raw.productID || raw.soundUDID || raw.name}`,
        name: raw.description || raw.name || "SoundDogs Sound",
        bpm: null,
        key: null,
        chordType: null,
        duration: Math.round(Number(raw.durationSeconds || 0)),
        previewUrl,
        downloadUrl: previewUrl,
        providerId: "sounddogs",
        assetCategorySlug: "oneshot",
        packName: raw.library || "SoundDogs",
        packCoverUrl: null,
        sourceUrl: raw.soundUDID
            ? `${ORIGIN}/search?keywords=${encodeURIComponent(raw.soundUDID)}&share=true`
            : `${ORIGIN}/search?keywords=${encodeURIComponent(raw.name || "")}`,
        waveformUrl: null,
        tags,
        rawAsset: raw,
    };
}

export class SoundDogsProvider implements SoundProvider {
    readonly id = "sounddogs";
    readonly name = "SoundDogs";

    private blobUrls = new Map<string, string>();

    async search(query: SearchQuery): Promise<SearchResult> {
        if (query.page > 1) {
            return { items: [], totalRecords: 0, totalRecordsKnown: false, hasMore: false, tagSummary: [] };
        }

        const url = `${ORIGIN}/search?keywords=${encodeURIComponent(query.query || "")}`;
        debugLog("Querying SoundDogs:", url);

        const response = await fetch(url, {
            headers: {
                "User-Agent": BROWSER_USER_AGENT,
                "Accept": "text/html",
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} failed to fetch from SoundDogs`);
        }

        const html = await response.text();
        const rawItems = parseProductDescriptions(html);
        const items = sortItems(
            rawItems.map(mapAsset).filter((asset: SoundAsset) => matchesCommonFilters(asset, query)),
            query
        );
        return {
            items,
            totalRecords: items.length,
            totalRecordsKnown: false,
            hasMore: false,
            tagSummary: buildTagSummary(items),
        };
    }

    async getAudioURL(asset: SoundAsset): Promise<string> {
        const existing = this.blobUrls.get(asset.uuid);
        if (existing) return existing;

        const response = await fetch(asset.downloadUrl, {
            headers: {
                "User-Agent": BROWSER_USER_AGENT,
                "Referer": asset.sourceUrl || ORIGIN,
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} failed to download SoundDogs preview`);
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
