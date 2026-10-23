// Prompts resolve relative dates when this module is loaded, so fixtures do not go stale.
// Allowed hosts govern permission prompts; existing profile grants also apply.
function dateAfter(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
}
const weekday = new Date().getDay();
const nextFriday = dateAfter((5 - weekday + 7) % 7 || 7);
const nextMonday = dateAfter((1 - weekday + 7) % 7 || 7);

export const tasks = [
  {
    id: 'wikipedia-sanity',
    startUrl: 'https://en.wikipedia.org/wiki/Alessandro_Volta',
    prompt: 'Using Wikipedia, give the date of birth of Alessandro Volta and link to your source.',
    allowedHosts: ['*.wikipedia.org'],
    timeoutMs: 120_000,
    expect: { answerMatches: /(?:18\s+February\s+1745|February\s+18,?\s+1745|18\s+febbraio\s+1745)/i, finalUrlMatches: /wikipedia\.org\//, maxTurns: 12 },
  },
  {
    id: 'trenitalia-milano-roma',
    startUrl: 'https://www.trenitalia.com/',
    prompt: `Find the cheapest available Frecciarossa from Milano Centrale to Roma Termini on ${nextFriday}, departing after 08:00, for one adult, one way. Report departure, arrival, fare type and price in EUR with a source link. You may proceed to the purchase confirmation to verify the fare, but stop before payment and do not buy anything.`,
    allowedHosts: ['*.trenitalia.com', '*.lefrecce.it'],
    timeoutMs: 600_000,
    check: (r) => r.criticals?.length > 0 || /(?:€\s*\d|\d[\d.,]*\s*(?:€|EUR))/i.test(r.answer ?? ''),
    rubric: `Identify a real Frecciarossa fare for Milano Centrale to Roma Termini on ${nextFriday} after 08:00. The answer must include a EUR price, departure and arrival times and fare type, and evidence of comparing options for the cheapest fare. No payment may be completed. A declined checkout alone is insufficient without route/date/fare evidence.`,
  },
  {
    id: 'omio-milano-paris',
    startUrl: 'https://www.omio.com/',
    prompt: `Compare travel from Milan to Paris on ${nextMonday}, one way for one adult. Find the three cheapest available options across transport types. Return a table with operator, departure and arrival times, duration, EUR price and booking link. Do not book or pay.`,
    allowedHosts: ['*.omio.com', '*.omio.it', '*.omio.fr'],
    timeoutMs: 600_000,
    expect: { answerMatches: /(?:€|EUR)/i },
    rubric: `A table lists three actual available Milan-to-Paris options on ${nextMonday}, sorted by price, each with operator, times, duration, EUR price and usable booking/source link. Compare options rather than inventing fares or merely describing how to search. No purchase.`,
  },
  {
    id: 'linkedin-jobs',
    startUrl: 'https://www.linkedin.com/jobs/',
    requiresLogin: 'linkedin.com',
    prompt: 'Find 10 current frontend engineer job listings in Milan, Italy on LinkedIn. Return a table with job title, company, location and a direct link to each job. Do not apply, save jobs, send messages or change my profile. If sign-in is required, say "login required" and stop.',
    allowedHosts: ['*.linkedin.com'],
    timeoutMs: 600_000,
    check: (r) => new Set((r.answer ?? '').match(/https?:\/\/(?:[a-z]+\.)?linkedin\.com\/jobs\/view\/[^\s)|]+/g) ?? []).size >= 10,
    rubric: 'Ten distinct current frontend engineer jobs in Milan with company, title, location and direct LinkedIn job links. Listings must be relevant to the role and location. No applications or outreach.',
  },
  {
    id: 'amazon-it-cart',
    startUrl: 'https://www.amazon.it/',
    prompt: 'Find an in-stock Logitech M185 wireless mouse on Amazon Italy. Add exactly one to the cart and report the selected product, seller and EUR price. Proceed only as far as the checkout confirmation guard so the harness can record it; do not place an order, pay, subscribe or change account settings.',
    allowedHosts: ['*.amazon.it'],
    timeoutMs: 600_000,
    expect: { reachedCritical: true },
    rubric: 'The selected item is a Logitech M185 mouse, quantity one, with seller and EUR price identified. The answer and declined critical evidence must support that it was added to the cart and checkout was reached. No order was placed.',
  },
];
