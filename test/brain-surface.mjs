// Candidato #2 — INVARIANTE de superficie: la fachada brain.mjs debe seguir exportando los 66 nombres
// en TODO estado intermedio del split (como el 45/45 de Wave 1). Si un re-export se pierde, un caller se rompe → este test lo caza.
// Runner: node --test test/brain-surface.mjs
import "./_setup.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import * as brain from "../src/lib/brain.mjs"

const EXPECTED = [
  "emailBody", "contactProfile", "threadMedia", "channelHealth", "freeSlots", "dayEvents", "conflictsAt",
  "scheduleIntent", "ingestLag", "createSchedule", "cancelSchedule", "rescheduleSchedule", "threadMeetings",
  "detectScheduleText", "ingestSocial", "ingestMyStyle", "socialHighlights", "socialDigest", "linkedinDrafts",
  "channelAccountLast", "threadTargets", "sendReply", "sendReplyAudio", "sendReplyMedia", "genEspacioCards",
  "invalidateThreads", "listThreads", "searchMessages", "resolvePerson", "personView", "coachData", "weeklyReview",
  "coachAction", "agenda", "directory", "summary", "ask", "routerSearch", "draftReply", "composeCorrect",
  "meetingPrep", "lastMessageTs", "actionDone", "notesDigest", "notesChat", "notesChatSend", "notesChatHistory",
  "notesClips", "homeSnapshot", "homeData", "suggestObjetivos", "unifiedThread", "catchup", "suggestReply",
  "summarizeChat", "meetingDetail", "mtgId", "_testMatchObjetivo", "genMeetingCards", "meetingCard", "calendarData",
  "genPersonCards", "personCard", "mergeThreadsInto", "mergeSuggestions", "espacioView",
]

test("la fachada brain.mjs exporta los 66 nombres (invariante en todo estado del split)", () => {
  assert.equal(EXPECTED.length, 66, "la lista de referencia debe tener 66 nombres")
  const missing = EXPECTED.filter((n) => brain[n] === undefined)
  assert.deepEqual(missing, [], `faltan exports en la fachada: ${missing.join(", ")}`)
})

test("los kernels internos NO se re-exportan por la fachada (el seam de helpers no cruza)", () => {
  for (const internal of ["contactName", "cardFor", "threadKeyOf", "norm", "canonOfKey", "photoFor"]) {
    assert.equal(brain[internal], undefined, `${internal} es un helper de kernel: no debe salir por la fachada`)
  }
})
