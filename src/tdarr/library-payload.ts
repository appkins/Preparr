import type { TdarrLibrary } from '@/config/schema'
import { mergeDeclared, type Plain } from './match'

/**
 * Building a library document.
 *
 * Tdarr has no "create library" call: the UI inserts a full document built
 * from a template, and the server assumes every key is present from then on.
 * So a new library starts from the same template the UI uses, and the
 * declared values are laid over it.
 */

// Tdarr's own spelling. "Thu" would render as an empty column in the
// schedule grid.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat']

const hour = (h: number): string => String(h % 24).padStart(2, '0')

function weeklySchedule(): { _id: string; checked: boolean }[] {
  return DAYS.flatMap((day) =>
    Array.from({ length: 24 }, (_, h) => ({
      _id: `${day}:${hour(h)}-${hour(h + 1)}`,
      checked: true,
    })),
  )
}

/** The classic plugin stack a new library ships with; unused once a flow is chosen. */
const DEFAULT_PLUGIN_STACK = [
  {
    _id: 'plugin1',
    id: 'Tdarr_Plugin_MC93_MigzImageRemoval',
    checked: true,
    source: 'Community',
    priority: 0,
    InputsDB: {},
  },
  {
    _id: 'plugin2',
    id: 'Tdarr_Plugin_lmg1_Reorder_Streams',
    checked: true,
    source: 'Community',
    priority: 1,
    InputsDB: {},
  },
  {
    _id: 'plugin3',
    id: 'Tdarr_Plugin_MC93_Migz1FFMPEG_CPU',
    checked: true,
    source: 'Community',
    priority: 2,
    InputsDB: {},
  },
  {
    _id: 'plugin4',
    id: 'Tdarr_Plugin_MC93_Migz1FFMPEG',
    checked: false,
    source: 'Community',
    priority: 3,
    InputsDB: {},
  },
  {
    _id: 'plugin5',
    id: 'Tdarr_Plugin_a9he_New_file_size_check',
    checked: true,
    source: 'Community',
    priority: 4,
    InputsDB: {},
  },
]

/**
 * The four transcode modes are exclusive flags. Choosing a flow in the UI
 * clears all of them and sets this one.
 */
export const FLOW_MODE = {
  settingsFlows: true,
  settingsPlugin: false,
  settingsVideo: false,
  settingsAudio: false,
}

/** A fresh copy of the template the UI creates a library from. */
export function libraryDefaults(): Plain {
  return {
    name: 'Library Name',
    folder: '',
    foldersToIgnore: '',
    foldersToIgnoreCaseInsensitive: false,
    folderWatchScanInterval: 30,
    scannerThreadCount: 2,
    cache: '',
    output: '',
    folderToFolderConversion: false,
    folderToFolderConversionDeleteSource: false,
    folderToFolderRecordHistory: true,
    copyIfConditionsMet: false,
    container: '.mkv',
    containerFilter: 'mkv,mp4,mov,m4v,mpg,mpeg,avi,flv,webm,wmv,vob,evo,iso,m2ts,ts',
    createdAt: Date.now(),
    folderWatching: false,
    useFsEvents: false,
    scheduledScanFindNew: false,
    processLibrary: true,
    processTranscodes: true,
    processHealthChecks: true,
    scanOnStart: false,
    exifToolScan: true,
    mediaInfoScan: true,
    ffprobeShowData: false,
    isDirectoryLibrary: false,
    closedCaptionScan: false,
    scanButtons: true,
    scanFound: '',
    navItemSelected: 'navSourceFolder',
    pluginIDs: structuredClone(DEFAULT_PLUGIN_STACK),
    pluginCommunity: true,
    handbrake: true,
    ffmpeg: false,
    handbrakescan: true,
    ffmpegscan: false,
    preset: '-Z "Very Fast 1080p30"',
    decisionMaker: {
      settingsPlugin: true,
      settingsFlows: false,
      settingsVideo: false,
      videoExcludeSwitch: true,
      video_codec_names_exclude: [
        { codec: 'hevc', checked: false },
        { codec: 'h264', checked: true },
      ],
      video_size_range_include: { min: 0, max: 100000 },
      video_height_range_include: { min: 0, max: 3000 },
      video_width_range_include: { min: 0, max: 4000 },
      settingsAudio: false,
      audioExcludeSwitch: true,
      audio_codec_names_exclude: [
        { codec: 'mp3', checked: true },
        { codec: 'aac', checked: false },
      ],
      audio_size_range_include: { min: 0, max: 10 },
    },
    schedule: weeklySchedule(),
    totalHealthCheckCount: 0,
    totalTranscodeCount: 0,
    sizeDiff: 0,
    holdNewFiles: false,
    holdFor: 3600,
    holdForDisplayUnit: 'hours',
    pluginStackOverview: true,
    filterResolutionsSkip: '',
    filterCodecsSkip: '',
    filterContainersSkip: '',
    processPluginsSequentially: true,
  }
}

/**
 * The server rewrites folder, cache and output through its own path
 * normaliser on every start, which trims and drops a trailing slash. Declared
 * as "/x/", the stored "/x" would read as a change on every pass thereafter.
 */
export function normalizePath(path: string): string {
  const trimmed = path.trim()
  const stripped = trimmed.replace(/\/+$/, '')
  return stripped === '' && trimmed.startsWith('/') ? '/' : stripped
}

const PATH_KEYS = ['folder', 'cache', 'output']

/**
 * The library as Tdarr would store it, but only the declared part: the named
 * fields, whatever passed through under Tdarr's own key names, and the flow
 * translated into the id and mode flags Tdarr reads. `variables` are their
 * own documents and are not part of the library at all.
 */
export function desiredLibrary(library: TdarrLibrary, flowId?: string): Plain {
  const { flow: _flow, variables: _variables, ...rest } = library
  const desired: Plain = {}

  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) {
      continue
    }
    desired[key] =
      PATH_KEYS.includes(key) && typeof value === 'string' ? normalizePath(value) : value
  }

  if (flowId !== undefined) {
    desired.flowId = flowId
    desired.decisionMaker = { ...FLOW_MODE }
  }

  return desired
}

export function newLibraryDocument(
  library: TdarrLibrary,
  options: { id: string; priority: number; flowId?: string | undefined },
): Plain {
  const declared = desiredLibrary(library, options.flowId)
  const document = mergeDeclared(libraryDefaults(), declared)

  document._id = options.id
  document.priority = library.priority ?? options.priority

  return document
}
