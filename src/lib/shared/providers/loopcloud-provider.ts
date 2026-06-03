import type { SoundProvider, SoundAsset, SearchQuery, SearchResult } from "../provider.svelte";
import { debugLog } from "../logger";
import { fetch } from "@tauri-apps/plugin-http";

const API_ORIGIN = "https://cloud.loopmasters.com";
const WEB_ORIGIN = "https://sounds.loopcloud.com";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function parseKey(raw: any) {
    if (Array.isArray(raw) && raw.length > 0) return raw[0]?.name || null;
    if (typeof raw === "string") return raw || null;
    return null;
}

function parseDuration(raw: any) {
    const duration = Number(raw?.duration || raw?.length || raw?.seconds || 0);
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    return duration > 1000 ? Math.round(duration) : Math.round(duration * 1000);
}

function tagsFromRaw(raw: any) {
    if (!Array.isArray(raw?.tags)) return [];
    return raw.tags
        .map((tag: any) => typeof tag === "string" ? tag : tag?.name)
        .filter(Boolean)
        .map((label: string) => ({ uuid: label, label }));
}

function mapAsset(raw: any, index: number, query: SearchQuery): SoundAsset {
    const uuid = raw.uuid || raw.id?.toString() || `loopcloud-${query.page}-${index}`;
    const productId = raw.product_id || raw.product_ids?.[0];
    const name = raw.name || raw.filename || "Loopcloud Sample";

    return {
        uuid,
        name,
        bpm: raw.bpm ? Math.round(Number(raw.bpm)) : null,
        key: parseKey(raw.key),
        chordType: null,
        duration: parseDuration(raw),
        previewUrl: `${API_ORIGIN}/api-web/v1/cloud_items/audio/${uuid}`,
        downloadUrl: `${API_ORIGIN}/api-web/v1/cloud_items/audio/${uuid}`,
        providerId: "loopcloud",
        assetCategorySlug: "oneshot",
        packName: raw.product_name || raw.pack_name || raw.label_name || "Loopcloud",
        packCoverUrl: raw.image_url || raw.product_image_url || raw.cover_url || null,
        sourceUrl: productId
            ? `https://www.loopmasters.com/products/${productId}`
            : `${WEB_ORIGIN}/search?q=${encodeURIComponent(query.query || "")}`,
        waveformUrl: null,
        tags: tagsFromRaw(raw),
        rawAsset: raw,
    };
}

export class LoopcloudSoundProvider implements SoundProvider {
    readonly id = "loopcloud";
    readonly name = "Loopcloud";

    private blobUrls = new Map<string, string>();
    private signedUrls = new Map<string, string>();

    async search(query: SearchQuery): Promise<SearchResult> {
        const searchText = (query.query || "").trim() || "drums";
        const params = new URLSearchParams({
            q: searchText,
            page: query.page.toString(),
            per_page: query.limit.toString(),
            user: "true",
            shop: "true",
            wave: "true",
        });

        const url = `${API_ORIGIN}/api-web/v1/cloud_items/search?${params.toString()}`;
        debugLog("Querying Loopcloud:", url);

        const response = await fetch(url, {
            headers: {
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
                "Origin": WEB_ORIGIN,
                "Referer": `${WEB_ORIGIN}/search?${params.toString()}`,
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} failed to fetch Loopcloud search.`);
        }

        const data = await response.json();
        const rawItems = data.cloud_items || [];
        const items = rawItems.map((raw: any, index: number) => mapAsset(raw, index, query));
        const totalRecords = Number(data.total_entries || data.total || data.total_count || data.count || items.length);
        const totalRecordsKnown = Boolean(data.total_entries || data.total || data.total_count || data.count);
        const pagesCount = Number(data.pages_count || 0);

        return {
            items,
            totalRecords,
            totalRecordsKnown,
            hasMore: rawItems.length > 0 && (pagesCount ? query.page < pagesCount : !totalRecordsKnown || query.page * query.limit < totalRecords),
            tagSummary: [],
        };
    }

    async getAudioURL(asset: SoundAsset): Promise<string> {
        const existing = this.blobUrls.get(asset.uuid);
        if (existing) return existing;

        let signedUrl = this.signedUrls.get(asset.uuid);
        if (!signedUrl) {
            const response = await fetch(asset.downloadUrl, {
                headers: {
                    "User-Agent": USER_AGENT,
                    "Accept": "application/json",
                    "Origin": WEB_ORIGIN,
                    "Referer": asset.sourceUrl || WEB_ORIGIN,
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status} failed to resolve Loopcloud preview.`);
            }

            const data = await response.json();
            signedUrl = data.audio?.[asset.uuid];
            if (!signedUrl) {
                throw new Error("Loopcloud preview response did not include a signed audio URL.");
            }
            this.signedUrls.set(asset.uuid, signedUrl);
        }

        const audioResponse = await fetch(signedUrl, {
            headers: { "User-Agent": USER_AGENT },
        });

        if (!audioResponse.ok) {
            throw new Error(`HTTP ${audioResponse.status} failed to download Loopcloud preview.`);
        }

        const buffer = await audioResponse.arrayBuffer();
        const blobUrl = window.URL.createObjectURL(new Blob([buffer], { type: "audio/ogg" }));
        this.blobUrls.set(asset.uuid, blobUrl);
        return blobUrl;
    }

    freeAll() {
        for (const url of this.blobUrls.values()) {
            window.URL.revokeObjectURL(url);
        }
        this.blobUrls.clear();
        this.signedUrls.clear();
    }
}
