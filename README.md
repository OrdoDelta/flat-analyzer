# Flat Analyzer (local MVP)

Simple local web app to score flat offers with a traffic-light result:

- **Green**: call immediately (meets all green thresholds)
- **Yellow**: take a look (meets all yellow thresholds)
- **Red**: no go (outside yellow thresholds)
- **Gray**: incomplete (missing key data)

## Run locally

Open `index.html` in your browser.

Tip: if you use VS Code, you can install an extension like “Live Server” and run it from VS Code (no terminal needed).

## Import (MVP)

Because direct scanning of ImmoScout URLs usually runs into **login/CORS/bot protection**, the MVP import is:

1. Open your saved ImmoScout search results page in the browser
2. View page source (often `Ctrl/Cmd+U`)
3. Copy the HTML
4. Paste it into the **Import** tab and click **Parse**

You can also paste JSON exported by this app.

## Metrics

- **€/m²** = `price / sqm`
- **Annual rent** = `monthlyRent * 12`
- **Price @ target yield** = `annualRent / targetYield / (1 + purchaseCostsPct/100)`
- **Total acquisition cost** = `price * (1 + purchaseCostsPct/100)`
- **Gross yield** = `annualRent / totalAcquisitionCost`
- **Rent multiplier** = `totalAcquisitionCost / annualRent`

## Next steps (when you’re ready)

- Add an automated “scan URL” importer using a local backend + browser automation (Playwright), reusing your logged-in session.
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
