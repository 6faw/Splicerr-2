import type { SoundProvider, SoundAsset, SearchQuery, SearchResult } from "../provider.svelte";
import { debugLog } from "../logger";
import { fetch } from "@tauri-apps/plugin-http";
import {
    BROWSER_USER_AGENT,
    buildTagSummary,
    matchesCommonFilters,
    mergeCookieHeaders,
    normalizeTags,
    parseCookieHeader,
    sortItems,
} from "./provider-utils";

const ORIGIN = "https://www.soundsnap.com";
const STORAGE_ORIGIN = "https://soundsnap-prod.nyc3.digitaloceanspaces.com";

function extractConfig(html: string) {
    const key = html.match(/"typesenseSearchKey":"([^"]+)"/)?.[1];
    const collection = html.match(/"typesenseSearchCollection":"([^"]+)"/)?.[1];
    const node = html.match(/"typesenseNodes":\{"0":"([^"]+)"/)?.[1] || "ts231.search-soundsnap.com";

    if (!key || !collection) {
        throw new Error("Could not read Soundsnap search configuration");
    }

    return { key, collection, node };
}

function toMp3Path(filePath: string) {
    return filePath.replace(/\.[a-z0-9]+$/i, ".mp3");
}

function soundPageUrl(raw: any) {
    return raw.url ? `${ORIGIN}/${raw.url}` : ORIGIN;
}

function mapAsset(raw: any): SoundAsset {
    const filePath = raw["audio.filepath"] || "";
    const playUrl = `${ORIGIN}/play?t=e&p=${encodeURIComponent(toMp3Path(filePath))}`;
    const picturePath = raw["user.picturePath"];
    const category = raw["vocab.category.lvl.0"];
    const subCategory = raw["vocab.category.lvl.1"];
    const tags = normalizeTags([
        category,
        subCategory,
        raw["user.name"],
        ...(Array.isArray(raw["vocab.tag.name"]) ? raw["vocab.tag.name"] : []),
    ]);

    return {
        uuid: `soundsnap:${raw.id || raw.nid}`,
        name: raw.title || raw.body || "Soundsnap Sound",
        bpm: raw["audio.bpm"] ? Number(raw["audio.bpm"]) : null,
        key: null,
        chordType: null,
        duration: Math.round(Number(raw["audio.playTime"] || 0) * 1000),
        previewUrl: playUrl,
        downloadUrl: playUrl,
        providerId: "soundsnap",
        assetCategorySlug: "oneshot",
        packName: raw["user.name"] || category || "Soundsnap",
        packCoverUrl: picturePath ? `${STORAGE_ORIGIN}/${picturePath}` : null,
        sourceUrl: soundPageUrl(raw),
        waveformUrl: null,
        tags,
        rawAsset: raw,
    };
}

export class SoundsnapProvider implements SoundProvider {
    readonly id = "soundsnap";
    readonly name = "Soundsnap";

    private cookieHeader = "";
    private config: { key: string; collection: string; node: string } | null = null;
    private blobUrls = new Map<string, string>();

    private mergeCookies(response: Response) {
        this.cookieHeader = mergeCookieHeaders(
            this.cookieHeader,
            parseCookieHeader(response.headers.get("set-cookie"))
        );
    }

    private async bootstrap(query: string) {
        const rootResponse = await fetch(ORIGIN, {
            headers: { "User-Agent": BROWSER_USER_AGENT },
        });
        this.mergeCookies(rootResponse);

        const slug = encodeURIComponent(query.trim() || "sound");
        const pageResponse = await fetch(`${ORIGIN}/search/audio/${slug}`, {
            headers: {
                "User-Agent": BROWSER_USER_AGENT,
                "Cookie": this.cookieHeader,
            },
        });
        this.mergeCookies(pageResponse);

        if (!pageResponse.ok) {
            throw new Error(`HTTP ${pageResponse.status} failed to load Soundsnap search config`);
        }

        this.config = extractConfig(await pageResponse.text());
    }

    async search(query: SearchQuery): Promise<SearchResult> {
        await this.bootstrap(query.query);

        const config = this.config!;
        const params = new URLSearchParams({
            q: query.query.trim() || "*",
            query_by: "title,body",
            per_page: query.limit.toString(),
            page: query.page.toString(),
        });

        if (query.sort === "recency") {
            params.set("sort_by", "created:desc");
        }

        const url = `https://${config.node}/collections/${config.collection}/documents/search?${params.toString()}`;
        debugLog("Querying Soundsnap:", url);

        const response = await fetch(url, {
            headers: {
                "User-Agent": BROWSER_USER_AGENT,
                "X-TYPESENSE-API-KEY": config.key,
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} failed to fetch from Soundsnap`);
        }

        const data = await response.json();
        const items = sortItems(
            (data.hits || []).map((hit: any) => mapAsset(hit.document)).filter((asset: SoundAsset) => matchesCommonFilters(asset, query)),
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
            totalRecords: hasLocalFilters ? items.length : Number(data.found || items.length),
            tagSummary: buildTagSummary(items),
        };
    }

    async getAudioURL(asset: SoundAsset): Promise<string> {
        const existing = this.blobUrls.get(asset.uuid);
        if (existing) return existing;

        if (!this.cookieHeader) {
            await this.bootstrap("");
        }

        const response = await fetch(asset.downloadUrl, {
            headers: {
                "User-Agent": BROWSER_USER_AGENT,
                "Referer": asset.sourceUrl || ORIGIN,
                "Cookie": this.cookieHeader,
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} failed to download Soundsnap preview`);
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
