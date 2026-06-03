import type { SoundProvider, SoundAsset, SearchQuery, SearchResult } from "../provider.svelte";
import { debugLog } from "../logger";
import { fetch } from "@tauri-apps/plugin-http";

export class AudiioSoundProvider implements SoundProvider {
    readonly id = "audiio";
    readonly name = "Audiio (SFX)";

    private blobUrls = new Map<string, string>();

    async search(query: SearchQuery): Promise<SearchResult> {
        const queryStr = (query.query || "").trim();

        // Target private SFX search endpoint
        const url = `https://audiio.com/api/sfx?page=${query.page}&search=${encodeURIComponent(queryStr)}`;
        debugLog("Querying Audiio SFX API:", url);

        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} failed to search Audiio SFX.`);
        }

        const raw = await response.json();
        const rawTracks = raw.sfxTracks || [];

        const items = rawTracks.map((track: any): SoundAsset => {
            const title = track.title || "Audiio_SFX.wav";
            
            // Derive CloudFront preview URL from title
            // E.g., "Audiio_KickPadHit1.wav" -> "https://d2cx9kaw24fnh5.cloudfront.net/Audiio_KickPadHit1.mp3"
            const dotIndex = title.lastIndexOf('.');
            const baseName = dotIndex !== -1 ? title.substring(0, dotIndex) : title;
            const previewUrl = `https://d2cx9kaw24fnh5.cloudfront.net/${encodeURIComponent(baseName)}.mp3`;

            return {
                uuid: track.id?.toString() || Math.random().toString(),
                name: track.comment || baseName.replace(/_/g, " "),
                bpm: null,
                key: null,
                chordType: null,
                duration: track.duration ? Math.round(Number(track.duration) * 1000) : 0,
                previewUrl,
                downloadUrl: previewUrl,
                providerId: this.id,
                assetCategorySlug: "oneshot",
                packName: track.ucs_category || "Audiio SFX",
                packCoverUrl: null,
                sourceUrl: `https://audiio.com/sfx?search=${encodeURIComponent(track.comment || baseName)}`,
                waveformUrl: null, // First-pass waveform rendering is dropped
                tags: track.genre 
                    ? JSON.parse(track.genre).map((g: string) => ({ uuid: g, label: g }))
                    : [],
                rawAsset: track,
            };
        });

        return {
            items,
            totalRecords: raw.total || items.length,
            tagSummary: [],
        };
    }

    async getAudioURL(asset: SoundAsset): Promise<string> {
        const existing = this.blobUrls.get(asset.uuid);
        if (existing) return existing;

        debugLog("Downloading Audiio SFX CloudFront preview:", asset.downloadUrl);
        const response = await fetch(asset.downloadUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} failed to download preview from Audiio.`);
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
