import type { SoundProvider, SoundAsset, SearchQuery, SearchResult } from "../provider.svelte";
import { config } from "../config.svelte";
import { debugLog } from "../logger";
import { applyAuthHeader } from "../auth-header";
import { fetch } from "@tauri-apps/plugin-http";

function hashString(value: string) {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    }
    return hash >>> 0;
}

function matchesFilters(asset: SoundAsset, query: SearchQuery) {
    if (query.assetCategorySlug && asset.assetCategorySlug !== query.assetCategorySlug) {
        return false;
    }
    if (query.key || query.chordType || query.bpm || query.minBpm !== null || query.maxBpm !== null) {
        return false;
    }
    return query.tags.every((tag) =>
        asset.tags.some((assetTag) => assetTag.uuid.toLowerCase() === tag.toLowerCase())
    );
}

function sortItems(items: SoundAsset[], query: SearchQuery) {
    const sorted = [...items];
    const direction = query.order === "ASC" ? 1 : -1;
    switch (query.sort) {
        case "random":
            sorted.sort((a, b) =>
                hashString(`${query.randomSeed}:${a.uuid}`) -
                hashString(`${query.randomSeed}:${b.uuid}`)
            );
            break;
        case "name":
            sorted.sort((a, b) => a.name.localeCompare(b.name) * direction);
            break;
        case "duration":
            sorted.sort((a, b) => (a.duration - b.duration) * direction);
            break;
    }
    return sorted;
}

export class VoicemodSoundProvider implements SoundProvider {
    readonly id = "voicemod";
    readonly name = "Voicemod";

    private blobUrls = new Map<string, string>();

    async search(query: SearchQuery): Promise<SearchResult> {
        const params = new URLSearchParams({
            "text": query.query || "",
            "page": query.page.toString(),
            "size": query.limit.toString(),
            "audio-format": "mp3",
            "custom": "true",
            "published": "true",
            "sort": "-trending",
        });

        const url = `https://tuna-api.voicemod.net/v2/sounds?${params.toString()}`;
        debugLog("Querying Voicemod Tuna:", url);

        const buildHeaders = (withAuth: boolean) => {
            const headers: Record<string, string> = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "application/json",
                "app-os": "Windows",
                "app-name": "tuna",
                "app-version": "8.37.3"
            };
            if (withAuth) {
                applyAuthHeader(headers, config.voicemod_session_cookie);
            }
            return headers;
        };

        let response = await fetch(url, { headers: buildHeaders(true) });
        if (response.status === 401 && config.voicemod_session_cookie.trim()) {
            debugLog("Voicemod auth header was rejected, retrying without it");
            response = await fetch(url, { headers: buildHeaders(false) });
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} failed to fetch from Voicemod Tuna`);
        }

        const data = await response.json();
        const rawResults = data.items || [];

        const items: SoundAsset[] = rawResults.map((raw: any): SoundAsset => {
            return {
                uuid: raw.id || Math.random().toString(),
                name: raw.name || "Voicemod Sound",
                bpm: null,
                key: null,
                chordType: null,
                duration: raw.duration || 0,
                previewUrl: raw.audio?.url || "",
                downloadUrl: raw.audio?.url || "",
                providerId: this.id,
                assetCategorySlug: "oneshot",
                packName: raw.publicInfo?.ownerName || "Voicemod",
                packCoverUrl: raw.icon?.url || null,
                sourceUrl: raw.publicInfo?.url || null,
                waveformUrl: null,
                tags: raw.publicInfo?.tags
                    ? raw.publicInfo.tags.map((t: string) => ({
                          uuid: t,
                          label: t,
                      }))
                    : [],
                rawAsset: raw,
            };
        });

        const filteredItems = sortItems(items.filter((asset) => matchesFilters(asset, query)), query);
        const hasLocalFilters =
            query.assetCategorySlug ||
            query.tags.length > 0 ||
            query.key ||
            query.chordType ||
            query.bpm ||
            query.minBpm !== null ||
            query.maxBpm !== null;
        const hasMore = !hasLocalFilters && Boolean(data.next);

        return {
            items: filteredItems,
            totalRecords: filteredItems.length,
            totalRecordsKnown: false,
            hasMore,
            tagSummary: [],
        };
    }

    async getAudioURL(asset: SoundAsset): Promise<string> {
        const existing = this.blobUrls.get(asset.uuid);
        if (existing) return existing;

        debugLog("Downloading Voicemod MP3:", asset.downloadUrl);
        const response = await fetch(asset.downloadUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} failed to download sound from Voicemod.`);
        }

        const buffer = await response.arrayBuffer();
        const blob = new Blob([buffer], { type: "audio/mp3" });
        const blobURL = window.URL.createObjectURL(blob);
        
        this.blobUrls.set(asset.uuid, blobURL);
        return blobURL;
    }

    freeAll() {
        for (const url of this.blobUrls.values()) {
            window.URL.revokeObjectURL(url);
        }
        this.blobUrls.clear();
    }
}
