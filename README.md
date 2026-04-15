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

## Recommended next step: local validation

Before moving to always-on hosting, validate the ImmoScout session flow locally on your Mac:

1. Install Python 3
2. Install Node.js
3. In the project folder run `npm install`
4. Run `npm run playwright:install`
5. Start with `start.command`
6. Open the Import tab and use `Mit ImmoScout verbinden`
7. Complete the login in the browser window that opens on this Mac
8. Test one exposé URL and one search URL without using the cookie field
9. Restart the server and verify the session still works

Use `Verbindung zurücksetzen` to remove the stored local Playwright profile and retest the recovery flow.

Fallback from terminal:

- `python3 server.py`

The local app runs at `http://127.0.0.1:8000`.

## Always-on deployment (later)

Primary deployment target remains a private always-on service once local validation is stable.

- Host the app behind a private URL
- Keep the Python server running permanently
- Store the Playwright profile on persistent disk so the ImmoScout session survives restarts

Recommended container path:

```bash
docker build -t flat-analyzer .
docker run -p 8000:8000 -v flat-analyzer-data:/data flat-analyzer
```

Then open `http://<your-host>:8000`.

## Import (MVP)

The import tab supports three paths:

1. Paste an ImmoScout URL and let the running service fetch it
2. If ImmoScout blocks the plain HTTP fetch, the server can retry via Playwright using the stored ImmoScout session
3. Paste raw HTML manually if you want a fallback without URL fetching

You can also paste JSON exported by this app.

### ImmoScout connection

- Use the `ImmoScout-Verbindung` area in the Import tab to connect once
- The backend stores the Playwright browser profile and reuses it for later imports
- If the session expires, the UI should show `Erneut verbinden`
- `Verbindung zurücksetzen` clears the stored local Playwright profile so you can test reconnect/recovery
- The cookie field in settings remains only as a fallback/debug option

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
