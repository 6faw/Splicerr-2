import { registry } from "./provider.svelte"
import type { SoundAsset, SearchQuery } from "./provider.svelte"
import { SpliceSoundProvider } from "./providers/splice-provider"
import type {
    AssetCategorySlug,
    AssetSortType,
    ChordType,
    Key,
    SortOrder,
    TagSummaryEntry,
} from "$lib/splice/types"
import { globalAudio } from "./audio.svelte"
import { loading } from "./loading.svelte"
import { debugLog } from "./logger"

const spliceProvider = new SpliceSoundProvider();
const lazyProviders = [
    {
        id: "myinstants",
        name: "MyInstants",
        load: async () => new (await import("./providers/myinstants-provider")).MyInstantsSoundProvider(),
    },
    {
        id: "voicemod",
        name: "Voicemod",
        load: async () => new (await import("./providers/voicemod-provider")).VoicemodSoundProvider(),
    },
    {
        id: "epidemicsound",
        name: "Epidemic Sound (Link)",
        load: async () => new (await import("./providers/epidemicsound-provider")).EpidemicSoundProvider(),
    },
    {
        id: "prosoundeffects",
        name: "Pro Sound Effects",
        load: async () => new (await import("./providers/prosoundeffects-provider")).ProSoundEffectsProvider(),
    },
    {
        id: "soundsnap",
        name: "Soundsnap",
        load: async () => new (await import("./providers/soundsnap-provider")).SoundsnapProvider(),
    },
    {
        id: "sounddogs",
        name: "SoundDogs",
        load: async () => new (await import("./providers/sounddogs-provider")).SoundDogsProvider(),
    },
    {
        id: "loopcloud",
        name: "Loopcloud",
        load: async () => new (await import("./providers/loopcloud-provider")).LoopcloudSoundProvider(),
    },
    {
        id: "audiio",
        name: "Audiio (SFX)",
        load: async () => new (await import("./providers/audiio-provider")).AudiioSoundProvider(),
    },
    {
        id: "audiojungle",
        name: "AudioJungle",
        load: async () => new (await import("./providers/audiojungle-provider")).AudioJungleSoundProvider(),
    },
];

registry.register(spliceProvider);
for (const provider of lazyProviders) {
    registry.registerLazy(provider.id, provider.name, provider.load);
}
registry.setActive("splice");

export const DEFAULT_SORT = "relevance"
export const PER_PAGE = 50

export const randomSeed = () =>
    Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString()

export const dataStore = $state({
    sampleAssets: [] as SoundAsset[],
    descrambledSamples: new Map<string, string>(),
    tags: [] as string[],
    tag_summary: [] as TagSummaryEntry[],
    total_records: 0,
    total_records_known: true,
    has_more: false,
})

export const keys = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
] as const
export const chord_types = ["major", "minor"]

export const queryStore = $state({
    query: "",
    sort: DEFAULT_SORT as AssetSortType,
    random_seed: randomSeed(),
    order: "DESC" as SortOrder,
    page: 1,
    asset_category_slug: null as AssetCategorySlug | null,
    bpm: null as string | null,
    min_bpm: null as number | null,
    max_bpm: null as number | null,
    key: null as Key | null,
    chord_type: null as ChordType | null,
})

// The query identity is the part of the query that uniquely identifies the returned data
// It is used to determine if the fetched data should replace the current data, be appended to it, or be ignored
const queryIdentity = $derived({
    provider: registry.activeProviderIdValue,
    query: queryStore.query,
    sort: queryStore.sort,
    order: queryStore.order,
    random_seed: queryStore.random_seed,
    tags: dataStore.tags,
    asset_category_slug: queryStore.asset_category_slug,
    bpm: queryStore.bpm?.toString(),
    min_bpm: queryStore.min_bpm,
    max_bpm: queryStore.max_bpm,
    key: queryStore.key,
    chord_type: queryStore.chord_type,
})

export const storeCallbacks = $state({
    onbeforedataupdate: null as (() => void) | null,
    onbeforetagsupdate: null as (() => void) | null,
})

let currentQueryIdentity: string = ""

export const fetchAssets = () => {
    const identityBeforeFetch = JSON.stringify(queryIdentity)
    if (identityBeforeFetch != currentQueryIdentity) {
        storeCallbacks.onbeforedataupdate?.()
    }
    loading.assets = true

    const queryParams: SearchQuery = {
        query: queryStore.query,
        page: queryStore.page,
        limit: PER_PAGE,
        sort: queryStore.sort,
        order: queryStore.order as "ASC" | "DESC",
        tags: dataStore.tags,
        bpm: queryStore.bpm,
        minBpm: queryStore.min_bpm,
        maxBpm: queryStore.max_bpm,
        key: queryStore.key,
        chordType: queryStore.chord_type,
        assetCategorySlug: queryStore.asset_category_slug,
        randomSeed: queryStore.random_seed,
    };

    registry.getActiveProvider()
        .then((provider) => provider.search(queryParams))
        .then((result) => {
            const identityAfterFetch = JSON.stringify(queryIdentity)
            if (identityBeforeFetch == identityAfterFetch) {
                let loadedCount = result.items.length
                if (identityBeforeFetch == currentQueryIdentity) {
                    const existingUuids = new Set(dataStore.sampleAssets.map((asset) => asset.uuid))
                    dataStore.sampleAssets.push(
                        ...result.items.filter((asset) => !existingUuids.has(asset.uuid))
                    )
                    loadedCount = dataStore.sampleAssets.length
                    debugLog("Loaded more assets")
                } else {
                    // Free descrambled samples that are not in the new search result / currently selected
                    if (registry.activeProviderIdValue === "splice") {
                        const spliceProv = registry.activeProvider as SpliceSoundProvider;
                        for (const sampleAsset of dataStore.sampleAssets) {
                            if (
                                !result.items.some(
                                    (other) => sampleAsset.uuid == other.uuid
                                ) &&
                                sampleAsset.uuid != globalAudio.currentAsset?.uuid
                            ) {
                                spliceProv.freeDescrambledSample(sampleAsset.uuid);
                            }
                        }
                    }

                    // Load the new query results directly
                    dataStore.sampleAssets = result.items
                    loadedCount = dataStore.sampleAssets.length
                    currentQueryIdentity = identityAfterFetch
                    queryStore.page = 1
                    debugLog("Loaded new assets")
                }
                dataStore.total_records = result.totalRecords
                dataStore.total_records_known = result.totalRecordsKnown ?? true
                dataStore.has_more = result.hasMore ?? (loadedCount < result.totalRecords)

                storeCallbacks.onbeforetagsupdate?.()
                dataStore.tag_summary = result.tagSummary as any

                loading.assets = false
                loading.beforeFirstLoad = false

                loading.fetchError = null
            } else {
                debugLog("Ignored stale assets")
            }
        })
        .catch((error: Error) => {
            console.error("Failed to fetch assets", error)
            loading.fetchError = error
            loading.assets = false
        })
}

export async function getDescrambledSampleURL(sampleAsset: SoundAsset) {
    loading.samples.add(sampleAsset.uuid)
    loading.samplesCount++
    try {
        const provider = await registry.getProvider(sampleAsset.providerId)
        const url = await provider.getAudioURL(sampleAsset)
        return url
    } finally {
        loading.samples.delete(sampleAsset.uuid)
        loading.samplesCount--
    }
}

export function freeDescrambledSample(uuid: string) {
    if (registry.activeProviderIdValue === "splice") {
        return (registry.activeProvider as SpliceSoundProvider).freeDescrambledSample(uuid);
    }
    return false;
}
