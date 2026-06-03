import type { SoundProvider, SoundAsset, SearchQuery, SearchResult } from "../provider.svelte";
import { debugLog } from "../logger";
import { querySplice, SamplesSearch } from "$lib/splice/api";
import { descrambleSample } from "$lib/splice/descrambler";
import { fetch } from "@tauri-apps/plugin-http";

const SPLICE_ORIGIN = "https://splice.com";
const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export class SpliceSoundProvider implements SoundProvider {
    readonly id = "splice";
    readonly name = "Splice";

    // Local in-memory cache for descrambled audio blobs
    private descrambledSamples = new Map<string, string>();

    async search(query: SearchQuery): Promise<SearchResult> {
        // Map normalized SearchQuery to Splice GraphQL parameters
        const spliceVariables = {
            query: query.query || null,
            page: query.page,
            limit: query.limit,
            sort: query.sort,
            order: query.order,
            tags: query.tags,
            bpm: query.bpm,
            min_bpm: query.minBpm,
            max_bpm: query.maxBpm,
            key: query.key,
            chord_type: query.chordType,
            asset_category_slug: query.assetCategorySlug,
        };

        const response = await querySplice(SamplesSearch, spliceVariables);
        if (!response) {
            throw new Error("Failed to retrieve search response from Splice");
        }

        const searchResult = response.data?.assetsSearch;
        if (!searchResult) {
            throw new Error("Empty or invalid search results from Splice");
        }

        // Map Splice SampleAssets onto unified SoundAssets
        const items = (searchResult.items || []).map((raw: any): SoundAsset => {
            const pack = raw.parents?.items?.[0] || {};
            const packCoverUrl = pack.files?.[0]?.url || null;
            const sourceUrl = pack.permalink_base_url && pack.permalink_slug
                ? `https://splice.com/sounds/packs/${pack.permalink_base_url}/${pack.permalink_slug}`
                : null;

            return {
                uuid: raw.uuid,
                name: raw.name,
                bpm: raw.bpm ? Number(raw.bpm) : null,
                key: raw.key || null,
                chordType: raw.chord_type || null,
                duration: raw.duration || 0,
                previewUrl: raw.files?.[0]?.url || "",
                downloadUrl: raw.files?.[0]?.url || "",
                providerId: this.id,
                assetCategorySlug: raw.asset_category_slug || null,
                packName: pack.name || "Splice Pack",
                packCoverUrl,
                sourceUrl,
                waveformUrl: raw.files?.[1]?.url || null,
                tags: (raw.tags || []).map((t: any) => ({ uuid: t.uuid, label: t.label })),
                rawAsset: raw,
            };
        });

        const totalRecords = searchResult.response_metadata?.records || 0;
        
        // Normalize tag summary
        const tagSummary = (searchResult.tag_summary || []).map((entry: any) => ({
            count: entry.count,
            tag: {
                uuid: entry.tag.uuid,
                label: entry.tag.label,
                taxonomy: {
                    uuid: entry.tag.taxonomy?.uuid || "",
                    name: entry.tag.taxonomy?.name || "",
                }
            }
        }));

        return {
            items,
            totalRecords,
            tagSummary,
        };
    }

    async getAudioURL(asset: SoundAsset): Promise<string> {
        const existingBlobURL = this.descrambledSamples.get(asset.uuid);
        if (existingBlobURL) {
            return existingBlobURL;
        }

        debugLog("Fetching and descrambling Splice sample:", asset.name);
        const response = await fetch(asset.downloadUrl, {
            headers: {
                "Accept": "audio/*,*/*;q=0.9",
                "Origin": SPLICE_ORIGIN,
                "Referer": asset.sourceUrl || `${SPLICE_ORIGIN}/sounds`,
                "User-Agent": BROWSER_USER_AGENT,
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} failed to download sample.`);
        }

        const data = new Uint8Array(await response.arrayBuffer());
        const descrambledData = descrambleSample(data);

        const blob = new Blob([descrambledData], {
            type: "audio/mp3",
        });

        const blobURL = window.URL.createObjectURL(blob);
        this.descrambledSamples.set(asset.uuid, blobURL);
        return blobURL;
    }

    freeDescrambledSample(uuid: string): boolean {
        const existingBlobURL = this.descrambledSamples.get(uuid);
        if (!existingBlobURL) return false;

        this.descrambledSamples.delete(uuid);
        window.URL.revokeObjectURL(existingBlobURL);
        debugLog("Freed descrambled sample:", uuid);
        return true;
    }

    freeAllSamples() {
        for (const uuid of this.descrambledSamples.keys()) {
            this.freeDescrambledSample(uuid);
        }
    }
}
