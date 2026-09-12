/**
 * LazyLibrarian's config.ini, edited in place.
 *
 * LazyLibrarian has no API for its settings -- they exist only in this file --
 * so configuring it means editing the file the application itself owns and
 * rewrites. Two consequences shape everything here:
 *
 *  * Every setting not being managed has to survive untouched. The file holds
 *    the whole application's state, most of it set through its own interface.
 *
 *  * Keys have to be matched without regard to case. LazyLibrarian reads with
 *    optionxform upper() and writes with lower(), so the same setting can
 *    appear in either case depending on who wrote it last; matching exactly
 *    would append a second copy of a key that is already there.
 *
 * Written back in lower case, which is what the application produces itself.
 */

export interface IniEntry {
  /** As written in the file, so a key already present keeps its spelling. */
  key: string
  value: string
}

export type IniSection = Map<string, IniEntry>
export type Ini = Map<string, { name: string; entries: IniSection }>

const SECTION = /^\s*\[([^\]]+)\]\s*$/
const ENTRY = /^\s*([^=;#\s][^=]*?)\s*=\s*(.*?)\s*$/

export function parseIni(text: string): Map<string, IniSection> {
  const parsed = parseFile(text)
  return new Map([...parsed].map(([key, section]) => [key, section.entries]))
}

function parseFile(text: string): Ini {
  const ini: Ini = new Map()
  let current: { name: string; entries: IniSection } | undefined

  for (const line of text.split('\n')) {
    const section = SECTION.exec(line)
    if (section?.[1]) {
      const name = section[1]
      const existing = ini.get(name.toLowerCase())
      current = existing ?? { name, entries: new Map() }
      ini.set(name.toLowerCase(), current)
      continue
    }

    const entry = ENTRY.exec(line)
    if (entry?.[1] !== undefined && current) {
      current.entries.set(entry[1].toLowerCase(), { key: entry[1], value: entry[2] ?? '' })
    }
  }

  return ini
}

/** Apply `desired` over the file's own contents, leaving the rest as it was. */
export function mergeIni(existing: string, desired: Record<string, Record<string, string>>): Ini {
  const ini = parseFile(existing)

  for (const [sectionName, settings] of Object.entries(desired)) {
    const key = sectionName.toLowerCase()
    const section = ini.get(key) ?? { name: sectionName, entries: new Map() }
    ini.set(key, section)

    for (const [settingName, value] of Object.entries(settings)) {
      section.entries.set(settingName.toLowerCase(), { key: settingName, value })
    }
  }

  return ini
}

export function renderIni(ini: Ini): string {
  const blocks: string[] = []

  for (const section of ini.values()) {
    const lines = [`[${section.name}]`]

    for (const entry of section.entries.values()) {
      lines.push(`${entry.key.toLowerCase()} = ${entry.value}`)
    }

    blocks.push(lines.join('\n'))
  }

  return `${blocks.join('\n\n')}\n`
}
