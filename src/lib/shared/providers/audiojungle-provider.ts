import type { SoundProvider, SoundAsset, SearchQuery, SearchResult } from "../provider.svelte";
import { config } from "$lib/shared/config.svelte";
import { debugLog } from "../logger";
import { fetch } from "@tauri-apps/plugin-http";

export class AudioJungleSoundProvider implements SoundProvider {
    readonly id = "audiojungle";
    readonly name = "AudioJungle";

    private blobUrls = new Map<string, string>();

    async search(query: SearchQuery): Promise<SearchResult> {
        const token = (config.envato_personal_token || "").trim();

        // If no token is provided, return a clean empty state (the UI will display the settings hint)
        if (!token) {
            debugLog("Envato Personal Token is missing in settings, returning empty list");
            return {
                items: [],
                totalRecords: 0,
                tagSummary: [],
            };
        }

        const queryStr = (query.query || "").trim();
        
        // Target the official Envato API Active Items Search
        const url = `https://api.envato.com/v1/market/search/active-items.json?site=audiojungle.net&term=${encodeURIComponent(queryStr)}&page=${query.page}&page_size=${query.limit}`;
        debugLog("Querying Envato AudioJungle API:", url);

        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "application/json",
                "Authorization": `Bearer ${token}`
            },
        });

        if (response.status === 401) {
            throw new Error("Envato Personal Token is invalid or unauthorized. Please verify your token in Settings.");
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} failed to search AudioJungle catalog.`);
        }

        const raw = await response.json();
        const searchResults = raw.search?.results || [];

        const items = searchResults.map((item: any): SoundAsset => {
            const previewUrl = item.preview_url || item.live_preview_url || "";
            return {
                uuid: item.id?.toString() || Math.random().toString(),
                name: item.name || "AudioJungle Track",
                bpm: null,
                key: null,
                chordType: null,
                duration: 0, // Envato search api does not consistently return duration
                previewUrl,
                downloadUrl: previewUrl,
                providerId: this.id,
                assetCategorySlug: "loop",
                packName: item.author_username || "AudioJungle Author",
                packCoverUrl: item.thumbnail_url || null,
                sourceUrl: item.url || `https://audiojungle.net/item/track/${item.id}`,
                waveformUrl: null,
                tags: (item.tags || "").split(",").filter(Boolean).map((t: string) => ({ uuid: t, label: t.trim() })),
                rawAsset: item,
            };
        });

        const totalRecords = Number(raw.search?.matches || items.length);

        return {
            items,
            totalRecords,
            tagSummary: [],
        };
    }

    async getAudioURL(asset: SoundAsset): Promise<string> {
        const existing = this.blobUrls.get(asset.uuid);
        if (existing) return existing;

        debugLog("Downloading AudioJungle MP3 preview:", asset.downloadUrl);
        const response = await fetch(asset.downloadUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} failed to download preview from AudioJungle.`);
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
