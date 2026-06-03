import { appConfigDir, isAbsolute } from "@tauri-apps/api/path"
import {
    exists,
    BaseDirectory,
    readTextFile,
    create,
    writeTextFile,
    mkdir,
    stat,
} from "@tauri-apps/plugin-fs"
import { resetMode, setMode } from "mode-watcher"
import { debugLog } from "$lib/shared/logger"

const CONFIG_FILE_NAME = "config.json"

export type UITheme = "system" | "light" | "dark"

const DEFAULT_CONFIG = {
    samples_dir: null as string | null,
    ui_theme: "system" as UITheme,
    ui_scale: 1,
    cut_mp3_delay: true,
    repeat_audio: true,
    voicemod_session_cookie: "",
    envato_personal_token: "",
}

let samplesDirValid = $state(false)

export let settingsDialog = $state({ open: false })

export const isSamplesDirValid = () => samplesDirValid

export let config = $state<typeof DEFAULT_CONFIG>(
    JSON.parse(JSON.stringify(DEFAULT_CONFIG))
)

export async function validateSamplesDir() {
    async function validate() {
        if (!config.samples_dir) return false
        if (!(await isAbsolute(config.samples_dir))) return false
        if (!(await exists(config.samples_dir))) return false
        if (!(await stat(config.samples_dir)).isDirectory) return false
        return true
    }

    samplesDirValid = await validate()

    debugLog(
        samplesDirValid
            ? "Samples directory is valid"
            : "Samples directory is invalid"
    )

    return samplesDirValid
}

export async function loadConfig() {
    if (
        !(await exists(CONFIG_FILE_NAME, { baseDir: BaseDirectory.AppConfig }))
    ) {
        debugLog("Config not found, keeping default")
    } else {
        const fileContent = await readTextFile("config.json", {
            baseDir: BaseDirectory.AppConfig,
        })
        Object.assign(config, JSON.parse(fileContent))
        debugLog("Config loaded")
    }

    await validateSamplesDir()
}

export async function saveConfig() {
    await validateSamplesDir()

    const appConfig = await appConfigDir()
    if (!(await exists(appConfig))) await mkdir(appConfig)

    if (
        !(await exists(CONFIG_FILE_NAME, { baseDir: BaseDirectory.AppConfig }))
    ) {
        await create(CONFIG_FILE_NAME, { baseDir: BaseDirectory.AppConfig })
    }

    await writeTextFile(CONFIG_FILE_NAME, JSON.stringify(config), {
        baseDir: BaseDirectory.AppConfig,
    })
    debugLog("Config saved")
}

export function updateTheme() {
    switch (config.ui_theme) {
        case "system":
            resetMode()
            break
        default:
            setMode(config.ui_theme)
            break
    }
}
