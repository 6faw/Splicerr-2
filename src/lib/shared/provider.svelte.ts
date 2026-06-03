import { debugLog } from "./logger";

export interface SoundAsset {
    uuid: string;
    name: string;
    bpm: number | null;
    key: string | null;
    chordType: string | null;
    duration: number;
    previewUrl: string;
    downloadUrl: string;
    providerId: string;
    assetCategorySlug: string | null;
    packName: string;
    packCoverUrl: string | null;
    sourceUrl: string | null;
    waveformUrl: string | null;
    tags: Array<{ uuid: string; label: string }>;
    rawAsset: any;
}

export interface SearchQuery {
    query: string;
    page: number;
    limit: number;
    sort: string;
    order: "ASC" | "DESC";
    tags: string[];
    bpm: string | null;
    minBpm: number | null;
    maxBpm: number | null;
    key: string | null;
    chordType: string | null;
    assetCategorySlug: string | null;
    randomSeed: string;
}

export interface SearchResult {
    items: SoundAsset[];
    totalRecords: number;
    totalRecordsKnown?: boolean;
    hasMore?: boolean;
    tagSummary: Array<{
        tag: { uuid: string; label: string; taxonomy: { uuid: string; name: string } };
        count: number;
    }>;
}

export interface SoundProvider {
    id: string;
    name: string;
    search(query: SearchQuery): Promise<SearchResult>;
    getAudioURL(asset: SoundAsset): Promise<string>;
}

type ProviderLoader = () => Promise<SoundProvider>;

class ProviderRegistry {
    private providers = new Map<string, SoundProvider>();
    private providerEntries = new Map<string, {
        name: string;
        loader?: ProviderLoader;
        promise?: Promise<SoundProvider>;
    }>();
    private activeProviderId = $state<string>("splice");

    get activeProviderIdValue(): string {
        return this.activeProviderId;
    }

    get activeProviderName(): string {
        return this.providerEntries.get(this.activeProviderId)?.name || this.activeProviderId;
    }

    get activeProvider(): SoundProvider {
        const provider = this.providers.get(this.activeProviderId);
        if (!provider) {
            throw new Error(`Provider '${this.activeProviderId}' has not loaded yet`);
        }
        return provider;
    }

    register(provider: SoundProvider) {
        this.providers.set(provider.id, provider);
        this.providerEntries.set(provider.id, { name: provider.name });
        debugLog(`Registered sound provider: ${provider.name} (${provider.id})`);
    }

    registerLazy(id: string, name: string, loader: ProviderLoader) {
        this.providerEntries.set(id, { name, loader });
    }

    setActive(id: string) {
        if (!this.providerEntries.has(id)) {
            throw new Error(`SoundProvider '${id}' is not registered`);
        }
        this.activeProviderId = id;
        debugLog(`Active sound provider switched to: ${id}`);
    }

    async getProvider(id: string): Promise<SoundProvider> {
        const provider = this.providers.get(id);
        if (provider) return provider;

        const entry = this.providerEntries.get(id);
        if (!entry?.loader) {
            throw new Error(`Provider '${id}' is not registered`);
        }

        entry.promise ??= entry.loader().then((loadedProvider) => {
            this.providers.set(loadedProvider.id, loadedProvider);
            this.providerEntries.set(loadedProvider.id, {
                ...entry,
                name: loadedProvider.name,
            });
            debugLog(`Loaded sound provider: ${loadedProvider.name} (${loadedProvider.id})`);
            return loadedProvider;
        });

        return entry.promise;
    }

    getActiveProvider(): Promise<SoundProvider> {
        return this.getProvider(this.activeProviderId);
    }

    getProvidersList(): Array<{ id: string; name: string }> {
        return Array.from(this.providerEntries.entries()).map(([id, entry]) => ({
            id,
            name: entry.name,
        }));
    }
}

export const registry = new ProviderRegistry();
