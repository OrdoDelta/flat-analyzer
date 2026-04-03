# Flat Analyzer (local MVP)

Simple local web app to score flat offers with a traffic-light result:

- **Green**: call immediately (meets all green thresholds)
- **Yellow**: take a look (meets all yellow thresholds)
- **Red**: no go (outside yellow thresholds)
- **Gray**: incomplete (missing key data)

## Collaboration

For multi-thread Codex work on this repo, use the workflow in `COLLABORATION.md`.

Recommended structure:

- one main integration thread
- one parsing thread for `app.js`
- one UI thread for `index.html` and `styles.css`
- one tooling/docs thread for `server.py`, `start.command`, and `README.md`

## Run locally

Preferred start:

1. Install Python 3
2. Install Node.js (required for the Playwright fallback)
3. In the project folder run `npm install`
4. Start the app with `start.command`

Fallback start from terminal:

- `python3 server.py`

The app runs at `http://127.0.0.1:8000`.

## Import (MVP)

The import tab supports three paths:

1. Paste an ImmoScout URL and let the local server fetch it
2. If ImmoScout blocks the plain HTTP fetch, the server can retry via Playwright using a locally saved browser session
3. Paste raw HTML manually if you want a fallback without URL fetching

You can also paste JSON exported by this app.

### Playwright fallback

- The first blocked ImmoScout request may open a Chromium window
- If login is required, sign in once there
- The browser profile is saved locally in `.playwright-profile/`, so later imports can reuse the session
- If Playwright is not installed, URL import still works for pages that the plain HTTP fetch can access

## Metrics

- **€/m²** = `price / sqm`
- **Annual rent** = `monthlyRent * 12`
- **Price @ target yield** = `annualRent / targetYield / (1 + purchaseCostsPct/100)`
- **Total acquisition cost** = `price * (1 + purchaseCostsPct/100)`
- **Gross yield** = `annualRent / totalAcquisitionCost`
- **Rent multiplier** = `totalAcquisitionCost / annualRent`

## Next steps (when you’re ready)

- Add more criteria (district, commute time, floor, energy class) as soft-scoring.
- Add multi-user + hosting (still works as a small web app).

## GitHub publish

This folder is now set up as its own git repository.

To publish it as a dedicated GitHub repo later:

1. Create a new empty GitHub repository, for example `flat-analyzer`
2. In this folder, add the remote:
   `git remote add origin <your-repo-url>`
3. Push the first version:
   `git add .`
   `git commit -m "Initial MVP"`
   `git branch -M main`
   `git push -u origin main`

If you want, the next improvement after publishing is to host the static app with GitHub Pages or Vercel.
