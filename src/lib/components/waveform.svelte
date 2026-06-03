<script lang="ts">
    import { loading } from "$lib/shared/loading.svelte"
    import { uid } from "$lib/shared/uid"
    import { fetch } from "@tauri-apps/plugin-http"
    import pako from "pako"
    import { inview } from "svelte-inview"
    import { cn } from "$lib/utils"
    import { debugLog } from "$lib/shared/logger"

    const key = `progress-gradient-${uid()}`

    let ref = null! as HTMLButtonElement

    let {
        src,
        progress = 0,
        seed = "",
        class: className,
        onseek,
    }: {
        src: string
        progress?: number
        seed?: string
        class?: string
        onseek: (progress: number) => void
    } = $props()

    let waveform = $state<number[]>(new Array(800).fill(0))

    let loadedSrc = $state("")

    let isLoading = $state(false)

    let isInView = $state(true)

    const loaded = $derived(src ? loadedSrc == src : true)

    // Simple hash-based PRNG for deterministic, unique waveforms per asset
    function seededRandom(s: string) {
        let h = 0;
        for (let i = 0; i < s.length; i++) {
            h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        }
        return () => {
            h = (h * 1103515245 + 12345) & 0x7fffffff;
            return h / 0x7fffffff;
        };
    }

    $effect(() => {
        if (!src) {
            const rng = seed ? seededRandom(seed) : Math.random;
            const mockWaveform: number[] = [];
            // Pick unique frequency/phase parameters per seed
            const freq1 = 4 + rng() * 14;
            const freq2 = 8 + rng() * 24;
            const phase1 = rng() * Math.PI * 2;
            const phase2 = rng() * Math.PI * 2;
            const amp1 = 0.06 + rng() * 0.14;
            const amp2 = 0.02 + rng() * 0.08;
            for (let i = 0; i < 200; i++) {
                const t = i / 200;
                const envelope = Math.sin(t * Math.PI);
                const val = 0.12
                    + Math.sin(t * freq1 + phase1) * amp1
                    + Math.sin(t * freq2 + phase2) * amp2
                    + rng() * 0.04;
                mockWaveform.push(Math.max(0.02, Math.min(0.9, val * (0.4 + envelope * 0.6))));
            }
            waveform = mockWaveform;
            loadedSrc = "";
            isLoading = false;
            return;
        }
        if (!isLoading && !loaded && !loading.fetchError) {
            fetchWaveform()
        }
    })

    function fetchWaveform() {
        isLoading = true
        loading.waveformsCount += 1
        const loadingSrc = src
        fetch(src)
            .then((resp) => {
                if (loadingSrc == src) {
                    if (resp.headers.get("content-encoding") == "gzip") {
                        resp.arrayBuffer().then((buff) => {
                            const inflated = pako.inflate(
                                new Uint8Array(buff),
                                {
                                    to: "string",
                                }
                            )
                            waveform = JSON.parse(inflated)
                        })
                    } else {
                        resp.json().then((json) => {
                            waveform = json
                        })
                    }
                    loadedSrc = src
                    loading.waveformsCount -= 1
                    isLoading = false
                } else {
                    debugLog("Ignored stale waveform")
                    loading.waveformsCount -= 1
                    isLoading = false
                }
            })
            .catch((error: Error) => {
                console.error("Failed loading waveform", error)
                loading.waveformsCount -= 1
            })
    }

    function generateWaveformPath(data: number[]) {
        const pathData = []
        const width = 1000 // Total width of the SVG
        const height = 200 // Total height of the SVG
        const midHeight = height / 2
        const step = width / data.length // Horizontal step size for each data point

        // Top half of the waveform
        pathData.push(`M 0 ${midHeight}`)
        data.forEach((value, index) => {
            const x = index * step
            const y = midHeight - value * midHeight // Flip vertically
            pathData.push(`L ${x} ${y}`)
        })

        // Bottom half (mirrored) of the waveform
        for (let i = data.length - 1; i >= 0; i--) {
            const x = i * step
            const y = midHeight + data[i] * midHeight
            pathData.push(`L ${x} ${y}`)
        }

        pathData.push("Z") // Close the path
        return pathData.join(" ")
    }
</script>

<button
    class={cn(className, "focus:outline-none cursor-grab")}
    use:inview
    tabindex={-1}
    oninview_change={(event) => (isInView = event.detail.inView)}
    onclick={(event) => {
        const rect = ref.getBoundingClientRect()
        progress = (event.clientX - rect.left) / rect.width
        onseek(progress)
    }}
    bind:this={ref}
    aria-label="Waveform"
>
    {#if waveform}
        <svg
            class={cn(
                "size-full transition-transform duration-1000",
                isInView && "",
                !loaded && "scale-y-0"
            )}
            viewBox={`0 0 1000 200`}
            preserveAspectRatio="none"
        >
            <defs>
                <linearGradient id={key} x1="0" y1="0" x2="1" y2="0">
                    <stop
                        offset={`${progress * 100 || 0}%`}
                        stop-color="hsl(var(--primary))"
                    />
                    <stop
                        offset={`${progress * 100 || 0}%`}
                        stop-color="hsl(var(--muted-foreground))"
                    />
                </linearGradient>
            </defs>
            <path d={generateWaveformPath(waveform)} fill={`url(#${key})`} />
        </svg>
    {/if}
</button>
