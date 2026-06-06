const LOCAL_SCOUT_CANDIDATES = [
  {
    name: "GBTA Convention 2026",
    startDate: "2026-07-20",
    endDate: "2026-07-22",
    city: "Denver",
    country: "USA",
    region: "North America",
    verticals: ["Travel", "Travel Tech", "Wholesalers", "Corporate Travel"],
    audience: 5300,
    seniority: 8,
    buyerDensity: 8,
    fxRelevance: 10,
    travelRelevance: 10,
    pspRelevance: 4,
    costTier: 6,
    source: "https://www.gbta.org/convention",
    recurringAnnual: true,
    historicalMonth: "july",
    dateConfirmed: false,
    pitchHook: "Corporate travel buyers and wholesale operators face live currency-margin exposure across global supplier contracts. Emphasize Grain's automated hedging workflows and forward booking controls."
  },
  {
    name: "Skift Global Forum 2026",
    startDate: "2026-09-16",
    endDate: "2026-09-18",
    city: "New York",
    country: "USA",
    region: "North America",
    verticals: ["Travel", "Hospitality", "Airlines", "Wholesalers"],
    audience: 1400,
    seniority: 10,
    buyerDensity: 8,
    fxRelevance: 8,
    travelRelevance: 10,
    pspRelevance: 4,
    costTier: 6,
    source: "https://skift.com/events/",
    recurringAnnual: true,
    historicalMonth: "september",
    dateConfirmed: false,
    pitchHook: "Travel executives are actively comparing margin protection strategies for international inventory. Lead with CFO-level volatility control and faster booking-policy enforcement."
  },
  {
    name: "BTN Group Business Travel Show America 2026",
    startDate: "2026-08-12",
    endDate: "2026-08-13",
    city: "New York",
    country: "USA",
    region: "North America",
    verticals: ["Travel", "Corporate Travel", "SaaS", "Wholesalers"],
    audience: 2200,
    seniority: 8,
    buyerDensity: 8,
    fxRelevance: 8,
    travelRelevance: 10,
    pspRelevance: 4,
    costTier: 4,
    source: "https://www.businesstravelshowamerica.com/",
    recurringAnnual: true,
    historicalMonth: "august",
    dateConfirmed: false,
    pitchHook: "Managed travel and supplier-payment teams are exposed to FX slippage across negotiated global programs. Position Grain as the control layer between forecasted bookings and treasury execution."
  },
  {
    name: "Money 20/20 Europe",
    startDate: "2026-06-02",
    endDate: "2026-06-04",
    city: "Amsterdam",
    country: "Netherlands",
    region: "Europe",
    verticals: ["Payments", "Fintech", "Banking"],
    audience: 7400,
    seniority: 10,
    buyerDensity: 10,
    fxRelevance: 10,
    travelRelevance: 4,
    pspRelevance: 10,
    costTier: 8,
    source: "https://europe.money2020.com/",
    pitchHook: "This is already represented in the active directory and should be deduped rather than inserted again."
  }
];

function localScoutResults(prompt, dateRange = parseScoutDateRange(prompt)) {
  const wantsTravel = /travel|wholesale|tour|airline/i.test(prompt);
  return LOCAL_SCOUT_CANDIDATES
    .filter((event) => !wantsTravel || event.verticals.some((vertical) => /travel|wholesale|airline/i.test(vertical)))
    .filter((event) => {
      const dates = normalizeScoutEventDates(event, dateRange);
      return dates && scoutDateWithinRange(dates, dateRange);
    });
}
