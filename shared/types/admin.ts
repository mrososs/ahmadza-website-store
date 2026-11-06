// View-model types for the administration area.
export interface AdminBadges {
  books: { all: number; active: number; inactive: number; soon: number; trash: number }
  users: { all: number; review: number; active: number; banned: number; trash: number }
  categories: number; makers: number; articles: number; pages: number
  contacts: number; comments: number; requests: number; withdrawals: number
}
