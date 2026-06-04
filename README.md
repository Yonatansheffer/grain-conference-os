# Grain Conference Tool

A no-build static web app for Grain's sales team to prioritize conferences, plan annual coverage, capture show-floor leads, detect repeat contacts, draft relationship summaries with optional AI, and export or push leads to HubSpot.

## Run locally

Open `index.html` in a browser. No build pipeline is required.

For a local server:

```powershell
python -m http.server 8080
```

Then visit `http://localhost:8080`.

## Deploy

Use GitHub Pages, Netlify Drop, Vercel static hosting, or any static file host. The required files are:

- `index.html`
- `styles.css`
- `app.js`
- `data.js`

## Product scope

The app is intentionally built around a salesperson's workflow:

- Conference list with filters for vertical, region, status, search, tier, and source links.
- ICP scoring that emphasizes PSP/payment density, FX exposure, buyer density, seniority, travel-wholesaler relevance, and cost.
- Planning view that highlights monthly coverage, under-invested verticals, and 30-day trip clusters.
- Fast capture form for show-floor use, with only the fields a rep can realistically log between conversations.
- Cross-conference relationship tracking using email, normalized names, company similarity, initials, and fuzzy edit distance.
- Optional AI feature for relationship summaries and follow-up guidance.
- HubSpot CSV export plus optional direct contact creation with a user-provided private app token.

## Scoring logic

`ICP Score = buyer density, PSP/payment fit, FX exposure, travel relevance, seniority, audience reach - cost`.

Tier A is for events worth senior coverage or sponsorship consideration. Tier B is for focused rep coverage. Tier C is for monitoring, partner meetings, or piggybacking onto nearby travel.

## AI and integration keys

No API keys are hardcoded. Settings are stored only in the user's browser local storage.

- AI: OpenAI-compatible chat completions endpoint, configurable key and model.
- HubSpot: private app token supplied in the Settings view.

## Sample data notes

The conference dataset is seeded from public event pages and practical estimates where exact audience size is not publicly emphasized. Key sources include Money20/20 Europe, Money20/20 USA, Phocuswright Europe, Seamless Fintech Middle East, Singapore FinTech Festival, FinovateEurope, TravelTech Show, ITB Berlin, Global Fintech Fest, MRC, Airline & Travel Payments Summit, and Payments Leaders' Summit.

## Demo talking points

1. Start as a rep deciding where to spend time: filter to Payments or Travel, compare Tier A and B events, open the selected event detail.
2. Explain the score: Grain needs FX pain, PSP/payment density, travel wholesale exposure, and senior buyers, not just big generic tech audiences.
3. Open Planning: point out clusters around London/Europe in spring and the late-year APAC/payment-heavy stretch.
4. Capture a lead quickly: enter a repeat-ish contact and show the possible match warning before saving.
5. Open Relationships: show how repeat contact tracking distinguishes warming buyer signals from polite repeat curiosity.
6. Open Settings: explain optional AI summaries and HubSpot CSV/API paths, with keys configured by the user.

## Next week ideas

- Real HubSpot OAuth and field mapping setup.
- Conference discovery assistant that reads public event pages and suggests new records for approval.
- Calendar sync and Slack alerts for under-covered Tier A events.
- Mobile badge scan or business-card OCR.
- Team capacity planning by territory and travel budget.
