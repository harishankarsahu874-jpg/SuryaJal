export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"]
export const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"]

/** Indian digit grouping: 1,40,400 */
export const fmtIN = (n: number, d = 0) =>
  Number(n).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d })

/** ₹1,40,400 (full, like the reference dashboard) */
export const rupees = (n: number) => `${n < 0 ? "−" : ""}₹${fmtIN(Math.abs(Math.round(n)))}`

/** ₹1.40 lakh / ₹2.10 crore for tight spots */
export const rupeesShort = (n: number) =>
  Math.abs(n) >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : Math.abs(n) >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L`
    : `₹${fmtIN(Math.round(n))}`

export const litres = (n: number) => (n >= 1e5 ? `${(n / 1e5).toFixed(2)} lakh L` : `${fmtIN(Math.round(n))} L`)

export const compact = (v: number) =>
  v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k` : `${Math.round(v)}`

export const sqft = (m2: number) => m2 * 10.7639

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return "SJ"
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] ?? "")).toUpperCase()
}

export function timeAgo(ts: number) {
  const s = Math.max(1, Math.round(Date.now() / 1000 - ts))
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`
  return new Date(ts * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}
