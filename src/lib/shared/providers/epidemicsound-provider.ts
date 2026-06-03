import type { SoundProvider, SoundAsset, SearchQuery, SearchResult } from "../provider.svelte";
import { debugLog, debugWarn } from "../logger";
import { fetch } from "@tauri-apps/plugin-http";

export class EpidemicSoundProvider implements SoundProvider {
    readonly id = "epidemicsound";
    readonly name = "Epidemic Sound (Link)";

    private blobUrls = new Map<string, string>();

    async search(query: SearchQuery): Promise<SearchResult> {
        const queryStr = (query.query || "").trim();

        // Regex to match epidemicsound.com track, music/tracks, and sound-effects/tracks URLs
        const epidemicUrlRegex = /https?:\/\/(?:www\.)?epidemicsound\.com\/(?:music\/tracks|sound-effects\/tracks|track)\/([0-9a-zA-Z-]+)/i;
        const match = queryStr.match(epidemicUrlRegex);

        // If the query is not a valid epidemicsound URL, return a clean empty state
        if (!match) {
            debugLog("Query is not a valid Epidemic Sound URL, returning empty list");
            return {
                items: [],
                totalRecords: 0,
                tagSummary: [],
            };
        }

        const idOrSlug = match[1];
        const isUuid = idOrSlug.includes("-");

        // Construct target JSON metadata endpoint (ensuring NO trailing slash)
        const url = isUuid
            ? `https://www.epidemicsound.com/json/track/kosmos-id/${idOrSlug}`
            : `https://www.epidemicsound.com/json/track/${idOrSlug}`;

        debugLog("Querying Epidemic Sound link resolver API:", url);

        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            if (response.status === 404) {
                // If track not found, return empty state instead of throwing an error
                debugWarn(`Epidemic Sound track not found (404) for slug: ${idOrSlug}`);
                return {
                    items: [],
                    totalRecords: 0,
                    tagSummary: [],
                };
            }
            throw new Error(`HTTP ${response.status} failed to resolve Epidemic Sound track metadata`);
        }

        const raw = await response.json();
        
        // Map fields accurately based on tested raw JSON
        const asset: SoundAsset = {
            uuid: raw.kosmosId || raw.id?.toString() || Math.random().toString(),
            name: raw.title || "Epidemic Sound Track",
            bpm: raw.bpm ? Math.round(Number(raw.bpm)) : null,
            key: null,
            chordType: null,
            duration: raw.length ? Math.round(Number(raw.length) * 1000) : 0,
            previewUrl: raw.stems?.full?.lqMp3Url || "",
            downloadUrl: raw.stems?.full?.lqMp3Url || "", // Dynamic session-only URL (do not persist)
            providerId: this.id,
            assetCategorySlug: raw.isSfx ? "oneshot" : "loop",
            packName: "Epidemic Sound (Link)",
            packCoverUrl: raw.coverArt?.sizes?.S
                ? `${raw.coverArt.baseUrl}${raw.coverArt.sizes.S}`
                : (raw.imageUrl || null),
            sourceUrl: raw.isSfx
                ? `https://www.epidemicsound.com/sound-effects/tracks/${raw.kosmosId}`
                : `https://www.epidemicsound.com/track/${raw.publicSlug}`,
            waveformUrl: raw.stems?.full?.waveformUrl || null,
            tags: (raw.metadataTags || []).map((t: string) => ({
                uuid: t,
                label: t,
            })),
            rawAsset: raw,
        };

        return {
            items: [asset],
            totalRecords: 1,
            tagSummary: [],
        };
    }

    async getAudioURL(asset: SoundAsset): Promise<string> {
        const existing = this.blobUrls.get(asset.uuid);
        if (existing) return existing;

        debugLog("Downloading Epidemic Sound MP3 preview:", asset.downloadUrl);
        const response = await fetch(asset.downloadUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} failed to download preview from Epidemic Sound.`);
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
