// brain/kernel/vault — lectura del vault Obsidian (People/Companies cards + frontmatter). Toca fs → tests con fixtures.
import { existsSync, readFileSync, readdirSync } from "fs"
import { slug } from "./keys.mjs"

export function peopleNodes() { return existsSync("./vault/People") ? readdirSync("./vault/People").filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)) : [] }
export function companyNodes() { return existsSync("./vault/Companies") ? readdirSync("./vault/Companies").filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)) : [] }
export function cardFor(type, name) { const p = `./vault/${type}/${slug(name)}.md`; return existsSync(p) ? readFileSync(p, "utf8") : "" }
export function fm(card, key) { return (card.match(new RegExp(`^${key}:\\s*(.*)$`, "m"))?.[1] || "").replace(/^\[|\]$/g, "").trim() }
