// Mock HubSpot CRM export. In production this would come from the HubSpot
// CRM API (companies + deal pipeline); here it is a static, representative
// slice of Grain's target-account book so the "ICP Account Presence Matcher"
// can run end-to-end without a live HubSpot connection.
//
// Each account carries the three fields the matcher reasons over:
//   - company_name : the account.
//   - hubspot_status: lifecycle/deal stage as it would read in HubSpot.
//   - vertical      : Grain's internal ICP segment for the account.
// `hq` (region/city) grounds geographic alignment and `knownSponsorOf` lists
// conference ids where the account is a confirmed exhibitor/sponsor, so both
// the AI prompt and the local fallback can mark "Confirmed" deterministically.
const HUBSPOT_ACCOUNTS = [
  { company_name: "Stripe", hubspot_status: "Target Account", vertical: "PSP", hq: { region: "North America", city: "San Francisco" }, knownSponsorOf: ["money2020-usa-2026"] },
  { company_name: "Airwallex", hubspot_status: "Open Deal $120k", vertical: "Cross-Border Payments", hq: { region: "APAC", city: "Singapore" }, knownSponsorOf: ["m2020-eu-2026", "sff-2026"] },
  { company_name: "Thunes", hubspot_status: "Open Deal $45k", vertical: "Cross-Border Payments", hq: { region: "APAC", city: "Singapore" }, knownSponsorOf: ["sff-2026"] },
  { company_name: "Flywire", hubspot_status: "Target Account", vertical: "Cross-Border Payments", hq: { region: "North America", city: "Boston" }, knownSponsorOf: ["travel-payments-summit-2026"] },
  { company_name: "Ebury", hubspot_status: "Customer - Expansion", vertical: "FX & Treasury", hq: { region: "Europe", city: "London" }, knownSponsorOf: ["payments-leaders-summit-eu-2026"] },
  { company_name: "Wise", hubspot_status: "Cold Prospect", vertical: "Cross-Border Payments", hq: { region: "Europe", city: "London" }, knownSponsorOf: [] },
  { company_name: "Nium", hubspot_status: "Open Deal $80k", vertical: "Cross-Border Payments", hq: { region: "APAC", city: "Singapore" }, knownSponsorOf: ["m2020-eu-2026"] },
  { company_name: "Rapyd", hubspot_status: "Target Account", vertical: "PSP", hq: { region: "Europe", city: "London" }, knownSponsorOf: [] },
  { company_name: "Corpay (Cambridge)", hubspot_status: "Open Deal $200k", vertical: "Cross-Border Payroll", hq: { region: "North America", city: "Toronto" }, knownSponsorOf: [] },
  { company_name: "Convera", hubspot_status: "Target Account", vertical: "FX & Treasury", hq: { region: "North America", city: "Denver" }, knownSponsorOf: ["money2020-usa-2026"] },
  { company_name: "dLocal", hubspot_status: "Cold Prospect", vertical: "PSP", hq: { region: "LATAM", city: "Montevideo" }, knownSponsorOf: [] },
  { company_name: "Payoneer", hubspot_status: "Target Account", vertical: "Cross-Border Payments", hq: { region: "North America", city: "New York" }, knownSponsorOf: ["seamless-me-2026"] },
  { company_name: "TravelPerk", hubspot_status: "Open Deal $60k", vertical: "Travel Wholesaler", hq: { region: "Europe", city: "Barcelona" }, knownSponsorOf: ["phocuswright-eu-2026", "travel-tech-show-2026"] },
  { company_name: "WebBeds", hubspot_status: "Target Account", vertical: "Travel Wholesaler", hq: { region: "Middle East", city: "Dubai" }, knownSponsorOf: ["itb-berlin-2026"] },
  { company_name: "Hopper", hubspot_status: "Cold Prospect", vertical: "Travel Tech", hq: { region: "North America", city: "Montreal" }, knownSponsorOf: [] }
];
