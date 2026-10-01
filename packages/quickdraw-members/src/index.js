// The agents of a board and their roles — a transcriber, a researcher, a
// reviewer… — so each knows what it is there for and what the others are,
// and people see and change who does what. Agents decide them among
// themselves, or people assign them; either way the table says who set each.
//
// It is a table kept in the board's Yjs document (a map beside the board's
// own, `members` by default), not shapes on the board: it syncs, persists and
// is kept in versions with the board, and a profile card on the board is only
// a view of it. One entry per agent, by name (case does not matter):
//   { name, role, about, avatar, by, at }
// role: a few words; about: a line on what it does; avatar: for its picture;
// by: who set it last (a person's or an agent's name); at: when (ms).

export { CARD, isMemberCard, isCardSupported, registerMemberCard, createMemberCard, validateMemberCard, bindMemberCards, editMemberCard, bindMemberCardEditing, memberTools, colorOf, CARD_ICONS } from './card.js'

export const MAX_ROLE = 60
export const MAX_ABOUT = 300
const key = (name) => String(name).trim().toLowerCase()
const text = (v, max) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max))

/** The members table of a board's Yjs document. */
export function bindMembers(ydoc, { name = 'members' } = {}) {
  const map = ydoc.getMap(name)
  const read = (v) => (v && typeof v === 'object' && typeof v.name === 'string' ? v : null)
  const api = {
    /** everyone in the table, by name */
    list() {
      return [...map.values()].map(read).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name))
    },
    get(member) {
      return read(map.get(key(member)))
    },
    /**
     * Sets an agent's role (and/or about, avatar); what is not given stays.
     * An empty role and about (and no avatar) takes it out of the table.
     */
    set(member, { role, about, avatar } = {}, by = '') {
      const was = api.get(member)
      const next = {
        name: was?.name ?? String(member).trim(),
        role: role === undefined ? was?.role ?? '' : text(role, MAX_ROLE),
        about: about === undefined ? was?.about ?? '' : text(about, MAX_ABOUT),
        avatar: avatar === undefined ? was?.avatar ?? null : avatar || null,
        by: text(by, 200), at: Date.now(),
      }
      if (!next.name) throw new Error('a member needs a name')
      if (!next.role && !next.about && !next.avatar) { map.delete(key(member)); return null }
      map.set(key(member), next)
      return next
    },
    remove(member) { map.delete(key(member)) },
    /** fn() on every change, here or from elsewhere; returns an unbind */
    onChange(fn) {
      const observer = () => fn()
      map.observe(observer)
      return () => map.unobserve(observer)
    },
  }
  return api
}
