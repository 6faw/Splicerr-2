import type { SearchQuery, SoundAsset } from "../provider.svelte";

export const BROWSER_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export function hashString(value: string) {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    }
    return hash >>> 0;
}

export function splitSearchTerms(value: string) {
    const query = value.trim();
    if (!query) return [];
    if (query.startsWith("\"") && query.endsWith("\"")) {
        return [query.replace(/^"|"$/g, "")].filter(Boolean);
    }
    return query.split(/\s+/).filter(Boolean);
}

export function normalizeTag(value: unknown) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();
}

export function normalizeTags(values: unknown[] | string | null | undefined) {
    const rawValues = Array.isArray(values)
        ? values
        : typeof values === "string"
          ? values.split(/[,\n;]/)
          : [];
    const seen = new Set<string>();
    const tags: Array<{ uuid: string; label: string }> = [];

    for (const value of rawValues) {
        const label = normalizeTag(value);
        const uuid = label.toLowerCase();
        if (!label || seen.has(uuid)) continue;
        seen.add(uuid);
        tags.push({ uuid, label });
    }

    return tags;
}

export function deriveTagsFromText(value: string, extra: unknown[] = []) {
    const textTags = value
        .split(/[|,;]+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 1 && part.length < 60);
    return normalizeTags([...extra, ...textTags]);
}

export function matchesCommonFilters(asset: SoundAsset, query: SearchQuery) {
    if (query.assetCategorySlug && asset.assetCategorySlug !== query.assetCategorySlug) {
        return false;
    }
    if (
        query.key ||
        query.chordType ||
        query.bpm ||
        query.minBpm !== null ||
        query.maxBpm !== null
    ) {
        return false;
    }
    return query.tags.every((tag) =>
        asset.tags.some((assetTag) => assetTag.uuid.toLowerCase() === tag.toLowerCase())
    );
}

export function sortItems(items: SoundAsset[], query: SearchQuery) {
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

export function buildTagSummary(items: SoundAsset[]) {
    const counts = new Map<string, { label: string; count: number }>();

    for (const item of items) {
        for (const tag of item.tags) {
            const existing = counts.get(tag.uuid);
            if (existing) {
                existing.count += 1;
            } else {
                counts.set(tag.uuid, { label: tag.label, count: 1 });
            }
        }
    }

    return Array.from(counts.entries())
        .map(([uuid, entry]) => ({
            tag: {
                uuid,
                label: entry.label,
                taxonomy: { uuid: "provider", name: "Provider" },
            },
            count: entry.count,
        }))
        .sort((a, b) => b.count - a.count || a.tag.label.localeCompare(b.tag.label))
        .slice(0, 40);
}

export function parseCookieHeader(setCookieHeader: string | null) {
    if (!setCookieHeader) return "";
    return setCookieHeader
        .split(/,(?=\s*[^=;,\s]+=)/)
        .map((cookie) => cookie.trim().match(/^([^=;]+=[^;]*)/)?.[1])
        .filter((cookie): cookie is string => Boolean(cookie))
        .join("; ");
}

export function mergeCookieHeaders(current: string, next: string) {
    const jar = new Map<string, string>();
    for (const source of [current, next]) {
        for (const cookie of source.split(";").map((part) => part.trim()).filter(Boolean)) {
            const [name] = cookie.split("=", 1);
            if (name) jar.set(name, cookie);
        }
    }
    return Array.from(jar.values()).join("; ");
}
