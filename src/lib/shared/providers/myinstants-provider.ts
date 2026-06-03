import type { SoundProvider, SoundAsset, SearchQuery, SearchResult } from "../provider.svelte";
import { debugLog } from "../logger";
import { fetch } from "@tauri-apps/plugin-http";



/**
 * Generate a seeded pseudo-random waveform so every sound clip gets a
 * unique but deterministic visual representation.
 */
function generateSeededWaveform(seed: string): number[] {
    // Simple hash → number from the slug / uuid string
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
        h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    }

    const prng = () => {
        h = (h * 1103515245 + 12345) & 0x7fffffff;
        return h / 0x7fffffff;
    };

    const data: number[] = [];
    const len = 200;
    // Pick some random frequency / phase / amplitude combos seeded per-clip
    const freq1 = 4 + prng() * 12;
    const freq2 = 8 + prng() * 20;
    const phase1 = prng() * Math.PI * 2;
    const phase2 = prng() * Math.PI * 2;
    const amp1 = 0.05 + prng() * 0.12;
    const amp2 = 0.02 + prng() * 0.06;

    for (let i = 0; i < len; i++) {
        const t = i / len;
        const envelope = Math.sin(t * Math.PI); // fade in/out
        const val =
            0.12 +
            Math.sin(t * freq1 + phase1) * amp1 +
            Math.sin(t * freq2 + phase2) * amp2 +
            prng() * 0.04;
        data.push(Math.max(0.02, Math.min(0.9, val * (0.4 + envelope * 0.6))));
    }
    return data;
}

function hashString(value: string) {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    }
    return hash >>> 0;
}

function normalizeTags(rawTags: string | null | undefined) {
    return (rawTags || "")
        .split(/[,\s]+/)
        .map((tag) => tag.trim())
        .filter(Boolean);
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

export class MyInstantsSoundProvider implements SoundProvider {
    readonly id = "myinstants";
    readonly name = "MyInstants";

    private blobUrls = new Map<string, string>();

    async search(query: SearchQuery): Promise<SearchResult> {
        // MyInstants API uses "name" for searching, not "search"
        const url = `https://www.myinstants.com/api/v1/instants/?name=${encodeURIComponent(query.query || "")}&page=${query.page}`;
        
        debugLog("Querying MyInstants:", url);
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} failed to fetch from MyInstants`);
        }

        const data = await response.json();

        // Map raw API results to SoundAsset, probing real duration in parallel
        const rawResults = data.results || [];
        const items: SoundAsset[] = rawResults.map((raw: any): SoundAsset => {
            const slug = raw.slug || Math.random().toString();
            const tags = normalizeTags(raw.tags);
            return {
                uuid: slug,
                name: raw.name || "Meme Sound",
                bpm: null,
                key: null,
                chordType: null,
                duration: 0, // Will be resolved asynchronously below
                previewUrl: raw.sound,
                downloadUrl: raw.sound,
                providerId: this.id,
                assetCategorySlug: "oneshot",
                packName: "MyInstants",
                packCoverUrl: raw.image || null,
                sourceUrl: raw.slug ? `https://www.myinstants.com/en/instant/${raw.slug}/` : null,
                waveformUrl: null,
                tags: tags.map((tag) => ({
                    uuid: tag,
                    label: tag,
                })),
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

        debugLog("Downloading MyInstants MP3:", asset.downloadUrl);
        const response = await fetch(asset.downloadUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} failed to download soundboard.`);
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
